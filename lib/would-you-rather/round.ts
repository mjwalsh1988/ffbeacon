/**
 * Building one round, and the review that follows a vote.
 *
 * THE ORDER OF OPERATIONS IS THE PRODUCT. `loadRound` returns a board with no
 * numbers on it, and `buildReview` returns everything else. The vote route runs
 * the second only after it has written a vote row. Nothing in `WyrRound` hints
 * at an answer, which is why the page can render it straight into HTML: there is
 * no verdict in the payload for a reader to go looking for.
 *
 * THE REVIEW READS THE LEAGUE, NOT THE TRADE'S FUTURE. A historical trade
 * cannot be re-simulated honestly: the players in it have already changed hands,
 * some of them twice, so "what would have happened" would be a story rather
 * than a measurement. What the league DOES still know is real and specific, and
 * that is what the reveal shows: the Signal Check verdict on the assets, each
 * player's Positional WAR in this exact league, his 30-day value movement, and
 * where each of the two teams currently stands on Power Pulse. Every figure is
 * one somebody could go and check.
 *
 * NOBODY IS NAMED, at any point on this path. Team identity is read as a roster
 * id and rendered as "Team A" or "Team B". `league_users` is never queried, and
 * the Power Pulse view's owner handle and team name are dropped rather than
 * carried into the DTO where a later change could surface them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { SleeperLeague } from "@/lib/sleeper";
import { normalizeDraftPicks } from "@/lib/league-pulse";
import { buildLeagueFormatTags, buildLeagueScoringTags } from "@/lib/league-format-tags";
import { deriveLeagueFormat, describeDerivedFormat } from "@/lib/sleeper-to-format";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { loadPowerPulseView } from "@/lib/league-power-pulse-data";
import type { WarCurvePoint } from "@/lib/positional-war/types";
import {
  BLENDED_PICKS_NOTE,
  ESTIMATED_PICKS_NOTE,
  MISSING_VALUES_NOTE,
} from "@/lib/signal-check/copy";
import type { LeagueTradeSignalCheck } from "@/lib/league-signal-check";
import { gradeLeagueTrades, tradeRosterPair, WYR_LEAGUE_COLUMNS, type WyrLeagueRow } from "./grade";
import { useTeamNames } from "./side-names";
import { compactLeagueFormat } from "./poll-text";
import type {
  WyrAsset,
  WyrReview,
  WyrRound,
  WyrSide,
  WyrTally,
  WyrTeamNote,
  WyrTrendNote,
  WyrWarNote,
} from "./types";
import type { WouldYouRatherSettings } from "./default-settings";

type Client = SupabaseClient<Database>;

/** The pool row, plus the tallies the reveal reads off it. */
export interface WyrPoolRow {
  id: string;
  league_id: string;
  transaction_id: string;
  sleeper_transaction_id: string;
  season: number | null;
  week: number | null;
  is_startup: boolean;
  side_a_roster_id: number;
  side_b_roster_id: number;
  votes_a: number;
  votes_b: number;
  discord_votes_a: number;
  discord_votes_b: number;
  served_count: number;
  /** The last grade this trade produced. See WYR_GRADE_TTL_MS. */
  graded: unknown;
  graded_at: string | null;
}

/**
 * Kept as ONE string literal rather than a concatenation on purpose: the
 * Supabase client infers the row type from the literal it is handed, and a
 * concatenated const widens to `string`, at which point every selected column
 * types as an error object.
 */
const POOL_COLUMNS =
  "id, league_id, transaction_id, sleeper_transaction_id, season, week, is_startup, side_a_roster_id, side_b_roster_id, votes_a, votes_b, discord_votes_a, discord_votes_b, served_count, graded, graded_at";

/** Everything one loaded round carries. The graded half never leaves the server. */
export interface LoadedRound {
  pool: WyrPoolRow;
  league: WyrLeagueRow;
  graded: LeagueTradeSignalCheck;
  round: WyrRound;
  /**
   * Set when the league's own format has no published FF Beacon values and a
   * near one stood in. It has to reach the reader: the reveal otherwise prints
   * a confident margin and a format chip naming a format that is not the
   * league's, with nothing saying so.
   *
   * Null on the cached-grade path, because the notice belongs to the grading
   * run rather than to the trade. A cached round therefore omits it, which is
   * why the notice is also stored alongside the grade.
   */
  formatNotice: string | null;
}

