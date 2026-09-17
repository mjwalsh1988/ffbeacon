/**
 * The one insert path for a Relay, and the admin edits that reuse it.
 *
 * writeRelay is called from three places and behaves the same in all of them:
 * the live curation pass (lib/beacon-brief/curate.ts, discord: true), the
 * force-push from the Filtered queue (discord: true), and the one-time backfill
 * (scripts/backfill-relays.ts, discord: false). Nothing else inserts into
 * `relays`.
 *
 * Order of operations, and why:
 *   1. Names are resolved (players, teams) because the grounding check needs
 *      them: "Eagles" is allowed when the post said "PHI" and the team matched.
 *   2. The grounding check runs BEFORE the insert. A Relay that fails it is
 *      written hidden with status_reason = 'grounding', its failing tokens are
 *      logged, and a moderation row opens so it appears in the queue. It never
 *      posts to Discord and never appears in the feed.
 *   3. Only a published Relay enqueues a Discord card, and only when the caller
 *      asked for one. The backfill never asks: an old report must never go out
 *      to the channel as if it were news.
 *
 * Idempotent on ingestion_id: a second call for the same post returns the row
 * that already exists rather than failing or duplicating it.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { logBeaconBrief } from "@/lib/beacon-brief/ai";
import { slugify } from "@/lib/beacon-brief/slug";
import type { CategorizeResult, QueueJobPayload } from "@/lib/beacon-brief/types";
import { normalizeRelayExtraction } from "./extract";
import { checkRelayGrounding, type GroundingFailure } from "./grounding";
import { renderRelayCard } from "./render";
import {
  RELAY_HEADLINE_MIN,
  parseRelayFacts,
  type RelayExtraction,
  type RelayFact,
  type RelayRow,
  type RelayStatus,
} from "./types";
import { assignRelayWeek, type NflStateLike } from "./week";

type Admin = SupabaseClient<Database>;
type Ingestion = Database["public"]["Tables"]["news_ingestions"]["Row"];

export interface WriteRelayInput {
  ingestion: Pick<
    Ingestion,
    | "id"
    | "text"
    | "quoted"
    | "retweeted"
    | "author_handle"
    | "external_url"
    | "created_at"
    | "metadata"
  >;
  /** The classify result, which may or may not carry a `relay` object. */
  ai: CategorizeResult & { relay?: unknown };
  refs: { categoryId: string | null; playerIds: string[]; teamIds: string[] };
  nflState: NflStateLike | null;
  /** The earlier Relay this one updates, when the follow-up link matched one. */
  followsRelayId?: string | null;
  /** Enqueue the Discord card for a published Relay. The backfill passes false. */
  discord: boolean;
}

export interface WriteRelayResult {
  relayId: string;
  slug: string;
  status: RelayStatus;
  statusReason: string | null;
  groundingFailures: GroundingFailure[];
  discordQueued: boolean;
  /** True when the row already existed and nothing was written. */
  existed: boolean;
}

/** Player and team names as the grounding check wants them. */
async function loadReferenceNames(
  admin: Admin,
  playerIds: string[],
  teamIds: string[],
): Promise<{ playerNames: string[]; teamNames: string[]; primaryPlayerId: string | null }> {
  const [players, teams] = await Promise.all([
    playerIds.length > 0
      ? admin
          .from("players")
          .select("id, full_name, first_name, last_name")
          .in("id", playerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; first_name: string | null; last_name: string | null }[] }),
    teamIds.length > 0
      ? admin.from("nfl_teams").select("id, name, abbreviation").in("id", teamIds)
      : Promise.resolve({ data: [] as { id: string; name: string; abbreviation: string }[] }),
  ]);
  const playerNames: string[] = [];
  for (const p of players.data ?? []) {
    const name = p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (name) playerNames.push(name);
  }
  const teamNames: string[] = [];
  for (const t of teams.data ?? []) {
    teamNames.push(t.name, t.abbreviation);
  }
  return { playerNames, teamNames, primaryPlayerId: playerIds[0] ?? null };
}

function quotedText(value: Json | null): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

