/**
 * Read layer for the Manager Ledger page.
 *
 * Shapes `league_manager_ledger_cache` into what the Decisions page renders.
 * One query against the cache plus two identity queries, the same shape as
 * lib/league-power-pulse-data.ts, so the page issues a fixed number of reads
 * regardless of how many rosters the league has.
 *
 * IDENTITIES ARE RESOLVED HERE, NOT STORED. The cache holds a roster id and
 * nothing about who owns it, so a manager who renames their team has the new
 * name on every figure rather than the name they had the morning the ledger
 * was computed. Same rule as lib/league-activity/, and the reason that module
 * separates an event from a card.
 *
 * Everything returned is plain JSON so it survives the server to client
 * boundary: no Maps, no Dates, no class instances.
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { teamLabelParts } from "@/lib/team-label";
import type {
  DraftMove,
  LedgerRecord,
  LedgerWeek,
  TradeMove,
  WaiverMove,
} from "@/lib/manager-ledger/types";

/** One stored row, as LEDGER_COLUMNS selects it. */
type LedgerCacheRow =
  Database["public"]["Tables"]["league_manager_ledger_cache"]["Row"];

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type LedgerViewTeam = {
  sleeperRosterId: number;
  /**
   * The primary label, and `ownerLabel` the handle under it, both from
   * `teamLabelParts`. Deliberately NOT `formatTeamLabel` plus `ownerLine`: that
   * pair prints the handle twice on every roster whose manager never set a team
   * name, because the formatted label already IS the handle by then.
   */
  teamName: string;
  ownerLabel: string | null;
  ownerAvatarId: string | null;

  weeksGraded: number;
  /** Sum of the official weekly scores over graded weeks. */
  officialPoints: number;
  setPoints: number;
  optimalPoints: number;
  pointsLeft: number;
  /** Points left per graded week, which is the figure a reader can feel. */
  pointsLeftPerWeek: number | null;
  efficiency: number | null;

  actualRecord: LedgerRecord;
  bestLineupRecord: LedgerRecord;
  winsLeftOnBench: number;
  weeksWithUngradedSlots: number;

  waiverMoves: number;
  waiverHits: number;
  waiverFaabSpent: number | null;
  waiverPointsStarted: number;
  waiverPointsPerDollar: number | null;

  tradeCount: number;
  tradePointsIn: number;
  tradePointsOut: number;
  tradeNet: number;
  tradeAnyPicks: boolean;

  draftPicks: number;
  draftPoints: number;
  draftAboveBaseline: number;

  efficiencyRank: number | null;
  waiverRank: number | null;
  tradeRank: number | null;
  draftRank: number | null;
  scoringRank: number | null;

  weeks: LedgerWeek[];
  moves: {
    waivers: WaiverMove[];
    trades: TradeMove[];
    draftBest: DraftMove[];
    draftWorst: DraftMove[];
  };
};

export type LedgerView = {
  season: number;
  gradedWeeks: number[];
  gradableSlots: string[];
  ungradableSlots: string[];
  generatedAt: string | null;
  teams: LedgerViewTeam[];
};

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a stored jsonb array without trusting its contents.
 *
 * The rows are written by this codebase and nothing else can write to the
 * table, but a shape written by an older model version can still be in there
 * after a deploy, and a page that throws on it would take the whole league
 * view down for the twelve hours until the recompute.
 */
function asArray<T>(value: Json | null): T[] {
  return Array.isArray(value) ? (value as unknown as T[]) : [];
}

/**
 * The columns the page reads, named rather than `*`.
 *
 * `waiver_points_on_roster` is deliberately absent: the view has no field for
 * it and nothing renders it. `graded_weeks`, `gradable_slots` and
 * `ungradable_slots` are denormalised onto every row and only the first is
 * read, but they are small and asking for row zero's copy would mean a second
 * query, so they stay.
 */
