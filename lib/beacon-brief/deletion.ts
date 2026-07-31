/**
 * The Beacon Brief deletion handling.
 *
 * runDeletionSweep (run by the worker) re-verifies that the source posts behind
 * published articles still exist; anything gone opens a PENDING moderation row
 * and NEVER auto-deletes anything. approveDeletion / rejectDeletion are called
 * from the admin Moderation action: approve unpublishes the article and queues a
 * Discord retract patch; reject keeps the article. Both close the moderation row.
 *
 * This replaces a per-article chain (one queued job re-queuing the next every 6
 * hours for 7 days). That design had two faults, both of which the 2026-07-31 X
 * credit outage exposed:
 *
 *   It was fragile. The next check was only queued after a SUCCESSFUL call, so
 *   when X started failing the chain snapped for every article at once and never
 *   restarted, even after credits were restored. The sweep re-derives what is due
 *   from stored state on every run, so an outage delays the watch instead of
 *   ending it.
 *
 *   It was expensive. 28 checks per article, one post per HTTP request. X bills
 *   reads per post returned, so the fix is fewer checks (two per article: one an
 *   hour in, one at the seven-day mark) and the batching is what keeps the
 *   request count and latency down: 100 ids per call instead of 1. Article volume
 *   spikes during the season and this cost scales with it, so the schedule is
 *   deliberately minimal rather than merely reduced.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getXTweetsByIds } from "@/lib/x";
import { logBeaconBrief } from "./ai";
import { beginXCall, recordXFailure, recordXSuccess } from "./health";
import type { BeaconBriefSettings } from "./settings";

type Admin = SupabaseClient<Database>;

/** X's id-lookup endpoint accepts at most 100 ids per request. */
const MAX_IDS_PER_REQUEST = 100;

/**
 * Below this chunk size, a fully empty response is plausible (one post really was
 * deleted). At or above it, every id coming back missing at once is far more
 * likely to be X misbehaving than a whole batch of reporters deleting posts in
 * the same hour, so the sweep refuses to act on it. Without this guard, batching
 * would introduce a way to unpublish a hundred articles from one bad response.
 */
const SUSPICIOUS_EMPTY_CHUNK_SIZE = 5;

export interface DeletionCandidate {
  id: string;
  source_external_id: string;
  article_id: string | null;
  created_at: string;
  deletion_checked_at: string | null;
}

/**
 * Whether a post is due for re-verification right now.
 *
 * Walks the tapered schedule: find the most recent checkpoint the post's age has
 * passed, and call it due if it has not been checked since that checkpoint came
 * around. A post that has already been checked at or after the final checkpoint
 * leaves the watch for good.
 *
 * Exported and pure so the schedule is testable without a database or a network.
 */
export function isDeletionCheckDue(input: {
  createdAt: string;
  lastCheckedAt: string | null;
  scheduleHours: number[];
  nowMs?: number;
}): boolean {
  const { createdAt, lastCheckedAt, scheduleHours } = input;
  const now = input.nowMs ?? Date.now();
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  if (scheduleHours.length === 0) return false;

  const checked = lastCheckedAt ? new Date(lastCheckedAt).getTime() : null;
  const checkedMs = checked !== null && !Number.isNaN(checked) ? checked : null;

  const age = now - created;
  // Most recent checkpoint the post has aged past. Nothing due before the first.
  let dueCheckpointMs: number | null = null;
  for (const hours of scheduleHours) {
    const offset = hours * 3_600_000;
    if (age >= offset) dueCheckpointMs = offset;
  }
  if (dueCheckpointMs === null) return false;

  if (checkedMs === null) return true;
  return checkedMs < created + dueCheckpointMs;
}

/**
 * How far back the sweep looks for candidates. The tapered schedule decides
 * which of those are actually due; this only has to reach past the final
 * checkpoint. The extra day of slack matters: with a 7-day window and a 168-hour
 * final checkpoint, a cutoff of exactly 7 days would make that last check
 * unreachable, since any post old enough to be due for it is already too old to
 * be selected.
 */
export function sweepLookbackMs(settings: BeaconBriefSettings): number {
  const finalCheckpoint =
    Math.max(...settings.deletionCheckHours, 0) * 3_600_000;
  const configured = Math.max(settings.deletionWatchDays, 0) * 86_400_000;
  return Math.max(configured, finalCheckpoint) + 86_400_000;
}

/** Split ids into request-sized chunks. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function openDeletionModeration(
  admin: Admin,
  row: DeletionCandidate,
): Promise<boolean> {
  const { data: existing } = await admin
    .from("beacon_brief_moderation")
    .select("id")
    .eq("ingestion_id", row.id)
    .eq("type", "deletion")
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return false;

  await admin.from("beacon_brief_moderation").insert({
    ingestion_id: row.id,
    article_id: row.article_id,
    type: "deletion",
    status: "pending",
    detail: {
      detected_at: new Date().toISOString(),
      source_external_id: row.source_external_id,
    } as unknown as Json,
  });
  await logBeaconBrief(admin, {
    stage: "deletion_check",
    level: "warn",
    ingestionId: row.id,
    message: "source post deleted; moderation opened",
  });
  return true;
}

export interface DeletionSweepResult {
  ok: boolean;
  /** Set when the sweep did not run at all (X circuit breaker open). */
  skipped?: string;
  candidates: number;
  checked: number;
  requests: number;
  deletionsOpened: number;
  error?: string;
}

/**
 * One pass of the deletion watch.
 *
 * Selects every published post whose next tapered checkpoint has passed, oldest
 * check first, and re-verifies them in batches. Returns ok even when X is down:
 * an unavailable source is not a job failure, it is a reason to try again next
 * time. That distinction is the whole point of the rework, since treating it as
 * a failure is what produced 30 alert emails from one billing event.
 */