/**
 * How long a stored grade is served before it is recomputed.
 *
 * Grading one trade costs about fifteen round trips, and it was being run twice
 * per round: once by the page that draws the board, and again seconds later by
 * the vote route that draws the reveal, for a result that depends on nothing
 * about the reader. An hour collapses that pair completely and every repeat
 * view inside the hour.
 *
 * It is an hour rather than a day because a reader is being shown a GRADE. The
 * values behind it move on the nightly sync, so a longer window would risk the
 * reveal disagreeing with what /tools/signal-check says about the same trade at
 * the same moment, which is a small lie for a large saving. Same TTL as
 * LEAGUE_PULSE_TTL_MS, for the same kind of reason.
 */
export const WYR_GRADE_TTL_MS = 60 * 60 * 1000;

/** What is stored in would_you_rather_trades.graded. */
interface StoredGrade {
  result: LeagueTradeSignalCheck;
  formatNotice: string | null;
}

function readStoredGrade(pool: WyrPoolRow, now: number): StoredGrade | null {
  if (!pool.graded || !pool.graded_at) return null;
  const at = Date.parse(pool.graded_at);
  if (!Number.isFinite(at) || now - at > WYR_GRADE_TTL_MS) return null;
  const stored = pool.graded as Partial<StoredGrade>;
  // A row written by an older shape, or half-written, is treated as absent
  // rather than trusted: the fallback is a fresh grade, which is always correct.
  if (!stored?.result?.view?.sides) return null;
  return { result: stored.result, formatNotice: stored.formatNotice ?? null };
}

// ---------------------------------------------------------------------------
// Choosing which trade to show
// ---------------------------------------------------------------------------

/** How many pool rows one selection attempt reads. */
const SELECT_WINDOW = 80;

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Which trades this voter has already called.
 *
 * Capped rather than unbounded: it is a de-duplication hint for the selector,
 * not a correctness boundary. The unique indexes on the votes table are what
 * actually stop a second vote, so a voter past the cap can at worst be offered a
 * trade they have already seen, and the vote route then tells them so.
 */
export async function loadVotedTradeIds(
  admin: Client,
  voter: { userId: string | null; guestId: string | null },
): Promise<Set<string>> {
  if (!voter.userId && !voter.guestId) return new Set();
  let query = admin
    .from("would_you_rather_votes")
    .select("trade_id")
    .order("created_at", { ascending: false })
    .limit(1000);
  query = voter.userId
    ? query.eq("user_id", voter.userId)
    : query.eq("guest_id", voter.guestId as string);
  const { data } = await query;
  return new Set((data ?? []).map((r) => r.trade_id));
}

/**
 * Pick the next trade for this voter.
 *
 * Two passes, and they want different things. The first prefers trades nobody
 * has seen much, so a freshly pooled trade collects votes instead of sitting at
 * zero forever. The second is a uniform random window, so a voter who has
 * already worked through the least-served end still gets somewhere new to go.
 *
 * This is the GAME page's selector, and it does not filter by league type. The
 * Discord poster has its own pick in lib/would-you-rather/discord.ts, which
 * wants different things (what Discord has not posted lately, rather than what
 * this reader has not voted on).
 */
export async function selectTradeId(
  admin: Client,
  voted: Set<string>,
): Promise<string | null> {
  const { data: leastServed } = await admin
    .from("would_you_rather_trades")
    .select("id")
    .eq("status", "active")
    .order("served_count", { ascending: true })
    .order("added_at", { ascending: true })
    .limit(SELECT_WINDOW);
  const fresh = (leastServed ?? []).map((r) => r.id).filter((id) => !voted.has(id));
  const first = pickRandom(fresh);
  if (first) return first;

  const { count } = await admin
    .from("would_you_rather_trades")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (!count || count === 0) return null;

  const offset = Math.floor(Math.random() * Math.max(1, count - SELECT_WINDOW + 1));
  const { data: window } = await admin
    .from("would_you_rather_trades")
    .select("id")
    .eq("status", "active")
    .order("id")
    .range(offset, offset + SELECT_WINDOW - 1);
  return pickRandom((window ?? []).map((r) => r.id).filter((id) => !voted.has(id)));
}

