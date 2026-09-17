/**
 * The Relay side of duplicate detection.
 *
 * lib/beacon-brief/followup.ts answers "is there already an ARTICLE for this
 * event?" With the article path off (bb_article_write_enabled = false) the
 * story we already have is a Relay, so the same three questions are asked here
 * against `relays`: an exact event key match (no model, no tokens), overlapping
 * event keys (a short list the model judges), and the recent-story fallback for
 * a post with no usable key. The mechanical gates in followup.ts apply to these
 * candidates exactly as they apply to article candidates; this file only
 * supplies them.
 *
 * The event key lives on news_ingestions, not on relays, so every lookup goes
 * ingestion first and joins the Relay by ingestion_id. Only a published or
 * hidden Relay is a candidate; a retracted one is a story that was withdrawn.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { eventKeyKind, eventKeysOverlap } from "@/lib/beacon-brief/event-key";
import type { FollowupCandidate } from "@/lib/beacon-brief/followup";
import { parseRelayFacts } from "./types";

type Admin = SupabaseClient<Database>;

const DEFAULT_LIMIT = 15;

type IngestionRow = { id: string; event_key: string | null; created_at: string };

/** The Relay rows for a set of ingestions, keyed by ingestion id. */
async function relaysByIngestion(admin: Admin, ingestionIds: string[]) {
  const map = new Map<
    string,
    { id: string; headline: string; facts: unknown; player_ids: string[]; team_ids: string[] }
  >();
  if (ingestionIds.length === 0) return map;
  const { data: relays } = await admin
    .from("relays")
    .select("id, ingestion_id, headline, facts, status")
    .in("ingestion_id", ingestionIds)
    .in("status", ["published", "hidden"]);
  const rows = relays ?? [];
  if (rows.length === 0) return map;
  const relayIds = rows.map((r) => r.id);
  const [{ data: rp }, { data: rt }] = await Promise.all([
    admin.from("relay_players").select("relay_id, player_id").in("relay_id", relayIds),
    admin.from("relay_teams").select("relay_id, team_id").in("relay_id", relayIds),
  ]);
  const players = new Map<string, string[]>();
  for (const r of rp ?? []) players.set(r.relay_id, [...(players.get(r.relay_id) ?? []), r.player_id]);
  const teams = new Map<string, string[]>();
  for (const r of rt ?? []) teams.set(r.relay_id, [...(teams.get(r.relay_id) ?? []), r.team_id]);
  for (const r of rows) {
    map.set(r.ingestion_id, {
      id: r.id,
      headline: r.headline,
      facts: r.facts,
      player_ids: players.get(r.id) ?? [],
      team_ids: teams.get(r.id) ?? [],
    });
  }
  return map;
}

function candidateFrom(
  ingestionId: string,
  relay: { id: string; headline: string; facts: unknown; player_ids: string[]; team_ids: string[] },
): FollowupCandidate {
  return {
    ingestion_id: ingestionId,
    article_id: null,
    relay_id: relay.id,
    title: relay.headline,
    summary: parseRelayFacts(relay.facts)
      .map((f) => `${f.label}: ${f.value}`)
      .join(". "),
    player_ids: relay.player_ids,
    team_ids: relay.team_ids,
  };
}

/** Root ingestions (never revisions) inside the window, newest first. */
async function recentRootIngestions(
  admin: Admin,
  opts: { cutoffIso: string; excludeIngestionId?: string | null; eventKey?: string; keyPrefix?: string; limit: number },
): Promise<IngestionRow[]> {
  let q = admin
    .from("news_ingestions")
    .select("id, event_key, created_at")
    .eq("is_revision", false)
    .in("status", ["published", "processing", "revised"])
    .gte("created_at", opts.cutoffIso)
    // NEWEST first, so the limit drops the OLDEST candidates. Ascending meant
    // the truncation threw away exactly the recent posts a follow-up is most
    // likely to be following. The article-side equivalent
    // (lib/beacon-brief/followup.ts) has always ordered descending.
    .order("created_at", { ascending: false })
    .limit(opts.limit);
  if (opts.eventKey) q = q.eq("event_key", opts.eventKey);
  if (opts.keyPrefix) q = q.like("event_key", `${opts.keyPrefix}%`);
  if (opts.excludeIngestionId) q = q.neq("id", opts.excludeIngestionId);
  const { data } = await q;
  return (data ?? []) as IngestionRow[];
}

/** The oldest Relay for exactly this event key inside the window, or null. */
export async function findExactRelayMatch(
  admin: Admin,
  opts: { eventKey: string; windowHours: number; excludeIngestionId?: string | null },
): Promise<FollowupCandidate | null> {
  const hours = opts.windowHours > 0 ? opts.windowHours : 72;
  const cutoffIso = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = await recentRootIngestions(admin, {
    cutoffIso,
    eventKey: opts.eventKey,
    excludeIngestionId: opts.excludeIngestionId,
    limit: 10,
  });
  if (rows.length === 0) return null;
  const relays = await relaysByIngestion(admin, rows.map((r) => r.id));
  for (const row of rows) {
    const relay = relays.get(row.id);
    if (relay) return candidateFrom(row.id, relay);
  }
  return null;
}

/** Relays about the same KIND of event with overlapping but not identical people. */
export async function loadRelayOverlapCandidates(
  admin: Admin,
  opts: { eventKey: string; windowHours: number; excludeIngestionId?: string | null; limit?: number },
): Promise<FollowupCandidate[]> {
  const kind = eventKeyKind(opts.eventKey);
  if (!kind) return [];
  const hours = opts.windowHours > 0 ? opts.windowHours : 72;
  const cutoffIso = new Date(Date.now() - hours * 3_600_000).toISOString();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await recentRootIngestions(admin, {
    cutoffIso,
    keyPrefix: `${kind}:`,
    excludeIngestionId: opts.excludeIngestionId,
    limit: limit * 4,
  });
  const overlapping = rows.filter(
    (r) => r.event_key && r.event_key !== opts.eventKey && eventKeysOverlap(opts.eventKey, r.event_key),
  );
  if (overlapping.length === 0) return [];
  const relays = await relaysByIngestion(admin, overlapping.map((r) => r.id));
  const out: FollowupCandidate[] = [];
  for (const row of overlapping) {
    const relay = relays.get(row.id);
    if (!relay) continue;
    out.push(candidateFrom(row.id, relay));
    if (out.length >= limit) break;
  }
  return out;
}

/** Recent Relays with no key filter, for a post whose own key could not be built. */
export async function loadRecentRelayCandidates(
  admin: Admin,
  opts: { lookbackHours: number; excludeIngestionId?: string | null; limit?: number },
): Promise<FollowupCandidate[]> {
  const hours = opts.lookbackHours > 0 ? opts.lookbackHours : 1;
  const cutoffIso = new Date(Date.now() - hours * 3_600_000).toISOString();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await recentRootIngestions(admin, {
    cutoffIso,
    excludeIngestionId: opts.excludeIngestionId,
    limit: limit * 4,
  });
  if (rows.length === 0) return [];
  const relays = await relaysByIngestion(admin, rows.map((r) => r.id));
  const out: FollowupCandidate[] = [];
  // Already newest first from the query, matching the article candidate order.
  for (const row of rows) {
    const relay = relays.get(row.id);
    if (!relay) continue;
    out.push(candidateFrom(row.id, relay));
    if (out.length >= limit) break;
  }
  return out;
}
