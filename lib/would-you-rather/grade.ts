/**
 * Grading one league's trades for Would You Rather.
 *
 * A thin, shared wrapper over `analyzeLeagueTrades`, which is the SAME pipeline
 * behind the League Pulse transactions feed and /tools/signal-check: FF Beacon
 * native values, the league's own derived format, the published ruleset. The
 * game does not get its own opinion of a trade, and it must not: the whole
 * payoff of the reveal is that the reader is shown the real verdict, not a
 * second one built for a game.
 *
 * Both callers live here for a reason. The POOL BUILDER grades a batch to find
 * out which trades are gradeable at all, because a trade that cannot be scored
 * has no reveal and therefore has no business being in the pool. The ROUND
 * loader grades exactly one, to build the board and, once a vote lands, the
 * review. Sharing the wrapper means the pool can never admit a trade the round
 * loader would later fail on.
 *
 * ANONYMITY IS APPLIED HERE, AT THE SOURCE. The roster labels handed to the
 * pipeline are "Team A" and "Team B", derived from the roster ids alone. Sleeper
 * display names, usernames and avatars are never read, so there is no later step
 * where they could be forgotten.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SleeperLeague } from "@/lib/sleeper";
import {
  analyzeLeagueTrades,
  type LeagueTradeInput,
  type LeagueTradeSignalCheck,
} from "@/lib/league-signal-check";

type Client = SupabaseClient<Database>;

/** The league facts the game needs. Nothing here identifies a person. */
export interface WyrLeagueRow {
  id: string;
  name: string;
  season: number | null;
  total_rosters: number | null;
  roster_positions: unknown;
  scoring_settings: unknown;
  /** The raw Sleeper league object, as synced. */
  metadata: unknown;
}

export const WYR_LEAGUE_COLUMNS =
  "id, name, season, total_rosters, roster_positions, scoring_settings, metadata";

/**
 * The two rosters in a trade, lowest Sleeper roster id first.
 *
 * The order is not cosmetic: `lib/league-signal-check.ts` assigns side "a" to
 * the lower roster id, and the pool row pins the same pair in the same order.
 * So "Team A" names one specific roster forever, on the page, in the Discord
 * poll, and on a reload a month later.
 */
export function tradeRosterPair(
  adds: Record<string, number> | null,
  draftPicks: unknown[],
): [number, number] | null {
  const set = new Set<number>();
  for (const rid of Object.values(adds ?? {})) {
    const n = Number(rid);
    if (Number.isFinite(n)) set.add(n);
  }
  for (const p of draftPicks) {
    const owner = Number((p as { owner_id?: unknown })?.owner_id);
    if (Number.isFinite(owner)) set.add(owner);
  }
  const ids = Array.from(set).sort((x, y) => x - y);
  return ids.length === 2 ? [ids[0], ids[1]] : null;
}

/** Anonymous side labels for one trade's two rosters. */
export function anonymousRosterLabels(pair: [number, number]): Record<number, string> {
  return { [pair[0]]: "Team A", [pair[1]]: "Team B" };
}

export interface GradedBatch {
  /** Keyed by sleeper_transaction_id. Only the trades that could be graded. */
  results: Map<string, LeagueTradeSignalCheck>;
  /** The format every trade in the batch was priced in. */
  formatDisplay: string | null;
  /** Set when the league's exact format is not published and a near one stood in. */
  formatNotice: string | null;
  /** False when Signal Check is switched off site-wide. */
  enabled: boolean;
}

/**
 * Grade a batch of trades from ONE league.
 *
 * Every trade in `trades` must belong to `league`. The pipeline resolves the
 * format, the value resolver and the ruleset once for the whole batch, so
 * grading twelve trades from one league costs barely more than grading one.
 */
export async function gradeLeagueTrades(
  admin: Client,
  league: WyrLeagueRow,
  trades: Array<LeagueTradeInput & { rosterPair: [number, number] }>,
): Promise<GradedBatch> {
  const empty: GradedBatch = {
    results: new Map(),
    formatDisplay: null,
    formatNotice: null,
    enabled: false,
  };
  if (trades.length === 0) return { ...empty, enabled: true };

  const sleeperLeague = league.metadata as SleeperLeague | null;
  // A league synced before the raw payload was preserved cannot be graded: the
  // format is derived from the Sleeper settings and there is nothing to derive
  // it from. Returning empty keeps it out of the pool rather than guessing.
  if (!sleeperLeague || typeof sleeperLeague !== "object") return empty;

  // ANONYMOUS LABELS ARE PER TRADE, SO THEY ONLY GO IN ON A SINGLE-TRADE CALL.
  // The pipeline takes ONE label map for the whole batch, keyed by roster id,
  // and one roster is regularly Team A in one trade and Team B in the next. A
  // merged map would therefore label somebody wrong. The pool builder never
  // renders a side label, so it grades with no labels at all; the round loader
  // grades exactly one trade and gets the correct pair.
  const rosterLabels: Record<number, string> =
    trades.length === 1 ? anonymousRosterLabels(trades[0].rosterPair) : {};

  const analysis = await analyzeLeagueTrades(admin, {
    sleeperLeague,
    trades: trades.map(({ rosterPair: _rosterPair, ...t }) => t),
    rosterLabels,
    leagueRowId: league.id,
  });

  return {
    results: analysis.results,
    formatDisplay: analysis.formatDisplay,
    formatNotice: analysis.formatNotice,
    enabled: analysis.enabled,
  };
}
