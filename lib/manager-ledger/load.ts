/**
 * Everything the Manager Ledger reads, and nothing it writes.
 *
 * NO SLEEPER REQUEST IS MADE FROM HERE, EVER. Every figure this model produces
 * comes out of rows some earlier sync already stored: settled matchups,
 * transactions, draft selections, rosters, players. That is what makes the
 * whole feature cheap enough to recompute on demand and what makes it immune
 * to a throttled fetch, which is the failure mode that once cached an entire
 * league at zero projected wins for twelve hours.
 *
 * PAGINATION IS NOT OPTIONAL ON TWO OF THESE READS. PostgREST caps a plain
 * `select()` at 1000 rows and reports no error when it truncates, so a dynasty
 * league five seasons deep would silently lose its oldest transactions and the
 * ledger would grade a manager on the half of their season that happened to
 * fit. Matchups are bounded at eighteen weeks times the roster count and are
 * read in one go; transactions and draft selections are paged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  loadPlayers,
  loadRosters,
  type RosterRow,
} from "@/lib/power-pulse/load";
import { normalizeIdList } from "@/lib/league-matchups";
import type { LedgerPlayer } from "./lineup";
import type { DraftPickInput, TransactionInput } from "./moves";
import type { WeekInput } from "./lineup";

type ServiceClient = SupabaseClient<Database>;

/** How many rows a paged read asks for at a time. */
const PAGE = 1000;

/** Shared empty set, so a roster with nothing on IR allocates nothing. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * Injured reserve plus the taxi squad, per roster.
 *
 * Both are slots Sleeper will not let a manager fill from, so a player sitting
 * in one could not have been started however many points he scored. See
 * `WeekInput.ineligibleIds` in ./lineup.ts for why this matters and for the
 * limitation it carries.
 */
export function buildIneligibleIds(
  rosters: RosterRow[],
): Map<number, ReadonlySet<string>> {
  const out = new Map<number, ReadonlySet<string>>();
  for (const roster of rosters) {
    const ids = new Set<string>([
      ...roster.reserveSleeperIds,
      ...roster.taxiSleeperIds,
    ]);
    ids.delete("0");
    if (ids.size > 0) out.set(roster.sleeperRosterId, ids);
  }
  return out;
}

export type LedgerLeagueRow = {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: number;
  rosterPositions: string[];
  /**
   * True when the league runs a free agent acquisition budget, so a bid is a
   * real cost. Sleeper's `waiver_type` is 2 for FAAB; anything else is a
   * priority or rolling waiver order where a bid does not exist.
   */
  hasFaab: boolean;
};

function asStringArray(value: unknown): string[] {
  return normalizeIdList(value).filter((id) => id.length > 0);
}

export async function loadLedgerLeague(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<LedgerLeagueRow | null> {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id, name, season, roster_positions, metadata")
    .eq("id", leagueRowId)
    .maybeSingle();
  if (error || !data) return null;

  const meta = (data.metadata ?? {}) as { settings?: Record<string, unknown> };
  const waiverType = Number(meta.settings?.waiver_type);
  const waiverBudget = Number(meta.settings?.waiver_budget);

  return {
    id: data.id,
    sleeperLeagueId: data.sleeper_league_id,
    name: data.name,
    season: Number(data.season),
    rosterPositions: asStringArray(data.roster_positions),
    hasFaab:
      waiverType === 2 || (Number.isFinite(waiverBudget) && waiverBudget > 0),
  };
}

export { loadRosters };
export type { RosterRow };

/** One settled week for one roster, plus the opponent's score. */
export type LoadedWeek = WeekInput & {
  sleeperRosterId: number;
  startedIds: Set<string>;
};

function pointsMap(value: Json | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const points = Number(raw);
    if (!Number.isFinite(points)) continue;
    out.set(key, points);
  }
  return out;
}

/**
 * Settled weeks only.
 *
 * `is_final` is the whole gate. A week that has not settled is not partially
 * included at a discount; it is absent, because a lineup decision graded
 * against a Sunday-afternoon scoreboard is a decision that has not finished
 * happening. The fix in lib/league-matchups.ts that keeps chasing an unsettled
 * past week until it settles is what makes this gate safe to rely on.
 *
 * The opponent is resolved from `matchup_id` within the same week. A roster
 * Sleeper left unpaired, or one in a playoff bye, gets a null opponent rather
 * than a zero, and the grader treats that week as having no result.
 */