/** The post's own timestamp from the raw X object, or the ingestion's clock. */
function sourcePostedAt(ingestion: WriteRelayInput["ingestion"]): string {
  const meta = ingestion.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const created = (meta as { created_at?: unknown }).created_at;
    if (typeof created === "string" && !Number.isNaN(new Date(created).getTime())) {
      return new Date(created).toISOString();
    }
  }
  return ingestion.created_at;
}

/** The deterministic suffix that disambiguates a colliding slug. */
function slugSuffix(ingestionId: string): string {
  return createHash("sha1").update(ingestionId).digest("hex").slice(0, 6);
}

/**
 * A slug that is not already taken by another Relay.
 *
 * The length cap and the empty-result guard apply on BOTH branches: a headline
 * that slugifies to nothing would otherwise be stored as an empty slug, and a
 * long one would be capped only when it happened to collide.
 */
async function uniqueRelaySlug(admin: Admin, base: string, ingestionId: string): Promise<string> {
  const suffix = slugSuffix(ingestionId);
  const slug = slugify(base).slice(0, 72) || `relay-${suffix}`;
  const { data: taken } = await admin.from("relays").select("id").eq("slug", slug).maybeSingle();
  if (!taken) return slug;
  return `${slug}-${suffix}`;
}

/** Fallback when the classify call returned no usable relay object. */
function fallbackExtraction(ai: CategorizeResult, text: string | null): RelayExtraction | null {
  const headline = (ai.suggested_title ?? "").trim();
  const candidate = headline.length >= RELAY_HEADLINE_MIN ? headline : (text ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (candidate.length < RELAY_HEADLINE_MIN) return null;
  return { headline: candidate, kind: "other", facts: [], timeline: null, availability: "none" };
}

async function openGroundingModeration(
  admin: Admin,
  ingestionId: string,
  relayId: string,
  reason: string,
  failures: GroundingFailure[],
): Promise<void> {
  // This row is the whole mechanism plan 4.6 relies on to surface a hidden
  // Relay, so a failed insert is logged rather than swallowed: without it the
  // Relay is hidden and nothing ever asks anyone to look at it.
  const { error } = await admin.from("beacon_brief_moderation").insert({
    ingestion_id: ingestionId,
    article_id: null,
    type: "failed_task",
    status: "pending",
    detail: {
      job_type: "relay_grounding",
      relay_id: relayId,
      error: reason,
      failures,
      attempts: 0,
    } as unknown as Json,
  });
  if (error) {
    await logBeaconBrief(admin, {
      stage: "error",
      level: "error",
      ingestionId,
      message: `relay ${relayId} is hidden but the moderation row could not be opened: ${error.message}`,
    });
  }
}

export interface RelayAssessment {
  names: { playerNames: string[]; teamNames: string[]; primaryPlayerId: string | null };
  extraction: RelayExtraction;
  status: RelayStatus;
  statusReason: string | null;
  failures: GroundingFailure[];
}

/**
 * Everything writeRelay decides before it inserts: the extraction (or the
 * fallback headline), the grounding verdict and the resulting status. Exported
 * so the backfill's dry run can report grounding failures without writing.
 * Null when there is no usable headline at all.
 */
export async function assessRelay(admin: Admin, input: WriteRelayInput): Promise<RelayAssessment | null> {
  const { ingestion, ai, refs } = input;
  const names = await loadReferenceNames(admin, refs.playerIds, refs.teamIds);

  let extraction = normalizeRelayExtraction(ai.relay);
  let status: RelayStatus = "published";
  let statusReason: string | null = null;
  let failures: GroundingFailure[] = [];

  if (!extraction) {
    extraction = fallbackExtraction(ai, ingestion.text);
    if (!extraction) return null;
    status = "hidden";
    statusReason = "extraction";
  } else {
    const grounding = checkRelayGrounding(
      {
        text: ingestion.text ?? "",
        quotedText: quotedText(ingestion.quoted),
        retweetedText: quotedText(ingestion.retweeted),
        playerNames: names.playerNames,
        teamNames: names.teamNames,
      },
      extraction,
    );
    if (!grounding.ok) {
      status = "hidden";
      statusReason = "grounding";
      failures = grounding.failures;
    }
  }
  return { names, extraction, status, statusReason, failures };
}

export async function writeRelay(admin: Admin, input: WriteRelayInput): Promise<WriteRelayResult> {
  const { ingestion, ai, refs } = input;

  const { data: existing } = await admin
    .from("relays")
    .select("id, slug, status, status_reason")
    .eq("ingestion_id", ingestion.id)
    .maybeSingle();
  if (existing) {
    return {
      relayId: existing.id,
      slug: existing.slug,
      status: existing.status as RelayStatus,
      statusReason: existing.status_reason,
      groundingFailures: [],
      discordQueued: false,
      existed: true,
    };
  }

  const assessed = await assessRelay(admin, input);
  if (!assessed) {
    throw new Error(`relay: no usable headline for ingestion ${ingestion.id}`);
  }
  const { names, extraction, status, statusReason, failures } = assessed;

  const postedAt = sourcePostedAt(ingestion);
  const week = assignRelayWeek(input.nflState, postedAt);
  const slug = await uniqueRelaySlug(admin, ai.suggested_slug || extraction.headline, ingestion.id);

  const row = {
    ingestion_id: ingestion.id,
    kind: extraction.kind,
    headline: extraction.headline,
    facts: extraction.facts as unknown as Json,
    timeline: extraction.timeline,
    availability: extraction.availability,
    category_id: refs.categoryId,
    relevance_tier: ai.relevance_tier ?? 0,
    tags: ai.tags ?? [],
    season: week.season,
    week: week.week,
    source_handle: ingestion.author_handle ?? "",
    source_url: ingestion.external_url ?? "",
    source_posted_at: postedAt,
    follows_relay_id: input.followsRelayId ?? null,
    status,
    status_reason: statusReason,
  };

  let finalSlug = slug;
  let { data: inserted, error } = await admin
    .from("relays")
    .insert({ ...row, slug: finalSlug })
    .select("id")
    .single();
  if (error || !inserted) {
    // A concurrent write for the same ingestion: return the winner.
    const { data: race } = await admin
      .from("relays")
      .select("id, slug, status, status_reason")
      .eq("ingestion_id", ingestion.id)
      .maybeSingle();
    if (race) {
      return {
        relayId: race.id,
        slug: race.slug,
        status: race.status as RelayStatus,
        statusReason: race.status_reason,
        groundingFailures: [],
        discordQueued: false,
        existed: true,
      };
    }
    // No competing row for this ingestion, so a unique violation is a SLUG
    // collision that the pre-check lost a race on. Retry once with the
    // deterministic suffix rather than throwing the post away; every other
    // error still throws, because it is not something a retry can fix.
    if (error?.code === "23505") {
      finalSlug = `${slug.slice(0, 72)}-${slugSuffix(ingestion.id)}`;
      ({ data: inserted, error } = await admin
        .from("relays")
        .insert({ ...row, slug: finalSlug })
        .select("id")
        .single());
    }
    if (error || !inserted) {
      throw new Error(`relay insert failed: ${error?.message ?? "no row"}`);
    }
  }
  const relayId = inserted.id;

  // The join rows are what the player and team feeds read, so a silent failure
  // here is a Relay that exists and is unreachable from either archive.
  if (refs.playerIds.length > 0) {
    const { error: linkErr } = await admin.from("relay_players").upsert(
      refs.playerIds.map((pid) => ({
        relay_id: relayId,
        player_id: pid,
        is_primary: pid === names.primaryPlayerId,
      })),
      { onConflict: "relay_id,player_id", ignoreDuplicates: true },
    );
    if (linkErr) {
      await logBeaconBrief(admin, {
        stage: "error",
        level: "error",
        ingestionId: ingestion.id,
        message: `relay ${relayId} players could not be linked: ${linkErr.message}`,
      });
    }
  }
  if (refs.teamIds.length > 0) {
    const { error: linkErr } = await admin.from("relay_teams").upsert(
      refs.teamIds.map((tid) => ({ relay_id: relayId, team_id: tid })),
      { onConflict: "relay_id,team_id", ignoreDuplicates: true },
    );
    if (linkErr) {
      await logBeaconBrief(admin, {
        stage: "error",
        level: "error",
        ingestionId: ingestion.id,
        message: `relay ${relayId} teams could not be linked: ${linkErr.message}`,
      });
    }
  }

  if (status === "hidden") {
    const reason =
      statusReason === "grounding"
        ? `grounding failed: ${failures.map((f) => `${f.token} (${f.check}, ${f.where})`).join("; ")}. Edit and publish it from the Relays manager.`
        : "the classify call returned no relay object; the headline is the suggested title. Review it in the Relays manager.";
    await openGroundingModeration(admin, ingestion.id, relayId, reason, failures);
    await logBeaconBrief(admin, {
      stage: "categorize",
      level: "warn",
      ingestionId: ingestion.id,
      message: `relay written hidden (${statusReason}): ${reason}`,
      responsePayload: { relay_id: relayId, failures } as unknown as Json,
    });
  } else {
    await logBeaconBrief(admin, {
      stage: "categorize",
      level: "info",
      ingestionId: ingestion.id,
      message: `relay written: ${extraction.headline}`,
      responsePayload: { relay_id: relayId, slug } as unknown as Json,
    });
  }

  let discordQueued = false;
  if (status === "published" && input.discord) {
    const payload: QueueJobPayload = {
      ingestion_id: ingestion.id,
      relay_id: relayId,
      role_ids: [],
    };
    const { error: qErr } = await admin.from("beacon_brief_queue").insert({
      job_type: "discord_post",
      payload: payload as unknown as Json,
      status: "pending",
      run_after: new Date().toISOString(),
    });
    discordQueued = !qErr;
  }

  return {
    relayId,
    slug: finalSlug,
    status,
    statusReason,
    groundingFailures: failures,
    discordQueued,
    existed: false,
  };
}

/** The Relay written for one ingestion, or null. */
export async function loadRelayForIngestion(admin: Admin, ingestionId: string): Promise<RelayRow | null> {
  const { data } = await admin.from("relays").select("*").eq("ingestion_id", ingestionId).maybeSingle();
  return data ?? null;
}

/** Player and team names for a stored Relay, for re-grounding an edit. */
async function namesForRelay(admin: Admin, relayId: string) {
  const [{ data: rp }, { data: rt }] = await Promise.all([
    admin.from("relay_players").select("player_id").eq("relay_id", relayId),
    admin.from("relay_teams").select("team_id").eq("relay_id", relayId),
  ]);
  return loadReferenceNames(
    admin,
    (rp ?? []).map((r) => r.player_id),
    (rt ?? []).map((r) => r.team_id),
  );
}

export interface RelayTextEdit {
  headline: string;
  facts: RelayFact[];
  timeline: string | null;
}

/**
 * An admin edit of a Relay's text. Re-runs the grounding check against the
 * stored post, publishes on a pass, keeps it hidden with the failures on a
 * miss, and patches the Discord card when one exists.
 *
 * `discord` defaults to true and is the same guarantee writeRelay's own flag
 * carries: the backfill passes false, and no queue row is written at all on
 * that path. Writing one and deleting it afterwards is not equivalent, because
 * the worker runs every minute and a job it has already claimed is no longer
 * pending for the delete to find.
 */
export async function updateRelayText(
  admin: Admin,
  relayId: string,
  edit: RelayTextEdit,
  opts: { publishIfGrounded: boolean; discord?: boolean },
): Promise<{ ok: boolean; status: RelayStatus; failures: GroundingFailure[]; error?: string }> {
  const discord = opts.discord !== false;
  const { data: relay } = await admin.from("relays").select("*").eq("id", relayId).maybeSingle();
  if (!relay) return { ok: false, status: "hidden", failures: [], error: "Relay not found." };
  if (relay.status === "retracted") {
    return { ok: false, status: "retracted", failures: [], error: "A retracted Relay cannot be edited." };
  }
  const { data: ingestion } = await admin
    .from("news_ingestions")
    .select("id, text, quoted, retweeted, discord_message_id")
    .eq("id", relay.ingestion_id)
    .maybeSingle();
  if (!ingestion) return { ok: false, status: relay.status as RelayStatus, failures: [], error: "Source post not found." };

  const normalized = normalizeRelayExtraction({
    headline: edit.headline,
    kind: relay.kind,
    facts: edit.facts,
    timeline: edit.timeline,
    availability: relay.availability ?? "none",
  });
  if (!normalized) {
    return { ok: false, status: relay.status as RelayStatus, failures: [], error: `The headline must be at least ${RELAY_HEADLINE_MIN} characters.` };
  }

  const names = await namesForRelay(admin, relayId);
  const grounding = checkRelayGrounding(
    {
      text: ingestion.text ?? "",
      quotedText: quotedText(ingestion.quoted),
      retweetedText: quotedText(ingestion.retweeted),
      playerNames: names.playerNames,
      teamNames: names.teamNames,
    },
    normalized,
  );

  const nextStatus: RelayStatus = grounding.ok
    ? opts.publishIfGrounded
      ? "published"
      : (relay.status as RelayStatus)
    : "hidden";
  const { error } = await admin
    .from("relays")
    .update({
      headline: normalized.headline,
      facts: normalized.facts as unknown as Json,
      timeline: normalized.timeline,
      status: nextStatus,
      status_reason: grounding.ok ? (nextStatus === "hidden" ? relay.status_reason : null) : "grounding",
      updated_at: new Date().toISOString(),
    })
    .eq("id", relayId);
  if (error) return { ok: false, status: relay.status as RelayStatus, failures: grounding.failures, error: error.message };

  if (grounding.ok && nextStatus === "published") {
    // A grounding moderation row for this relay is now settled.
    await admin
      .from("beacon_brief_moderation")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("ingestion_id", relay.ingestion_id)
      .eq("status", "pending")
      .eq("type", "failed_task")
      .filter("detail->>job_type", "eq", "relay_grounding");
    if (!discord) {
      // Nothing to enqueue, by the caller's instruction.
    } else if (ingestion.discord_message_id) {
      const payload: QueueJobPayload = {
        ingestion_id: relay.ingestion_id,
        target_ingestion_id: relay.ingestion_id,
        relay_id: relayId,
      };
      await admin.from("beacon_brief_queue").insert({
        job_type: "discord_patch",
        payload: payload as unknown as Json,
        status: "pending",
        run_after: new Date().toISOString(),
      });
    } else if (relay.status !== "published") {
      // Published for the first time from the queue: it never had a card.
      const payload: QueueJobPayload = { ingestion_id: relay.ingestion_id, relay_id: relayId, role_ids: [] };
      await admin.from("beacon_brief_queue").insert({
        job_type: "discord_post",
        payload: payload as unknown as Json,
        status: "pending",
        run_after: new Date().toISOString(),
      });
    }
  }

  return { ok: true, status: nextStatus, failures: grounding.failures };
}

/**
 * Hide, unhide or retract a Relay. A retraction edits the Discord card through
 * the existing discord_patch job and, when a published Brief already cites the
 * Relay, opens a brief_correction moderation row against that Brief. The
 * system never edits a published Brief on its own.
 *
 * PUBLISHING RE-RUNS THE GROUNDING CHECK. Plan 15 says a Relay that fails the
 * check is never published and never posted, and a hidden Relay is hidden
 * because it failed one (or because the extraction fell back to a suggested
 * title that was never checked at all). Unhiding without re-checking was a
 * one-click route past the guarantee.
 */
export async function setRelayStatus(
  admin: Admin,
  relayId: string,
  status: RelayStatus,
  reason: string | null,
  options: {
    /**
     * The OWNER'S override. Publishes without re-running the grounding check,
     * for a Relay the owner has read against the source post and judged
     * correct where the check disagreed. The check exists to stop the model
     * publishing from memory; it was never meant to outrank the person whose
     * byline the site carries. Recorded in status_reason so the override is
     * visible in the manager afterwards.
     */
    force?: boolean;
  } = {},
): Promise<{ ok: boolean; error?: string; failures?: GroundingFailure[] }> {
  const { data: relay } = await admin
    .from("relays")
    .select("id, ingestion_id, status, brief_id, headline, kind, facts, timeline, availability")
    .eq("id", relayId)
    .maybeSingle();
  if (!relay) return { ok: false, error: "Relay not found." };
  if (relay.status === "retracted") return { ok: false, error: "A retracted Relay stays retracted." };
  if ((status === "hidden" || status === "retracted") && !reason?.trim()) {
    return { ok: false, error: "A reason is required." };
  }

  if (status === "published" && relay.status !== "published" && !options.force) {
    const check = await recheckStoredGrounding(admin, relay);
    if (check && !check.ok) {
      return {
        ok: false,
        error: `The grounding check still fails on the stored text: ${check.failures
          .map((f) => `${f.token} (${f.check}, ${f.where})`)
          .join("; ")}. Edit the text and publish from the edit form.`,
        failures: check.failures,
      };
    }
  }

  const { error } = await admin
    .from("relays")
    .update({ status, status_reason: reason?.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", relayId);
  if (error) return { ok: false, error: error.message };

  if (status === "retracted") {
    const payload: QueueJobPayload = {
      ingestion_id: relay.ingestion_id,
      target_ingestion_id: relay.ingestion_id,
      relay_id: relayId,
      retract: true,
    };
    await admin.from("beacon_brief_queue").insert({
      job_type: "discord_patch",
      payload: payload as unknown as Json,
      status: "pending",
      run_after: new Date().toISOString(),
    });
    if (relay.brief_id) {
      const { error: modErr } = await admin.from("beacon_brief_moderation").insert({
        article_id: relay.brief_id,
        ingestion_id: relay.ingestion_id,
        type: "brief_correction",
        status: "pending",
        detail: { relay_id: relayId, headline: relay.headline, reason: reason?.trim() ?? "" } as unknown as Json,
      });
      if (modErr) {
        await logBeaconBrief(admin, {
          stage: "error",
          level: "error",
          ingestionId: relay.ingestion_id,
          message: `retracted relay ${relayId} is cited by brief ${relay.brief_id} but the correction row could not be opened: ${modErr.message}`,
        });
      }
    }
  }
  return { ok: true };
}

/**
 * Re-run the grounding check on a Relay's STORED text against its stored post.
 * Null when the post is gone, which is not evidence either way, so the caller
 * treats it as no verdict rather than as a pass or a failure.
 */
async function recheckStoredGrounding(
  admin: Admin,
  relay: {
    id: string;
    ingestion_id: string;
    kind: string;
    headline: string;
    facts: Json;
    timeline: string | null;
    availability: string | null;
  },
): Promise<{ ok: boolean; failures: GroundingFailure[] } | null> {
  const { data: ingestion } = await admin
    .from("news_ingestions")
    .select("id, text, quoted, retweeted")
    .eq("id", relay.ingestion_id)
    .maybeSingle();
  if (!ingestion) return null;
  const names = await namesForRelay(admin, relay.id);
  return checkRelayGrounding(
    {
      text: ingestion.text ?? "",
      quotedText: quotedText(ingestion.quoted),
      retweetedText: quotedText(ingestion.retweeted),
      playerNames: names.playerNames,
      teamNames: names.teamNames,
    },
    {
      headline: relay.headline,
      facts: parseRelayFacts(relay.facts),
      timeline: relay.timeline,
    },
  );
}

/** Link a resolved player or team reference to the Relay for an ingestion, when one exists. */
export async function linkRelayReference(
  admin: Admin,
  ingestionId: string,
  ref: { kind: "player"; playerId: string } | { kind: "team"; teamId: string },
): Promise<boolean> {
  const relay = await loadRelayForIngestion(admin, ingestionId);
  if (!relay) return false;
  if (ref.kind === "player") {
    const { error } = await admin
      .from("relay_players")
      .upsert({ relay_id: relay.id, player_id: ref.playerId }, { onConflict: "relay_id,player_id", ignoreDuplicates: true });
    return !error;
  }
  const { error } = await admin
    .from("relay_teams")
    .upsert({ relay_id: relay.id, team_id: ref.teamId }, { onConflict: "relay_id,team_id", ignoreDuplicates: true });
  return !error;
}

/** The Discord text for a stored row, through the one renderer. */
export function relayDiscordText(relay: RelayRow) {
  return renderRelayCard({
    headline: relay.headline,
    facts: parseRelayFacts(relay.facts),
    sourceHandle: relay.source_handle,
    sourcePostedAt: relay.source_posted_at,
  });
}
