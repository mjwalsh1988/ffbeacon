/**
 * FF Beacon room ADP: where our OWN synced drafts actually take each player.
 *
 * Public Sleeper ADP is sampled across orders of magnitude more drafts and stays
 * the headline market number. This is the second opinion, and it is format-EXACT
 * in a way the public feed is not: Sleeper publishes ten market keys, we carry
 * thirteen formats, and TE premium has no public market at all.
 *
 * THREE THINGS THIS GETS RIGHT THAT A NAIVE AVERAGE WOULD NOT
 *
 * 1. Pick numbers are normalized to a 12-team draft before averaging. Pick 24 is
 *    round 3 in a ten-team league and round 2 in a twelve, so averaging raw pick
 *    numbers across differently sized rooms silently rewards whoever drafts in
 *    the smaller ones. Rooms with an unknown team count keep their raw pick
 *    number rather than being dropped.
 *
 * 2. Keepers are excluded. A keeper is not a market decision; it is a roster
 *    already made. Counting them would drag a kept star's ADP toward whatever
 *    round his league assigns keepers.
 *
 * 3. Auction drafts are excluded. Pick order in an auction is bid order, not
 *    value order, so its pick numbers mean nothing on an ADP axis. The ledger
 *    still stores them; this is the only place they are filtered out.
 *
 * draft_rate is published alongside the mean because the mean hides the
 * denominator. A player taken in 4 of 30 drafts has a real market position of
 * "usually undrafted", and the value model needs to be able to see that.
 *
 * The aggregation is pure and unit tested. Only runBuildRoomAdp touches Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;
export type RoomAdpInsert = Database["public"]["Tables"]["draft_market_adp"]["Insert"];

/** The reference draft size every pick number is normalized to. */
export const REFERENCE_TEAMS = 12;

/** One ledger row, reduced to what the aggregation reads. */
export interface SelectionRow {
  sleeperDraftId: string;
  playerId: string;
  pickNo: number;
  formatSlug: string;
  playerPool: "everyone" | "rookies";
  season: number;
  teams: number | null;
  draftType: string | null;
  isKeeper: boolean;
}

/**
 * Rescale a pick number to a 12-team draft. Pick 1 stays pick 1 in every room,
 * so the transform is applied to the OFFSET from pick 1 rather than to the pick
 * number itself; scaling the raw number would move the first overall pick.
 */
export function normalizePick(pickNo: number, teams: number | null): number {
  if (!teams || !Number.isFinite(teams) || teams <= 0) return pickNo;
  return ((pickNo - 1) * REFERENCE_TEAMS) / teams + 1;
}