export async function loadSettledWeeks(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  /**
   * Ids each roster could not legally start, keyed by Sleeper roster id.
   * Built from `rosters.reserve_ids` and `rosters.taxi_ids`. See
   * `WeekInput.ineligibleIds` for what it is for and what it cannot know.
   */
  ineligibleByRoster: Map<number, ReadonlySet<string>> = new Map(),
): Promise<LoadedWeek[]> {
  const { data, error } = await supabase
    .from("league_matchups")
    .select(
      "week, sleeper_roster_id, matchup_id, points, starter_ids, player_ids, player_points",
    )
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("is_final", true)
    .order("week", { ascending: true });
  if (error || !data) return [];

  type Row = (typeof data)[number];
  const rows = data as Row[];

  // Official score by (week, roster), so an opponent lookup is a map read.
  const pointsByKey = new Map<string, number>();
  for (const row of rows) {
    pointsByKey.set(
      `${Number(row.week)}|${Number(row.sleeper_roster_id)}`,
      Number(row.points ?? 0),
    );
  }

  // Roster ids sharing a matchup_id within one week.
  const pairKey = (week: number, matchupId: number) => `${week}|${matchupId}`;
  const sides = new Map<string, number[]>();
  for (const row of rows) {
    if (row.matchup_id === null || row.matchup_id === undefined) continue;
    const key = pairKey(Number(row.week), Number(row.matchup_id));
    const list = sides.get(key) ?? [];
    list.push(Number(row.sleeper_roster_id));
    sides.set(key, list);
  }

  return rows.map((row) => {
    const week = Number(row.week);
    const rosterId = Number(row.sleeper_roster_id);

    let opponentPoints: number | null = null;
    if (row.matchup_id !== null && row.matchup_id !== undefined) {
      const list = sides.get(pairKey(week, Number(row.matchup_id))) ?? [];
      // Exactly two sides is a game. One is an unpaired roster; more than two
      // is a Sleeper shape we do not understand, and guessing which of them was
      // the opponent would put a fabricated result on a real week.
      if (list.length === 2) {
        const opponentId = list.find((id) => id !== rosterId);
        if (opponentId !== undefined) {
          opponentPoints = pointsByKey.get(`${week}|${opponentId}`) ?? null;
        }
      }
    }

    // Verbatim, placeholders included: the index into this array IS the slot.
    const starterIds = normalizeIdList(row.starter_ids);

    return {
      week,
      sleeperRosterId: rosterId,
      officialPoints: Number(row.points ?? 0),
      starterIds,
      playerPoints: pointsMap(row.player_points),
      opponentPoints,
      startedIds: new Set(
        starterIds.filter((id) => id.length > 0 && id !== "0"),
      ),
      ineligibleIds: ineligibleByRoster.get(rosterId) ?? EMPTY_IDS,
    };
  });
}

/**
 * Completed transactions for one season, paged.
 *
 * Only `status = 'complete'` is read. A failed waiver claim cost nothing and
 * delivered nothing, so grading a manager on one would be grading them on
 * something that did not happen. `week` now arrives populated on every row;
 * see migration 0243 for why it did not used to.
 */
export async function loadLedgerTransactions(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<TransactionInput[]> {
  const out: TransactionInput[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("league_transactions")
      .select(
        "id, type, status, week, adds, drops, draft_picks, roster_ids, metadata",
      )
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .eq("status", "complete")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data) {
      const week = Number(row.week);
      if (!Number.isInteger(week) || week <= 0) continue;

      const meta = (row.metadata ?? {}) as {
        settings?: Record<string, unknown>;
      };
      const rawBid = Number(meta.settings?.waiver_bid);
      const bid = Number.isFinite(rawBid) && rawBid >= 0 ? rawBid : null;

      const picks = row.draft_picks;
      out.push({
        id: row.id,
        type: String(row.type ?? ""),
        week,
        adds: rosterMap(row.adds),
        drops: rosterMap(row.drops),
        bid,
        hasPicks: Array.isArray(picks) && picks.length > 0,
        rosterIds: numberList(row.roster_ids),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/** Sleeper's adds/drops shape: a map of player id to roster id. */
function rosterMap(value: Json | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [playerId, raw] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const rosterId = Number(raw);
    if (Number.isFinite(rosterId)) out[playerId] = rosterId;
  }
  return out;
}

function numberList(value: Json | null): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

/**
 * The draft selections for one league season, paged.
 *
 * Keyed on `sleeper_league_id` because that is the column the table carries;
 * it has no foreign key to `leagues.id`. A league with both a startup and a
 * rookie draft in one season returns both, which is correct: both were
 * decisions made this season. `sleeper_draft_id` comes back with them so the
 * round baselines can keep the two apart, since round 1 of a 24-round startup
 * is not the same question as round 1 of a 4-round rookie draft.
 */
export async function loadLedgerDraftPicks(
  supabase: ServiceClient,
  sleeperLeagueId: string,
  season: number,
): Promise<DraftPickInput[]> {
  const out: DraftPickInput[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("draft_selections")
      .select("sleeper_draft_id, pick_no, round, roster_id, sleeper_player_id, is_keeper")
      .eq("sleeper_league_id", sleeperLeagueId)
      .eq("season", season)
      .order("pick_no", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data) {
      const rosterId = Number(row.roster_id);
      const playerId = row.sleeper_player_id;
      if (!Number.isFinite(rosterId) || !playerId) continue;
      out.push({
        draftId: String(row.sleeper_draft_id ?? ""),
        pickNo: Number(row.pick_no ?? 0),
        round: Number(row.round ?? 0),
        rosterId,
        playerId: String(playerId),
        isKeeper: Boolean(row.is_keeper),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Resolve every Sleeper id this run mentions to a name and a position.
 *
 * One read for the union of ids across matchups, transactions and the draft,
 * rather than three. `loadPlayers` drops anything whose position is not one the
 * lineup optimiser understands, which is exactly the set this model can grade.
 */
export async function loadLedgerPlayers(
  supabase: ServiceClient,
  weeks: LoadedWeek[],
  transactions: TransactionInput[],
  picks: DraftPickInput[],
): Promise<Map<string, LedgerPlayer>> {
  const ids = new Set<string>();
  for (const week of weeks) {
    for (const id of week.playerPoints.keys()) ids.add(id);
    for (const id of week.startedIds) ids.add(id);
  }
  for (const tx of transactions) {
    for (const id of Object.keys(tx.adds)) ids.add(id);
    for (const id of Object.keys(tx.drops)) ids.add(id);
  }
  for (const pick of picks) ids.add(pick.playerId);

  const rows = await loadPlayers(supabase, [...ids]);
  const out = new Map<string, LedgerPlayer>();
  for (const [sleeperId, row] of rows) {
    out.set(sleeperId, { sleeperId, name: row.name, position: row.position });
  }
  return out;
}