const LEDGER_COLUMNS = [
  "sleeper_roster_id",
  "weeks_graded",
  "set_points",
  "optimal_points",
  "points_left",
  "lineup_efficiency",
  "actual_wins",
  "actual_losses",
  "actual_ties",
  "best_lineup_wins",
  "best_lineup_losses",
  "best_lineup_ties",
  "wins_left_on_bench",
  "weeks_with_ungraded_slots",
  "waiver_moves",
  "waiver_hits",
  "waiver_faab_spent",
  "waiver_points_started",
  "waiver_points_per_dollar",
  "trade_count",
  "trade_points_in",
  "trade_points_out",
  "trade_net",
  "trade_any_picks",
  "draft_picks",
  "draft_points",
  "draft_above_baseline",
  "efficiency_rank",
  "waiver_rank",
  "trade_rank",
  "draft_rank",
  "scoring_rank",
  "weeks",
  "moves",
  "graded_weeks",
  "gradable_slots",
  "ungradable_slots",
  "generated_at",
].join(", ");

/**
 * Wrapped in React `cache()` so the Decisions page's two consumers share one
 * result. Without it the page read `rosters` and `league_users` here and again
 * inside `loadViewerCandidates`, which is already cached, for the same league
 * in the same render.
 */
export const loadManagerLedgerView = cache(async function loadManagerLedgerView(
  supabase: AnySupabase,
  leagueRowId: string,
  season: number,
): Promise<LedgerView | null> {
  const [ledgerRes, rostersRes, usersRes] = await Promise.all([
    supabase
      .from("league_manager_ledger_cache")
      .select(LEDGER_COLUMNS)
      .eq("league_id", leagueRowId)
      .eq("season", season),
    supabase
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", leagueRowId),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
  ]);

  // The column list is joined at runtime, which defeats PostgREST's generated
  // return type, so the row shape is asserted from the table's own generated
  // type. Every name in LEDGER_COLUMNS is a real column on it, so this is a
  // narrowing rather than a claim.
  const rows = (ledgerRes.data ?? []) as unknown as LedgerCacheRow[];
  if (rows.length === 0) return null;

  const usersById = new Map(
    (usersRes.data ?? []).map((u) => [u.sleeper_user_id, u]),
  );
  const ownerByRoster = new Map(
    (rostersRes.data ?? []).map((r) => [
      Number(r.sleeper_roster_id),
      r.owner_user_id,
    ]),
  );

  const teams: LedgerViewTeam[] = rows.map((row) => {
    const rosterId = Number(row.sleeper_roster_id);
    const ownerId = ownerByRoster.get(rosterId) ?? null;
    const user = ownerId ? usersById.get(ownerId) : null;
    const labelParts = teamLabelParts({
      teamName: user?.team_name,
      username: user?.display_name,
      sleeperRosterId: rosterId,
    });
    const weeks = asArray<LedgerWeek>(row.weeks);
    const moves = (row.moves ?? {}) as {
      waivers?: WaiverMove[];
      trades?: TradeMove[];
      draftBest?: DraftMove[];
      draftWorst?: DraftMove[];
    };

    const weeksGraded = asNumber(row.weeks_graded);
    const pointsLeft = asNumber(row.points_left);

    return {
      sleeperRosterId: rosterId,
      teamName: labelParts.primary,
      ownerLabel: labelParts.owner,
      ownerAvatarId: user?.avatar ?? null,

      weeksGraded,
      officialPoints: weeks.reduce(
        (sum, w) => sum + asNumber(w.officialPoints),
        0,
      ),
      setPoints: asNumber(row.set_points),
      optimalPoints: asNumber(row.optimal_points),
      pointsLeft,
      pointsLeftPerWeek: weeksGraded > 0 ? pointsLeft / weeksGraded : null,
      efficiency: asNumberOrNull(row.lineup_efficiency),

      actualRecord: {
        wins: asNumber(row.actual_wins),
        losses: asNumber(row.actual_losses),
        ties: asNumber(row.actual_ties),
      },
      bestLineupRecord: {
        wins: asNumber(row.best_lineup_wins),
        losses: asNumber(row.best_lineup_losses),
        ties: asNumber(row.best_lineup_ties),
      },
      winsLeftOnBench: asNumber(row.wins_left_on_bench),
      weeksWithUngradedSlots: asNumber(row.weeks_with_ungraded_slots),

      waiverMoves: asNumber(row.waiver_moves),
      waiverHits: asNumber(row.waiver_hits),
      waiverFaabSpent: asNumberOrNull(row.waiver_faab_spent),
      waiverPointsStarted: asNumber(row.waiver_points_started),
      waiverPointsPerDollar: asNumberOrNull(row.waiver_points_per_dollar),

      tradeCount: asNumber(row.trade_count),
      tradePointsIn: asNumber(row.trade_points_in),
      tradePointsOut: asNumber(row.trade_points_out),
      tradeNet: asNumber(row.trade_net),
      tradeAnyPicks: Boolean(row.trade_any_picks),

      draftPicks: asNumber(row.draft_picks),
      draftPoints: asNumber(row.draft_points),
      draftAboveBaseline: asNumber(row.draft_above_baseline),

      efficiencyRank: asNumberOrNull(row.efficiency_rank),
      waiverRank: asNumberOrNull(row.waiver_rank),
      tradeRank: asNumberOrNull(row.trade_rank),
      draftRank: asNumberOrNull(row.draft_rank),
      scoringRank: asNumberOrNull(row.scoring_rank),

      weeks,
      moves: {
        waivers: Array.isArray(moves.waivers) ? moves.waivers : [],
        trades: Array.isArray(moves.trades) ? moves.trades : [],
        draftBest: Array.isArray(moves.draftBest) ? moves.draftBest : [],
        draftWorst: Array.isArray(moves.draftWorst) ? moves.draftWorst : [],
      },
    };
  });

  // Most efficient first, so the table reads as a leaderboard like every other
  // ranking on the site. An unranked team (too few graded weeks) sorts last,
  // because it has no position to hold rather than the worst one.
  teams.sort((a, b) => {
    const ar = a.efficiencyRank ?? Number.POSITIVE_INFINITY;
    const br = b.efficiencyRank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.sleeperRosterId - b.sleeperRosterId;
  });

  const first = rows[0];
  return {
    season,
    gradedWeeks: asArray<number>(first.graded_weeks),
    gradableSlots: asArray<string>(first.gradable_slots),
    ungradableSlots: asArray<string>(first.ungradable_slots),
    generatedAt: first.generated_at ?? null,
    teams,
  };
});

