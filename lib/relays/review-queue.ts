/**
 * The Relays waiting for the owner's review, read for the Relays page.
 *
 * A Relay that fails the grounding check is written hidden and opens a
 * `relay_grounding` row in beacon_brief_moderation (lib/relays/write.ts). That
 * row is the queue: it is pending until the owner decides the Relay, and every
 * decision closes it (settleRelayReview). This reads the pending rows and the
 * Relays they name, with the source post, so the review happens on the Relays
 * page next to the edit form rather than on the Moderation page, which now
 * only points here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { RelayAdminRow } from "@/components/admin/brief-desk/relays-manager";
import type { GroundingFailure } from "./grounding";
import { parseRelayFacts } from "./types";

type Admin = SupabaseClient<Database>;

/** Far more than a week's worth; the queue has never held more than a dozen. */
const REVIEW_LIMIT = 200;

function embeddedText(value: Json | null | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" && text.trim() ? text : null;
}

function parseFailures(detail: Json | null): GroundingFailure[] {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
  const list = (detail as { failures?: unknown }).failures;
  if (!Array.isArray(list)) return [];
  const out: GroundingFailure[] = [];
  for (const f of list) {
    if (!f || typeof f !== "object") continue;
    const { check, token, where } = f as Record<string, unknown>;
    if (
      (check === "number" || check === "name" || check === "fact") &&
      typeof token === "string" &&
      (where === "headline" || where === "fact" || where === "timeline")
    ) {
      out.push({ check, token, where });
    }
  }
  return out;
}

/**
 * How many Relays are waiting, for the overview and the Moderation pointer.
 * The length of the list itself, not a count of rows: a count of pending rows
 * would include a duplicate row for one Relay, or a row whose Relay was
 * decided before every decision closed its row, and the tile would then
 * disagree with the list it links to.
 */
export async function countRelayReviewQueue(admin: Admin): Promise<number> {
  return (await loadRelayReviewQueue(admin)).length;
}

export async function loadRelayReviewQueue(admin: Admin): Promise<RelayAdminRow[]> {
  const { data: mods } = await admin
    .from("beacon_brief_moderation")
    .select("id, created_at, detail, news_ingestions(text, quoted, retweeted)")
    .eq("status", "pending")
    .eq("type", "failed_task")
    .filter("detail->>job_type", "eq", "relay_grounding")
    .order("created_at", { ascending: false })
    .limit(REVIEW_LIMIT);
  const byRelay = new Map<string, NonNullable<typeof mods>[number]>();
  for (const m of mods ?? []) {
    const relayId = (m.detail as { relay_id?: unknown } | null)?.relay_id;
    // Two rows for one Relay would be two cards for one decision; keep the newest.
    if (typeof relayId === "string" && !byRelay.has(relayId)) byRelay.set(relayId, m);
  }
  if (byRelay.size === 0) return [];

  const { data: relays } = await admin
    .from("relays")
    .select(
      "id, slug, headline, kind, season, week, status, status_reason, source_handle, source_url, source_posted_at, facts, timeline, brief_id, updated_at",
    )
    .in("id", [...byRelay.keys()]);

  const rows: RelayAdminRow[] = [];
  for (const r of relays ?? []) {
    const mod = byRelay.get(r.id);
    // A Relay that is no longer hidden has been decided. Every status change
    // goes through lib/relays/write.ts and closes its row, so this only skips a
    // row left open by a decision made before that was true.
    if (!mod || r.status !== "hidden") continue;
    const ing = (mod as { news_ingestions?: { text?: string | null; quoted?: Json; retweeted?: Json } | null })
      .news_ingestions;
    // A plain repost carries the same words twice; show them once.
    const quoted = embeddedText(ing?.quoted) ?? embeddedText(ing?.retweeted);
    rows.push({
      id: r.id,
      slug: r.slug,
      headline: r.headline,
      kind: r.kind,
      season: r.season,
      week: r.week,
      status: r.status,
      statusReason: r.status_reason,
      sourceHandle: r.source_handle,
      sourceUrl: r.source_url,
      sourcePostedAt: r.source_posted_at,
      facts: parseRelayFacts(r.facts),
      timeline: r.timeline,
      briefId: r.brief_id,
      updatedAt: r.updated_at,
      review: {
        heldAt: mod.created_at,
        postText: ing?.text ?? "",
        quotedText: quoted && quoted !== ing?.text ? quoted : null,
        failures: parseFailures(mod.detail),
      },
    });
  }
  return rows.sort((a, b) => (b.review!.heldAt > a.review!.heldAt ? 1 : -1));
}