/** A draft type whose pick order carries no ADP meaning. */
export function isAdpEligibleDraftType(draftType: string | null): boolean {
  return (draftType ?? "").toLowerCase() !== "auction";
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample standard deviation. Null below two observations, where it is undefined. */
function stdev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * Reduce ledger rows to one ADP row per (format, pool, season, player).
 *
 * `drafts_sampled` is the number of ELIGIBLE DRAFTS IN THE COHORT, not the
 * number the player appeared in, which is what makes draft_rate meaningful.
 */
export function aggregateRoomAdp(
  rows: readonly SelectionRow[],
  computedAt: Date = new Date(),
): RoomAdpInsert[] {
  // Cohort key -> the set of eligible drafts seen in it.
  const cohortDrafts = new Map<string, Set<string>>();
  // Cohort+player key -> normalized picks.
  const picksByPlayer = new Map<
    string,
    { formatSlug: string; playerPool: string; season: number; playerId: string; picks: number[] }
  >();

  for (const row of rows) {
    if (!row.formatSlug || !row.playerId) continue;
    if (!isAdpEligibleDraftType(row.draftType)) continue;
    if (!Number.isFinite(row.pickNo) || row.pickNo <= 0) continue;

    const cohortKey = `${row.formatSlug}|${row.playerPool}|${row.season}`;

    // A keeper still proves the DRAFT existed (it is part of the cohort's
    // denominator) but is not itself a market observation.
    let drafts = cohortDrafts.get(cohortKey);
    if (!drafts) {
      drafts = new Set<string>();
      cohortDrafts.set(cohortKey, drafts);
    }
    drafts.add(row.sleeperDraftId);

    if (row.isKeeper) continue;

    const playerKey = `${cohortKey}|${row.playerId}`;
    let entry = picksByPlayer.get(playerKey);
    if (!entry) {
      entry = {
        formatSlug: row.formatSlug,
        playerPool: row.playerPool,
        season: row.season,
        playerId: row.playerId,
        picks: [],
      };
      picksByPlayer.set(playerKey, entry);
    }
    entry.picks.push(normalizePick(row.pickNo, row.teams));
  }

  const out: RoomAdpInsert[] = [];
  const timestamp = computedAt.toISOString();

  for (const entry of picksByPlayer.values()) {
    if (entry.picks.length === 0) continue;
    const cohortKey = `${entry.formatSlug}|${entry.playerPool}|${entry.season}`;
    const draftsSampled = cohortDrafts.get(cohortKey)?.size ?? 0;
    if (draftsSampled === 0) continue;

    const sorted = [...entry.picks].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const spread = stdev(sorted);

    out.push({
      format_slug: entry.formatSlug,
      player_pool: entry.playerPool,
      season: entry.season,
      player_id: entry.playerId,
      drafts_sampled: draftsSampled,
      picks_sampled: sorted.length,
      adp: round(mean, 2),
      adp_median: round(median(sorted), 2),
      // Rounded to whole picks: these are integer columns and a normalized pick
      // is fractional.
      earliest_pick: Math.max(1, Math.round(sorted[0])),
      latest_pick: Math.max(1, Math.round(sorted[sorted.length - 1])),
      pick_stdev: spread === null ? null : round(spread, 3),
      draft_rate: round(Math.min(1, sorted.length / draftsSampled), 4),
      computed_at: timestamp,
    });
  }

  return out;
}

const PAGE = 1000;
const UPSERT_CHUNK = 500;

export interface RoomAdpResult {
  selectionsRead: number;
  rowsWritten: number;
  cohorts: number;
  durationMs: number;
}

/**
 * Rebuild draft_market_adp from the ledger. Full replace per run: the table is
 * small, the aggregation is cheap, and a partial upsert would strand rows for
 * players who have since dropped out of a cohort.
 */
export async function runBuildRoomAdp(supabase: Client): Promise<RoomAdpResult> {
  const started = Date.now();

  const rows: SelectionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("draft_selections")
      .select(
        "sleeper_draft_id, player_id, pick_no, format_slug, player_pool, season, teams, draft_type, is_keeper",
      )
      .not("format_slug", "is", null)
      .not("player_id", "is", null)
      .order("sleeper_draft_id", { ascending: true })
      .order("pick_no", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`draft_selections read failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      // player_pool can be null on a row whose format was derived but whose
      // pool was not. Such a row has no cohort to join.
      if (!r.format_slug || !r.player_id || !r.player_pool) continue;
      rows.push({
        sleeperDraftId: r.sleeper_draft_id,
        playerId: r.player_id,
        pickNo: r.pick_no,
        formatSlug: r.format_slug,
        playerPool: r.player_pool as "everyone" | "rookies",
        season: r.season,
        teams: r.teams,
        draftType: r.draft_type,
        isKeeper: r.is_keeper,
      });
    }
    if (data.length < PAGE) break;
  }

  const adpRows = aggregateRoomAdp(rows);
  const cohorts = new Set(
    adpRows.map((r) => `${r.format_slug}|${r.player_pool}|${r.season}`),
  ).size;

  // One timestamp for the whole run, computed BEFORE the write, so the prune has
  // a boundary even when the run produced no rows at all. Keying the prune off
  // adpRows[0] meant an empty run skipped it entirely and left the whole table
  // stale indefinitely, which is the one case where staleness is least obvious.
  const runAt = adpRows[0]?.computed_at ?? new Date().toISOString();

  for (let i = 0; i < adpRows.length; i += UPSERT_CHUNK) {
    const chunk = adpRows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("draft_market_adp")
      .upsert(chunk, { onConflict: "format_slug,player_pool,season,player_id" });
    if (error) throw new Error(`draft_market_adp upsert failed: ${error.message}`);
  }

  // Drop rows this run did not produce. A player who fell out of a cohort would
  // otherwise keep a stale ADP forever.
  const { error: pruneErr } = await supabase
    .from("draft_market_adp")
    .delete()
    .lt("computed_at", runAt as string);
  if (pruneErr) {
    console.warn("[room-adp] stale prune failed", pruneErr.message);
  }

  return {
    selectionsRead: rows.length,
    rowsWritten: adpRows.length,
    cohorts,
    durationMs: Date.now() - started,
  };
}