/** What a league with no stored ledger is told, and whether to show a preview. */
export type LedgerEmptyState = {
  title: string;
  body: string;
  /** The line under the body. Null when there is nothing further to say. */
  next: string | null;
  /**
   * Whether to show the worked example of a filled-in page.
   *
   * ONLY WHEN THE LEDGER IS GENUINELY GOING TO FILL IN. A preview is a promise
   * about what this page will show, so a league that will never have one must
   * not be shown it: `settled` means the league's starting slots cannot be
   * graded at all and no number will ever appear, and `error` means the last
   * run failed, which is a fault to report rather than a season to look forward
   * to. Showing a glossy example under either would be telling a reader
   * something untrue about their own league.
   */
  showPreview: boolean;
};

/**
 * The verdict for a league that has no stored ledger.
 *
 * Read off `leagues.manager_ledger_status`, so a reader is told which honest
 * reason applies rather than "still calculating" forever. The detail column is
 * server-written and admin-only; it is deliberately NOT surfaced here, because
 * it carries internal wording and error text that means nothing to a manager.
 */
export function ledgerEmptyState(status: string | null | undefined): LedgerEmptyState {
  switch (status) {
    case "skipped":
      // Deliberately covers BOTH skip reasons in one message. The other one is
      // "no rosters stored for this league", which happens on a league whose
      // first sync has not finished, and both clear themselves the same way.
      // Naming only the week reason told half the leagues that reach here a
      // thing that was not true of them.
      return {
        title: "No decisions to grade yet",
        body: "Nothing here is a prediction, so there is nothing to show until your league plays. It fills in on its own once a week finishes.",
        next: "Every manager gets graded on the same four things.",
        showPreview: true,
      };
    case "settled":
      return {
        title: "This league cannot be graded",
        body: "We have no eligibility rules for the slots this league starts, so there is no best lineup to measure anyone against.",
        next: null,
        showPreview: false,
      };
    case "error":
      return {
        title: "That did not finish",
        body: "The last attempt stopped partway. Nothing is lost and nothing is wrong with your league. It will retry on its own.",
        next: "Check back in a few minutes.",
        showPreview: false,
      };
    default:
      return {
        title: "Building this league's ledger",
        body: "This league has not been graded yet. It is worked out the first time someone opens this page, so it should be here on your next visit.",
        next: null,
        showPreview: true,
      };
  }
}