export async function runDeletionSweep(
  admin: Admin,
  settings: BeaconBriefSettings,
): Promise<DeletionSweepResult> {
  const empty: DeletionSweepResult = {
    ok: true,
    candidates: 0,
    checked: 0,
    requests: 0,
    deletionsOpened: 0,
  };

  const gate = await beginXCall(admin, settings);
  if (!gate.allowed) {
    return { ...empty, skipped: gate.reason ?? "X integration unavailable" };
  }

  const cutoff = new Date(Date.now() - sweepLookbackMs(settings)).toISOString();
  const maxIds =
    settings.deletionSweepMaxIds > 0 ? settings.deletionSweepMaxIds : 300;

  // Least-recently-verified first (never-checked rows lead), so a backlog drains
  // in priority order and the per-run ceiling always spends itself on the most
  // overdue posts. The row cap is an explicit bound rather than a reliance on
  // PostgREST's silent 1000-row default.
  const { data: rows, error } = await admin
    .from("news_ingestions")
    .select("id, source_external_id, article_id, created_at, deletion_checked_at")
    .not("article_id", "is", null)
    .eq("status", "published")
    .gte("created_at", cutoff)
    .order("deletion_checked_at", { ascending: true, nullsFirst: true })
    .limit(maxIds * 4);

  if (error) {
    return { ...empty, ok: false, error: `candidate query failed: ${error.message}` };
  }

  const candidates = (rows ?? []) as DeletionCandidate[];
  const due = candidates
    .filter((row) =>
      isDeletionCheckDue({
        createdAt: row.created_at,
        lastCheckedAt: row.deletion_checked_at,
        scheduleHours: settings.deletionCheckHours,
      }),
    )
    .slice(0, maxIds);

  if (due.length === 0) {
    return { ...empty, candidates: candidates.length };
  }

  const byId = new Map(due.map((row) => [row.source_external_id, row]));
  const result: DeletionSweepResult = {
    ...empty,
    candidates: candidates.length,
  };

  for (const batch of chunk(due, MAX_IDS_PER_REQUEST)) {
    const ids = batch.map((row) => row.source_external_id);
    const res = await getXTweetsByIds(ids);
    result.requests += 1;

    if (!res.ok) {
      const { outage } = await recordXFailure(admin, settings, res.error);
      await logBeaconBrief(admin, {
        stage: "deletion_check",
        level: outage ? "error" : "warn",
        message: `deletion sweep stopped after ${result.checked} of ${due.length}: ${res.error.detail}`,
      });
      // Nothing in this batch was stamped, so every one of them is still due and
      // the next sweep picks up exactly where this one stopped.
      return { ...result, skipped: res.error.detail };
    }
    await recordXSuccess(admin);

    const present = new Set((res.data.data ?? []).map((tweet) => tweet.id));
    const missing = ids.filter((id) => !present.has(id));

    if (
      missing.length === ids.length &&
      ids.length >= SUSPICIOUS_EMPTY_CHUNK_SIZE
    ) {
      await logBeaconBrief(admin, {
        stage: "deletion_check",
        level: "error",
        message: `refusing to act: X returned no posts for all ${ids.length} ids in this batch, which is far more likely to be an upstream fault than ${ids.length} simultaneous deletions`,
      });
      continue; // leave them due; a later sweep re-checks against a sane response
    }

    for (const id of missing) {
      const row = byId.get(id);
      if (row && (await openDeletionModeration(admin, row))) {
        result.deletionsOpened += 1;
      }
    }

    // Stamp the whole batch, deleted ones included: the moderation row now owns
    // the follow-up, so re-reading those posts every sweep would only cost money.
    const checkedAt = new Date().toISOString();
    await admin
      .from("news_ingestions")
      .update({ deletion_checked_at: checkedAt })
      .in(
        "id",
        batch.map((row) => row.id),
      );
    result.checked += batch.length;
  }

  await logBeaconBrief(admin, {
    stage: "deletion_check",
    level: "info",
    message: `deletion sweep: ${result.checked} post(s) re-verified in ${result.requests} request(s), ${result.deletionsOpened} deletion(s) opened`,
  });
  return result;
}

/** Approve a deletion: unpublish the article + queue a Discord retract. */
export async function approveDeletion(
  admin: Admin,
  moderationId: string,
  resolvedBy: string,
): Promise<void> {
  const { data: mod } = await admin
    .from("beacon_brief_moderation")
    .select("id, article_id, ingestion_id, status")
    .eq("id", moderationId)
    .maybeSingle();
  if (!mod || mod.status !== "pending") return;

  if (mod.article_id) {
    await admin
      .from("articles")
      .update({ status: "archived", last_updated: new Date().toISOString() })
      .eq("id", mod.article_id);
  }
  if (mod.ingestion_id) {
    await admin
      .from("news_ingestions")
      .update({ status: "deleted" })
      .eq("id", mod.ingestion_id);
    // Patch the original Discord message to a retracted state.
    await admin.from("beacon_brief_queue").insert({
      job_type: "discord_patch",
      payload: {
        ingestion_id: mod.ingestion_id,
        target_ingestion_id: mod.ingestion_id,
        retract: true,
      } as unknown as Json,
      status: "pending",
      run_after: new Date().toISOString(),
    });
  }

  await admin
    .from("beacon_brief_moderation")
    .update({
      status: "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq("id", moderationId);
}

/** Reject a deletion: keep the article, close the moderation row. */
export async function rejectDeletion(
  admin: Admin,
  moderationId: string,
  resolvedBy: string,
): Promise<void> {
  await admin
    .from("beacon_brief_moderation")
    .update({
      status: "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq("id", moderationId)
    .eq("status", "pending");
}
