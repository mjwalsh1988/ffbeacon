"use server";

/**
 * Trade Finder's server calls.
 *
 * Find a shortlist of deals in one league, find one across a reader's whole
 * portfolio, record a pass, and bookmark or un-bookmark a trade. Server actions
 * rather than route handlers because none of these has a shareable URL or a
 * cacheable answer; the reader presses a button, we answer, and the answer is
 * worth nothing to anyone else.
 *
 * WHY A SHORTLIST RATHER THAN ONE DEAL
 *   The engine ranks the whole field to know which trade is best, and this used
 *   to return only the winner. That left the surface with no way forward except
 *   "Not interested", so a reader who merely wanted to look past something had
 *   to declare it refused. Returning a window of the ranking makes Previous and
 *   Next pure client state: no round trip, no rate-limit pressure, and no
 *   two-second wait to see the deal that was already computed.
 *
 * WHAT IS TRUSTED AND WHAT IS NOT
 *   Nothing in the arguments is trusted as an identity. The signed-in user comes
 *   from the session cookie, the rate-limit key is derived server-side from that
 *   session or from the platform's own IP headers, and the pass row is written
 *   with the session's user id under a policy that would reject any other.
 *
 *   The league ids ARE taken from the caller, and that grants nothing: rosters
 *   are public under RLS and the public league page already renders any league's
 *   rosters to anyone who asks. Passing a league id you are not in tells you
 *   what /leagues/<id> would have told you anyway, and the engine can only
 *   produce a suggestion for a roster it can match to you.
 *
 * COST CONTROL
 *   The league call opens one league. The portfolio call opens at most three.
 *   Both sit behind a durable per-actor limit, because both do real work
 *   (rosters, projections, and a few hundred lineup fills) and neither is
 *   cacheable.
 */

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { resolveSourceSlug } from "@/lib/preferences";
import { findTrades } from "@/lib/trade-finder/engine";
import { loadTradeFinderLeague } from "@/lib/trade-finder-data";
import {
  findCrossLeagueTrade,
  MAX_CROSS_LEAGUES,
  type CrossLeagueSuggestion,
} from "@/lib/trade-finder-cross-league";
import {
  loadDeclinedKeys,
  loadDeclinedKeysForLeagues,
  recordDecline,
} from "@/lib/trade-finder-declines";
import { gradeSuggestions, type SuggestionGrade } from "@/lib/trade-finder-grade";
import {
  loadSavedKeys,
  loadSavedTrades,
  removeSavedTrade,
  saveTrade,
  type SavedTrade,
} from "@/lib/trade-finder-saves";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import {
  DEFAULT_TRADE_QUALITY_CONFIG,
  type TradeQualityConfig,
} from "@/lib/trade-quality";
import { isValidSuggestionKey } from "@/lib/trade-finder/fingerprint";
import {
  TRADE_GOALS,
  TRADE_POSITIONS,
  readTradePosition,
  type TradeGoal,
  type TradePosition,
  type TradeSuggestion,
} from "@/lib/trade-finder/types";

/** Sleeper ids are its own long numeric strings; usernames are short handles. */
const SLEEPER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Passes a client may carry for one visit. Well past any real session. */
const MAX_SESSION_EXCLUDED = 200;

/**
 * The per-actor limits.
 *
 * Sized against measured cost rather than picked round. One league search is
 * roughly 2.3 seconds of database work (rosters, values, projections, and a few
 * hundred lineup fills), so twelve a minute is about 28 seconds of database time
 * per actor per minute. That is generous for a human pressing a button every few
 * seconds and thin enough that one caller cannot sit on the database.
 *
 * The portfolio limit is a third of it because each press opens up to FOUR
 * leagues: four a minute is about 37 seconds, the same order of magnitude. It
 * was six against a three-league window, and the window widened so that a reader
 * with four leagues sees all of them in one press rather than the same league
 * repeatedly. Keeping the old number would have raised the per-actor ceiling by
 * three quarters as a side effect of a change that was about coverage.
 *
 * The league surface is public, so its limit is the one that matters most.
 */
const RATE_WINDOW_SECONDS = 60;
const LEAGUE_RATE_MAX = 12;
const PORTFOLIO_RATE_MAX = 4;

const GOAL_KEYS = new Set(TRADE_GOALS.map((g) => g.key));

/**
 * The consolidation model, read from the same admin settings Signal Check uses.
 *
 * The finder builds packages on it and Signal Check grades the winner with it,
 * so if they read different coefficients the card would show a suggestion and a
 * grade that disagree for no reason a reader could ever discover. One indexed
 * beacon_settings query, behind the admin client because those rows are
 * service-role only. A failed read falls back to the published defaults rather
 * than taking the feature down.
 */