/**
 * Record that a trade was shown.
 *
 * Best effort on purpose: this is only how the selector spreads rounds around
 * the pool, so a failed write costs a slightly less even distribution and
 * nothing else. It must never be the reason a reader cannot play.
 */
export async function markServed(admin: Client, pool: WyrPoolRow): Promise<void> {
  // The Supabase client reports a failed write as `{ error }` rather than by
  // throwing, so a try/catch here would have caught nothing and swallowed the
  // one signal there is. Logged and carried on: a lost serve count is a slightly
  // less even distribution, never a reader who cannot play.
  const { error } = await admin
    .from("would_you_rather_trades")
    .update({
      served_count: pool.served_count + 1,
      last_served_at: new Date().toISOString(),
    })
    .eq("id", pool.id);
  if (error) {
    console.warn("[would-you-rather] could not record a serve", error.message);
  }
}

// ---------------------------------------------------------------------------
// Loading a round
// ---------------------------------------------------------------------------

/**
 * Load and grade one pooled trade.
 *
 * Returns null when the trade can no longer be built: its league was deleted,
 * its transaction row went away on a resync, or Signal Check now refuses it
 * (a value source went dark). A caller's job in that case is to pick another
 * trade, not to show a broken board.
 */
export async function loadRound(admin: Client, tradeId: string): Promise<LoadedRound | null> {
  const { data: pool } = await admin
    .from("would_you_rather_trades")
    .select(POOL_COLUMNS)
    .eq("id", tradeId)
    .eq("status", "active")
    .maybeSingle();
  if (!pool) return null;
  const poolRow = pool as WyrPoolRow;

  const [{ data: league }, { data: tx }] = await Promise.all([
    admin.from("leagues").select(WYR_LEAGUE_COLUMNS).eq("id", poolRow.league_id).maybeSingle(),
    admin
      .from("league_transactions")
      .select("adds, draft_picks, created_at_sleeper, season, week")
      .eq("id", poolRow.transaction_id)
      .maybeSingle(),
  ]);
  if (!league || !league.name || !tx) return null;

  const adds = (tx.adds ?? null) as Record<string, number> | null;
  const picks = normalizeDraftPicks(tx.draft_picks);
  const pair = tradeRosterPair(adds, picks);
  if (!pair) return null;

  // The cached grade first. It is the same computation for every reader, so the
  // only question is whether it is fresh enough (see WYR_GRADE_TTL_MS).
  const now = Date.now();
  const cached = readStoredGrade(poolRow, now);
  let result: LeagueTradeSignalCheck;
  let formatNotice: string | null;

  if (cached) {
    result = cached.result;
    formatNotice = cached.formatNotice;
  } else {
    const graded = await gradeLeagueTrades(admin, league as WyrLeagueRow, [
      {
        sleeperTransactionId: poolRow.sleeper_transaction_id,
        adds,
        draftPicks: picks,
        createdAtSleeper: tx.created_at_sleeper,
        rosterPair: pair,
      },
    ]);
    const fresh = graded.results.get(poolRow.sleeper_transaction_id);
    if (!fresh) return null;
    result = fresh;
    formatNotice = graded.formatNotice;
    void storeGrade(admin, poolRow.id, { result, formatNotice }, now);
  }

  const sleeperLeague = league.metadata as SleeperLeague;
  const round: WyrRound = {
    tradeId: poolRow.id,
    leagueName: league.name,
    season: poolRow.season ?? league.season ?? null,
    week: poolRow.week,
    derivedLabel: describeDerivedFormat(deriveLeagueFormat(sleeperLeague)),
    formatShort: compactLeagueFormat({
      metadata: league.metadata,
      total_rosters: league.total_rosters,
      roster_positions: league.roster_positions,
    }),
    formatTags: buildLeagueFormatTags({
      rosterPositions: league.roster_positions,
      scoringSettings: league.scoring_settings,
      teamCount: league.total_rosters,
    }),
    scoringTags: buildLeagueScoringTags(league.scoring_settings),
    kind: result.startup ? "startup" : "regular",
    startupSeason: result.startup?.season ?? null,
    startupTimingLabel: result.startup?.timingLabel ?? null,
    tradedAt: tx.created_at_sleeper,
    sides: {
      a: assetsForSide(result, "a"),
      b: assetsForSide(result, "b"),
    },
  };

  return {
    pool: poolRow,
    league: league as WyrLeagueRow,
    graded: result,
    round,
    formatNotice,
  };
}

