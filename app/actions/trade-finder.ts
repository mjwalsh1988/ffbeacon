"use server";

/**
 * Trade Finder's server calls.
 *
 * Three of them: find the next deal in one league, find the next deal across a
 * reader's whole portfolio, and record a pass. Server actions rather than route
 * handlers because none of these has a shareable URL or a cacheable answer; the
 * reader presses a button, we answer, and the answer is worth nothing to anyone
 * else.
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

import { headers } from "next/headers";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
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
import { gradeSuggestion, type SuggestionGrade } from "@/lib/trade-finder-grade";
import { isValidSuggestionKey } from "@/lib/trade-finder/fingerprint";
import { TRADE_GOALS, type TradeGoal, type TradeSuggestion } from "@/lib/trade-finder/types";

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
 * The portfolio limit is a third of it because each press opens up to three
 * leagues: six a minute is about 41 seconds, the same order of magnitude.
 *
 * The league surface is public, so its limit is the one that matters most.
 */
const RATE_WINDOW_SECONDS = 60;
const LEAGUE_RATE_MAX = 12;
const PORTFOLIO_RATE_MAX = 6;

const GOAL_KEYS = new Set(TRADE_GOALS.map((g) => g.key));

export type TradeFinderMeta = {
  leagueName: string;
  formatDisplay: string;
  sourceDisplay: string;
  pickSourceDisplay: string | null;
  /** Counterparties the engine could evaluate. */
  consideredTeams: number;
  /** True when no projections exist, so lineup impact is unavailable. */
  lineupUnavailable: boolean;
  /** Suggestions behind this one, after passes were removed. */
  remaining: number;
};

export type TradeFinderResponse =
  | {
      ok: true;
      suggestion: TradeSuggestion | null;
      grade: SuggestionGrade | null;
      meta: TradeFinderMeta;
    }
  | { ok: false; error: string };

export type PortfolioResponse =
  | {
      ok: true;
      suggestion: CrossLeagueSuggestion | null;
      grade: SuggestionGrade | null;
      cursor: number;
      examined: number;
      remaining: number;
      unreadable: number;
    }
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
 * The durable per-actor limit.
 *
 * Fails CLOSED. A limit that cannot be evaluated is not a limit that passes, and
 * the work behind these actions is exactly what an unbounded caller would want
 * to spend our database on.
 *
 * `headers()` is wrapped in a Request because getTrustedClientIp reads a
 * Request's headers and nothing else. This keeps one derivation of the trusted
 * client IP in the codebase rather than a second copy that could drift from it.
 */
async function claimSlot(bucket: string, max: number): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/trade-finder", {
        headers: requestHeaders,
      }),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: bucket,
      p_key: actorKey,
      p_max_requests: max,
      p_window_seconds: RATE_WINDOW_SECONDS,
    } as never);
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[trade-finder] rate-limit check failed", err);
    return false;
  }
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

  const result = findTrades({
    myRosterId: league.myRosterId,
    teams: league.teams,
    startingSlots: league.startingSlots,
    isDynasty: league.isDynasty,
    allowPicks: league.allowPicks,
    goal: readGoal(input.goal),
    targetPlayerId: readPlayerId(input.targetPlayerId),
    offerPlayerId: readPlayerId(input.offerPlayerId),
    excludeKeys: [...stored, ...sessionExcluded],
  });

  const suggestion = result.suggestions[0] ?? null;
  const grade = suggestion
    ? await gradeSuggestion(createAdminClient(), league.sleeperLeague, suggestion)
    : null;

  return {
    ok: true,
    suggestion,
    grade,
    meta: {
      leagueName: league.leagueName,
      formatDisplay: league.formatDisplay,
      sourceDisplay: league.sourceDisplay,
      pickSourceDisplay: league.pickSourceDisplay,
      consideredTeams: result.consideredTeams,
      lineupUnavailable: result.lineupUnavailable,
      remaining: Math.max(0, result.suggestions.length - 1),
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
  });

  let grade: SuggestionGrade | null = null;
  if (result.suggestion) {
    const league = await loadTradeFinderLeague(supabase, {
      sleeperLeagueId: result.suggestion.league.sleeperLeagueId,
      sourceSlug: resolvedSource.slug,
      identity: { sleeperUserId },
    });
    if (league) {
      grade = await gradeSuggestion(
        createAdminClient(),
        league.sleeperLeague,
        result.suggestion,
      );
    }
  }

  return {
    ok: true,
    suggestion: result.suggestion,
    grade,
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