async function loadTradeQualityConfig(
  admin: ReturnType<typeof createAdminClient>,
): Promise<TradeQualityConfig> {
  try {
    const settings = await loadSignalCheckSettings(admin);
    return settings.qualityEnabled ? settings.quality : DEFAULT_TRADE_QUALITY_CONFIG;
  } catch {
    return DEFAULT_TRADE_QUALITY_CONFIG;
  }
}

/**
 * How much of the ranking is sent to the browser.
 *
 * Twelve is past what anyone pages through in one sitting and small enough that
 * the payload stays around twenty kilobytes and the grading batch stays one
 * round of lookups. The engine still ranks forty; this is a transport decision,
 * not a ranking one, and anything past it is reported honestly rather than
 * pretended away.
 */
const SUGGESTION_WINDOW = 12;

export type TradeFinderMeta = {
  leagueName: string;
  formatDisplay: string;
  sourceDisplay: string;
  pickSourceDisplay: string | null;
  /** Counterparties the engine could evaluate. */
  consideredTeams: number;
  /** True when no projections exist, so lineup impact is unavailable. */
  lineupUnavailable: boolean;
  /** Ranked deals past the window we sent. */
  beyondWindow: number;
};

export type TradeFinderResponse =
  | {
      ok: true;
      suggestions: TradeSuggestion[];
      /** Aligned by index with `suggestions`. Null where a grade would be a guess. */
      grades: (SuggestionGrade | null)[];
      /** Keys this reader has already bookmarked, so the button opens correct. */
      savedKeys: string[];
      meta: TradeFinderMeta;
    }
  | { ok: false; error: string };

export type PortfolioResponse =
  | {
      ok: true;
      suggestions: CrossLeagueSuggestion[];
      grades: (SuggestionGrade | null)[];
      savedKeys: string[];
      cursor: number;
      examined: number;
      remaining: number;
      unreadable: number;
    }
  | { ok: false; error: string };

export type SaveTradeResponse = { ok: true } | { ok: false; error: string };

export type SavedTradesResponse =
  | { ok: true; saved: SavedTrade[] }
  | { ok: false; error: string };

function readGoal(value: unknown): TradeGoal {
  return typeof value === "string" && GOAL_KEYS.has(value as TradeGoal)
    ? (value as TradeGoal)
    : "balanced";
}

function readKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isValidSuggestionKey)
    .slice(0, MAX_SESSION_EXCLUDED);
}

function readPlayerId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/**
 * The position groups a caller named, normalised and deduplicated.
 *
 * Bounded by the six that exist, so a caller cannot widen the search by posting
 * a list, and returned in the fixed display order so the same two groups always
 * produce the same rationale sentence whichever order they arrived in.
 */
function readPositions(value: unknown): TradePosition[] {
  if (!Array.isArray(value)) return [];
  const found = new Set<TradePosition>();
  for (const raw of value) {
    const position = readTradePosition(raw);
    if (position) found.add(position);
  }
  return TRADE_POSITIONS.filter((p) => found.has(p));
}

/**
 * The durable per-actor limit.
 *
 * The mechanism lives in lib/rate-limit-claim.ts, because a server RENDERED path
 * needs the identical guard and two copies of a limiter is how one of them ends
 * up with the wrong window. It fails closed there, for the reason stated there.
 */
async function claimSlot(bucket: string, max: number): Promise<boolean> {
  return claimRateLimitSlot({ bucket, max, windowSeconds: RATE_WINDOW_SECONDS });
}

/**
 * The next suggestion inside one league.
 *
 * Public, like the league deep view it sits on. A signed-in reader's passes come
 * from the database; a signed-out one's arrive in `sessionExcluded` from the
 * component holding them for the visit.
 */