/**
 * Write a fresh grade back onto the pool row.
 *
 * Deliberately not awaited by `loadRound`: it is a cache fill, and a reader
 * waiting on it would pay for the next reader's saving. A failure means the
 * next load grades again, which is exactly what it would have done anyway.
 */
async function storeGrade(
  admin: Client,
  tradeId: string,
  grade: StoredGrade,
  now: number,
): Promise<void> {
  const { error } = await admin
    .from("would_you_rather_trades")
    .update({
      graded: grade as unknown as Json,
      graded_at: new Date(now).toISOString(),
    })
    .eq("id", tradeId);
  if (error) {
    console.warn("[would-you-rather] could not cache a grade", error.message);
  }
}

/**
 * The pick label, with the bookkeeping taken off.
 *
 * Signal Check writes "Draft pick (mid, projected)" and "Draft pick, slot
 * unknown", which are exactly right on a tool where a reader is auditing how a
 * number was reached. On the board they are noise: somebody is being asked to
 * judge a trade, not our slotting method, and "projected" invites a question the
 * board deliberately will not answer yet.
 *
 * The SLOT survives, because early against late is worth about 22% of a first
 * and is real information for the call being made. Only the qualifier goes. The
 * full label and its footnote are still on the verdict card after the vote,
 * which is where the audit belongs.
 */
function boardDetail(detail: string | null): string | null {
  if (!detail) return detail;
  if (detail === "Draft pick, slot unknown") return "Draft pick";
  return detail.replace(", projected)", ")");
}

/**
 * The value-free view of one side.
 *
 * `name` and `detail` come off the graded view because that is where the
 * startup substitutions have already been applied: a pick that became a player
 * shows the player. `value` is deliberately not read.
 */