export async function findLeagueTrade(input: {
  sleeperLeagueId: string;
  username?: string | null;
  rosterId?: number | null;
  source?: string | null;
  goal?: string;
  targetPlayerId?: string | null;
  offerPlayerId?: string | null;
  /** Position groups the incoming side must contain at least one of. */
  wantPositions?: string[];
  /** Position groups the outgoing side must contain at least one of. */
  givePositions?: string[];
  sessionExcluded?: string[];
}): Promise<TradeFinderResponse> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (!SLEEPER_ID_PATTERN.test(sleeperLeagueId)) {
    return { ok: false, error: "Invalid league id" };
  }

  if (!(await claimSlot("trade_finder_league", LEAGUE_RATE_MAX))) {
    return {
      ok: false,
      error: "That is a lot of searching in one minute. Give it a moment and try again.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const resolvedSource = await resolveSourceSlug(supabase, input.source ?? undefined);
  const league = await loadTradeFinderLeague(supabase, {
    sleeperLeagueId,
    sourceSlug: resolvedSource.slug,
    identity: {
      username:
        typeof input.username === "string" && input.username.trim()
          ? input.username.trim()
          : null,
      rosterId:
        typeof input.rosterId === "number" && Number.isFinite(input.rosterId)
          ? input.rosterId
          : null,
    },
  });

  if (!league) {
    return {
      ok: false,
      error:
        "This league has not been synced yet, or no value source covers its format. Open the league page first.",
    };
  }
  if (league.myRosterId === null) {
    return {
      ok: false,
      error: "We could not work out which team in this league is yours.",
    };
  }

  const stored = user ? await loadDeclinedKeys(supabase, sleeperLeagueId) : [];
  const sessionExcluded = readKeys(input.sessionExcluded);
  const admin = createAdminClient();
  const qualityConfig = await loadTradeQualityConfig(admin);

  const result = findTrades({
    myRosterId: league.myRosterId,
    teams: league.teams,
    startingSlots: league.startingSlots,
    isDynasty: league.isDynasty,
    allowPicks: league.allowPicks,
    goal: readGoal(input.goal),
    targetPlayerId: readPlayerId(input.targetPlayerId),
    offerPlayerId: readPlayerId(input.offerPlayerId),
    wantPositions: readPositions(input.wantPositions),
    givePositions: readPositions(input.givePositions),
    excludeKeys: [...stored, ...sessionExcluded],
    quality: { config: qualityConfig, poolMax: league.poolMax },
  });

  const suggestions = result.suggestions.slice(0, SUGGESTION_WINDOW);
  // One batch of value lookups for the whole window, not one per suggestion.
  const grades = await gradeSuggestions(admin, league.sleeperLeague, suggestions);
  const savedKeys = user ? await loadSavedKeys(supabase) : [];

  return {
    ok: true,
    suggestions,
    grades,
    savedKeys,
    meta: {
      leagueName: league.leagueName,
      formatDisplay: league.formatDisplay,
      sourceDisplay: league.sourceDisplay,
      pickSourceDisplay: league.pickSourceDisplay,
      consideredTeams: result.consideredTeams,
      lineupUnavailable: result.lineupUnavailable,
      beyondWindow: Math.max(0, result.suggestions.length - suggestions.length),
    },
  };
}

/**
 * The next suggestion across every league this reader is in.
 *
 * Members only: it needs a Sleeper identity to know which roster is theirs in
 * each room, and the pass list it walks is per user.
 */
export async function findPortfolioTrade(input: {
  sleeperLeagueIds: string[];
  sleeperUserId: string | null;
  source?: string | null;
  goal?: string;
  cursor?: number;
  sessionExcluded?: string[];
}): Promise<PortfolioResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const sleeperUserId =
    typeof input.sleeperUserId === "string" &&
    SLEEPER_ID_PATTERN.test(input.sleeperUserId)
      ? input.sleeperUserId
      : null;
  if (!sleeperUserId) {
    return { ok: false, error: "Save your Sleeper username first." };
  }

  const sleeperLeagueIds = (
    Array.isArray(input.sleeperLeagueIds) ? input.sleeperLeagueIds : []
  )
    .filter((id): id is string => typeof id === "string")
    .filter((id) => SLEEPER_ID_PATTERN.test(id))
    .slice(0, MAX_CROSS_LEAGUES);
  if (sleeperLeagueIds.length === 0) {
    return { ok: false, error: "No leagues to search" };
  }

  if (!(await claimSlot("trade_finder_portfolio", PORTFOLIO_RATE_MAX))) {
    return {
      ok: false,
      error: "That is a lot of searching in one minute. Give it a moment and try again.",
    };
  }

  const resolvedSource = await resolveSourceSlug(supabase, input.source ?? undefined);
  const excludeByLeague = await loadDeclinedKeysForLeagues(supabase, sleeperLeagueIds);
  // One admin client for the walk: the quality config and the grade both need
  // service-role reads, and building two of them per press buys nothing.
  const admin = createAdminClient();

  const cursor =
    typeof input.cursor === "number" && Number.isFinite(input.cursor)
      ? Math.max(0, Math.trunc(input.cursor))
      : 0;

  const result = await findCrossLeagueTrade(supabase, {
    sleeperLeagueIds,
    sleeperUserId,
    sourceSlug: resolvedSource.slug,
    goal: readGoal(input.goal),
    cursor,
    excludeByLeague,
    sessionExcluded: readKeys(input.sessionExcluded),
    qualityConfig: await loadTradeQualityConfig(admin),
  });

  // Grades are batched per league rather than per suggestion. The window spans
  // at most three rooms, so this is at most three rounds of value lookups for
  // twelve deals, and each league's own format is respected.
  const grades: (SuggestionGrade | null)[] = result.suggestions.map(() => null);
  const byLeague = new Map<string, number[]>();
  result.suggestions.forEach((s, i) => {
    const list = byLeague.get(s.league.sleeperLeagueId) ?? [];
    list.push(i);
    byLeague.set(s.league.sleeperLeagueId, list);
  });

  for (const [sleeperLeagueId, indexes] of byLeague) {
    const league = await loadTradeFinderLeague(supabase, {
      sleeperLeagueId,
      sourceSlug: resolvedSource.slug,
      identity: { sleeperUserId },
    });
    if (!league) continue;
    const batch = await gradeSuggestions(
      admin,
      league.sleeperLeague,
      indexes.map((i) => result.suggestions[i]),
    );
    indexes.forEach((i, n) => {
      grades[i] = batch[n] ?? null;
    });
  }

  const savedKeys = await loadSavedKeys(supabase);

  return {
    ok: true,
    suggestions: result.suggestions,
    grades,
    savedKeys,
    cursor: result.nextCursor,
    examined: result.examined,
    remaining: result.remaining,
    unreadable: result.unreadable,
  };
}

/**
 * Record a pass.
 *
 * Signed out, this is a no-op that reports `stored: false`, and the component
 * keeps the key for the visit instead. Saying so plainly is what lets the UI
 * tell a guest that signing in makes their passes stick.
 */
export async function declineSuggestion(input: {
  sleeperLeagueId: string;
  suggestionKey: string;
}): Promise<{ ok: boolean; stored: boolean }> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (
    !SLEEPER_ID_PATTERN.test(sleeperLeagueId) ||
    !isValidSuggestionKey(input.suggestionKey)
  ) {
    return { ok: false, stored: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true, stored: false };

  const stored = await recordDecline(supabase, {
    userId: user.id,
    sleeperLeagueId,
    suggestionKey: input.suggestionKey,
  });
  return { ok: true, stored };
}

/**
 * Bookmark a trade.
 *
 * The suggestion arrives from the client, and lib/trade-finder-saves.ts
 * validates every field of it against a bounded, strict schema before anything
 * is written. That schema is what stops the column becoming general storage; it
 * is not there to prove the engine produced the deal, and it does not need to
 * be. The row is only ever read back by the person who wrote it, so the worst a
 * forged one can do is show its author a trade they made up, which is the same
 * reasoning the pass list already runs on.
 *
 * Members only, and it says so rather than failing quietly, because a save
 * button that does nothing is the exact problem this change set out to remove.
 */
export async function saveSuggestion(input: {
  sleeperLeagueId: string;
  leagueName?: string | null;
  suggestion: unknown;
  grade?: unknown;
}): Promise<SaveTradeResponse> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (!SLEEPER_ID_PATTERN.test(sleeperLeagueId)) {
    return { ok: false, error: "That trade could not be saved." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to bookmark a trade." };

  return saveTrade(supabase, {
    userId: user.id,
    sleeperLeagueId,
    leagueName:
      typeof input.leagueName === "string" ? input.leagueName.slice(0, 120) : null,
    suggestion: input.suggestion,
    grade: input.grade ?? null,
  });
}

/** Remove a bookmark. Scoped by the owner policies, not by a filter here. */
export async function removeSavedSuggestion(input: {
  sleeperLeagueId: string;
  suggestionKey: string;
}): Promise<SaveTradeResponse> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (
    !SLEEPER_ID_PATTERN.test(sleeperLeagueId) ||
    !isValidSuggestionKey(input.suggestionKey)
  ) {
    return { ok: false, error: "That bookmark could not be removed." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to manage your saved trades." };

  const removed = await removeSavedTrade(supabase, {
    sleeperLeagueId,
    suggestionKey: input.suggestionKey,
  });
  return removed ? { ok: true } : { ok: false, error: "That bookmark could not be removed." };
}

/** This reader's bookmarks, newest first. Empty rather than an error when signed out. */
export async function listSavedSuggestions(): Promise<SavedTradesResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true, saved: [] };
  return { ok: true, saved: await loadSavedTrades(supabase) };
}