function assetsForSide(result: LeagueTradeSignalCheck, side: WyrSide): WyrAsset[] {
  const view = result.view.sides.find((s) => s.side === side);
  const meta = result.assetMeta[side] ?? [];
  return (view?.assets ?? []).map((asset, index) => {
    const m = meta[index];
    const kind: "player" | "pick" =
      m?.kind ?? (asset.detail?.toLowerCase().startsWith("draft pick") ? "pick" : "player");
    return {
      key: `${side}-${index}`,
      kind,
      name: asset.name,
      detail: boardDetail(asset.detail),
      sleeperId: m?.sleeperId ?? null,
      round: m?.round ?? null,
      pickSeason: m?.season ?? null,
      pickSlot: m?.pickPosition ?? null,
      startupPick: m?.startupPick ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// The reveal
// ---------------------------------------------------------------------------

/** Whole percentages that add to 100, with the rounding error given to the bigger side. */
export function tallyOf(pool: WyrPoolRow): WyrTally {
  const a = pool.votes_a + pool.discord_votes_a;
  const b = pool.votes_b + pool.discord_votes_b;
  const total = a + b;
  if (total === 0) {
    return { a, b, total, discordA: pool.discord_votes_a, discordB: pool.discord_votes_b, pctA: 0, pctB: 0 };
  }
  const rawA = (a / total) * 100;
  let pctA = Math.round(rawA);
  let pctB = 100 - pctA;
  // Rounding can produce 50/50 for a genuinely uneven split, which contradicts
  // the counts printed beside it. Nudge the bigger side up by one when that
  // happens, so the bar and the numbers always tell the same story.
  if (pctA === pctB && a !== b) {
    if (a > b) {
      pctA = 51;
      pctB = 49;
    } else {
      pctA = 49;
      pctB = 51;
    }
  }
  return { a, b, total, discordA: pool.discord_votes_a, discordB: pool.discord_votes_b, pctA, pctB };
}

/**
 * One sentence on where the crowd landed against where the model did.
 *
 * A deterministic template. Every figure in it appears elsewhere on the same
 * screen, so a reader can check it; nothing is generated and nothing fires
 * without the number it would cite.
 */
export function crowdVsModelSentence(
  tally: WyrTally,
  view: LeagueTradeSignalCheck["view"] | null,
): string | null {
  if (!view) return null;
  if (tally.total === 0) return null;
  if (tally.total === 1) {
    return "You are the first vote on this trade, so there is no crowd to compare with yet.";
  }

  const crowdSide: WyrSide | null = tally.a === tally.b ? null : tally.a > tally.b ? "a" : "b";
  const crowdPct = Math.max(tally.pctA, tally.pctB);
  const crowdLabel = crowdSide === "a" ? "Team A" : "Team B";
  const modelLabel = view.winnerSide === "a" ? "Team A" : "Team B";
  const votes = `${tally.total.toLocaleString()} vote${tally.total === 1 ? "" : "s"}`;

  if (view.isNeutral) {
    return crowdSide === null
      ? `Signal Check has this one even, at ${view.marginPct}% apart, and so does the room: the ${votes} split down the middle.`
      : `Signal Check has this one even, at ${view.marginPct}% apart. The room was less sure, with ${crowdPct}% of ${votes} on ${crowdLabel}.`;
  }
  if (crowdSide === null) {
    return `The room is split exactly in half across ${votes}. Signal Check is not: it has ${modelLabel} ahead by ${view.marginPct}% on value.`;
  }
  if (crowdSide === view.winnerSide) {
    return `The room and Signal Check agree. ${crowdPct}% of ${votes} picked ${crowdLabel}, and the values have ${modelLabel} ahead by ${view.marginPct}%.`;
  }
  return `The room and Signal Check disagree. ${crowdPct}% of ${votes} picked ${crowdLabel}, but on value ${modelLabel} comes out ahead by ${view.marginPct}%.`;
}

/** The footnotes the verdict card carries, in the order they are shown. */
function verdictNotes(
  result: LeagueTradeSignalCheck,
  formatNotice: string | null,
): string[] {
  const notes: string[] = [];
  const { view, startup } = result;
  // FIRST, because it qualifies every figure below it. Without it the reveal
  // prints a confident margin and a format chip naming a format that is not
  // this league's, and nothing says the substitution happened.
  if (formatNotice) notes.push(formatNotice);
  if (view.hasMissingValues) notes.push(MISSING_VALUES_NOTE);
  if (view.hasEstimatedPicks) notes.push(ESTIMATED_PICKS_NOTE);
  if (view.hasBlendedPicks) notes.push(BLENDED_PICKS_NOTE);
  if (startup) {
    if (startup.resolvedCount > 0) {
      notes.push(
        startup.resolvedCount === 1
          ? "One pick in this trade is valued as the player actually drafted with it."
          : `${startup.resolvedCount} picks in this trade are valued as the players actually drafted with them.`,
      );
    }
    if (startup.simulatedCount > 0) {
      notes.push(
        startup.simulatedCount === 1
          ? "One pick has not been made yet and is valued as the player expected at that slot."
          : `${startup.simulatedCount} picks have not been made yet and are valued as the players expected at those slots.`,
      );
    }
    notes.push(
      "Values are current, so this reads how the deal looks now rather than on the day it was made.",
    );
  }
  return notes;
}

/** Positional WAR for every traded player, read from this league's own curves. */
async function loadWarNotes(
  admin: Client,
  leagueRowId: string,
  season: number | null,
  bySleeperId: Map<string, string[]>,
): Promise<{ notes: Record<string, WyrWarNote>; leagueHasCurves: boolean }> {
  // Every position's curve is several kilobytes of jsonb, and a six-position
  // league is about 35kB to extract at most six players from. The positions in
  // the trade are not known here (the curve is what says who plays where), so
  // this reads them all and the narrowing lives in the caller's season filter.
  // Left as one query on purpose: two would be a round trip to save bytes.
  const out: Record<string, WyrWarNote> = {};
  if (season === null || bySleeperId.size === 0) {
    return { notes: out, leagueHasCurves: false };
  }

  const { data } = await admin
    .from("league_positional_war_cache")
    .select("position, structural_demand, curve")
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (!data) return { notes: out, leagueHasCurves: false };

  for (const row of data) {
    const curve = row.curve as unknown as WarCurvePoint[] | null;
    if (!Array.isArray(curve)) continue;
    for (const point of curve) {
      if (!point.sleeperId) continue;
      const keys = bySleeperId.get(point.sleeperId);
      if (!keys) continue;
      for (const key of keys) {
        out[key] = {
          position: row.position,
          positionRank: point.positionRank,
          structuralDemand: row.structural_demand,
          war: point.war,
          pointsAboveReplacement: point.pointsAboveReplacement,
          projectedPointsPerWeek: point.projectedPointsPerWeek,
          replacementPointsPerWeek: point.replacementPointsPerWeek,
          weeksProjected: point.weeksProjected,
          injuryStatus: point.injuryStatus,
        };
      }
    }
  }
  // Whether the LEAGUE has curves, which is read off the query rather than off
  // the players that matched. A league with six curves none of whose players are
  // in this trade still has curves, and the UI says something different in that
  // case than it does for a league that has none.
  return { notes: out, leagueHasCurves: data.length > 0 };
}

/** 30-day value movement for every traded player, in the league's own format. */
async function loadTrendNotes(
  admin: Client,
  formatConfigId: string | null,
  sourceSlug: string | null,
  byPlayerId: Map<string, string[]>,
): Promise<Record<string, WyrTrendNote>> {
  const out: Record<string, WyrTrendNote> = {};
  if (!formatConfigId || !sourceSlug || byPlayerId.size === 0) return out;

  const { data } = await admin
    .from("player_value_trends")
    .select(
      "player_id, current_value, change_30d, show_trend_30d, rank_30d_ago, rank_change_30d",
    )
    .eq("format_config_id", formatConfigId)
    .eq("source", sourceSlug)
    .in("player_id", Array.from(byPlayerId.keys()));
  if (!data) return out;

  for (const row of data) {
    const keys = byPlayerId.get(row.player_id);
    if (!keys) continue;
    // show_trend_30d is the table's own honesty flag: it is false when there is
    // not enough history behind the window. A number is shown only when the
    // data behind it is real, and the absence renders as an absence.
    const change = row.show_trend_30d ? row.change_30d : null;
    const rankNow =
      row.show_trend_30d && row.rank_30d_ago !== null && row.rank_change_30d !== null
        ? row.rank_30d_ago - row.rank_change_30d
        : null;
    for (const key of keys) {
      out[key] = { value: row.current_value, change30d: change, overallRank: rankNow };
    }
  }
  return out;
}

/** Where each of the two teams stands, stripped of every name. */
function teamNotes(
  view: Awaited<ReturnType<typeof loadPowerPulseView>>,
  pool: WyrPoolRow,
): WyrTeamNote[] | null {
  if (!view || view.teams.length === 0) return null;
  const teamCount = view.teams.length;
  const pick = (rosterId: number, side: WyrSide): WyrTeamNote | null => {
    const team = view.teams.find((t) => t.sleeperRosterId === rosterId);
    if (!team) return null;
    // Only these fields. teamName and ownerHandle are deliberately not copied:
    // the DTO cannot leak what it never holds.
    return {
      side,
      record: team.record,
      powerPulse: team.powerPulse,
      pulseRank: team.pulseRank,
      projectedWins: team.projectedWins,
      projectedLosses: team.projectedLosses,
      playoffOdds: team.playoffOdds,
      titleOdds: team.titleOdds,
      valueRank: team.valueRank,
      statusLabel: team.status?.label ?? null,
      statusReason: team.status?.reason ?? null,
      teamCount,
    };
  };
  const notes = [pick(pool.side_a_roster_id, "a"), pick(pool.side_b_roster_id, "b")].filter(
    (n): n is WyrTeamNote => n !== null,
  );
  return notes.length === 2 ? notes : null;
}

/**
 * Everything revealed after the vote.
 *
 * Never throws. Each block of context is optional and independent, so a league
 * with no Power Pulse rows still gets its verdict and its Positional WAR, and a
 * failure in one read leaves the rest of the reveal standing.
 */
export async function buildReview(
  admin: Client,
  loaded: LoadedRound,
  params: {
    yourSide: WyrSide;
    alreadyVoted: boolean;
    settings: WouldYouRatherSettings;
    /** The tally AFTER this vote was written. */
    pool: WyrPoolRow;
  },
): Promise<WyrReview> {
  const { pool, settings } = params;
  const tally = tallyOf(pool);
  const showVerdict = settings.reveal.show_signal_check;
  // The two sentences Signal Check writes call the parties "Side A" and
  // "Side B". On this surface they have no other name, so they are renamed to
  // match the rest of the page. See lib/would-you-rather/side-names.ts.
  const view = showVerdict
    ? {
        ...loaded.graded.view,
        verdictLabel: useTeamNames(loaded.graded.view.verdictLabel),
        explanation: useTeamNames(loaded.graded.view.explanation),
      }
    : null;

  // Join keys for the two per-player lookups. A player can appear on both sides
  // of the same trade only in pathological data, so keys are collected as lists
  // rather than assumed unique.
  const bySleeperId = new Map<string, string[]>();
  const byPlayerId = new Map<string, string[]>();
  for (const side of ["a", "b"] as WyrSide[]) {
    const meta = loaded.graded.assetMeta[side] ?? [];
    loaded.round.sides[side].forEach((asset, index) => {
      if (asset.sleeperId) {
        const list = bySleeperId.get(asset.sleeperId);
        if (list) list.push(asset.key);
        else bySleeperId.set(asset.sleeperId, [asset.key]);
      }
      const playerId = meta[index]?.playerId ?? null;
      if (playerId) {
        const list = byPlayerId.get(playerId);
        if (list) list.push(asset.key);
        else byPlayerId.set(playerId, [asset.key]);
      }
    });
  }

  const season = loaded.round.season;
  const sleeperLeague = loaded.league.metadata as SleeperLeague;

  // The value context is resolved with no user source preference, so the reveal
  // is the same for every reader. This is a shared surface, not a personal one.
  const context = await resolveLeagueContext(admin, sleeperLeague, null).catch(() => null);
  const formatConfigId =
    context && context.coverage !== "none" ? context.formatConfigId : null;
  const sourceSlug = context ? context.sourceSlug : null;

  const [war, trends, pulse] = await Promise.all([
    settings.reveal.show_positional_war
      ? loadWarNotes(admin, loaded.league.id, season, bySleeperId).catch(() => ({
          notes: {} as Record<string, WyrWarNote>,
          leagueHasCurves: false,
        }))
      : Promise.resolve(null),
    settings.reveal.show_value_trends
      ? loadTrendNotes(admin, formatConfigId, sourceSlug, byPlayerId).catch(() => ({}))
      : Promise.resolve({} as Record<string, WyrTrendNote>),
    settings.reveal.show_team_context && season !== null
      ? loadPowerPulseView(admin, loaded.league.id, season, formatConfigId, sourceSlug).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);

  return {
    tradeId: loaded.pool.id,
    yourSide: params.yourSide,
    alreadyVoted: params.alreadyVoted,
    tally: settings.reveal.show_community_results
      ? tally
      : { ...tally, a: 0, b: 0, total: 0, discordA: 0, discordB: 0, pctA: 0, pctB: 0 },
    verdict: view,
    crowdVsModel: settings.reveal.show_community_results
      ? crowdVsModelSentence(tally, view)
      : null,
    war: war?.notes ?? {},
    // Null, not false, when the block is switched off. "The admin hid this" and
    // "this league has none" are different answers and the UI must not print
    // one for the other.
    leagueHasWarCurves: war ? war.leagueHasCurves : null,
    trends,
    teams: teamNotes(pulse, pool),
    notes: showVerdict ? verdictNotes(loaded.graded, loaded.formatNotice) : [],
  };
}

/**
 * The smallest honest reveal.
 *
 * Used when the vote HAS been written and building the full review then threw.
 * Reporting that as a failure would tell the reader "nothing was recorded" about
 * a vote that is on record, and their retry would land on a different trade with
 * the first one silently counted. This says what is certainly true (their vote,
 * and the tally) and omits the rest rather than inventing it.
 */
export function minimalReview(
  loaded: LoadedRound,
  pool: WyrPoolRow,
  yourSide: WyrSide,
  alreadyVoted: boolean,
): WyrReview {
  return {
    tradeId: loaded.pool.id,
    yourSide,
    alreadyVoted,
    tally: tallyOf(pool),
    verdict: null,
    crowdVsModel: null,
    war: {},
    leagueHasWarCurves: null,
    trends: {},
    teams: null,
    notes: [],
  };
}

/** Re-read the tallies after a vote so the reveal shows the reader's own vote. */
export async function reloadPool(admin: Client, tradeId: string): Promise<WyrPoolRow | null> {
  const { data } = await admin
    .from("would_you_rather_trades")
    .select(POOL_COLUMNS)
    .eq("id", tradeId)
    .maybeSingle();
  return (data as WyrPoolRow | null) ?? null;
}
