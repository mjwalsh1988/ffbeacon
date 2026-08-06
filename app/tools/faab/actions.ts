"use server";

/**
 * League mode's server calls.
 *
 * The FAAB page is public and stays public: connecting a league is an opt-in
 * extra, not a sign-in wall. So these take a Sleeper username the same way
 * /tools/league-pulse does, rather than requiring an account.
 *
 * All three are expensive by design. Pricing one league runs a full projection
 * pass over every roster plus two season simulations, and the all-leagues call
 * does that up to ten times. They are rate limited per actor and fail closed,
 * because this is exactly the shape of work an unbounded caller would enjoy
 * spending our database on.
 *
 * Nothing here writes. See lib/faab/league-faab.ts for why that matters.
 *
 * WHY THE SERVICE ROLE
 *   `faab_calculator_settings` is service-role-only, so the settings read needs
 *   it, and the public FAAB page already loads them the same way. Everything
 *   else these actions touch (leagues, rosters, league_users, transactions,
 *   players, projections, stats) is public-read under RLS and already rendered
 *   to anyone by /leagues/<id>. So passing a league id you are not in reveals
 *   nothing you could not read from the public league page, exactly as the Free
 *   Agent Finder documents. The gate that matters here is the rate limit, not
 *   an ownership check.
 */

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { getSleeperLeagues, getSleeperUser } from "@/lib/sleeper";
import { loadFaabSettings } from "@/lib/faab/settings";
import { calculateLeagueFaab } from "@/lib/faab/league-faab";
import { calculateAcrossLeagues, MAX_PRICED_LEAGUES } from "@/lib/faab/multi-league";
import { loadPlayerOutlook, type PlayerOutlook } from "@/lib/faab/outlook";
import {
  loadLeagueFreeAgents,
  type FreeAgentOption,
} from "@/lib/faab/free-agents";
import type { LeagueFaabReport, MultiLeagueRow, NeedLevel } from "@/lib/faab/types";

const SLEEPER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const NEEDS: NeedLevel[] = ["low", "medium", "high"];

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const FORMAT_PATTERN = /^[a-z0-9-]{1,64}$/;

const RATE_WINDOW_SECONDS = 60;
const CONNECT_RATE_MAX = 10;
const SINGLE_RATE_MAX = 12;
const ALL_LEAGUES_RATE_MAX = 4;
const OUTLOOK_RATE_MAX = 30;

/** Fails closed: a limit we cannot evaluate is not a limit that passes. */
async function claimSlot(bucket: string, max: number): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/faab", { headers: requestHeaders }),
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
    console.error("[faab] rate-limit check failed", err);
    return false;
  }
}

function readNeed(value: unknown): NeedLevel {
  return NEEDS.includes(value as NeedLevel) ? (value as NeedLevel) : "medium";
}

export type OutlookResult =
  | { ok: true; outlook: PlayerOutlook }
  | { ok: false; error: string };

/**
 * One player's rest-of-season outlook, for the calculator with no league
 * connected.
 *
 * Fetched once per player rather than per keystroke: the response carries the
 * whole position projection curve, so league size, starter count, budget, and
 * need all stay instant in the browser.
 */
export async function fetchPlayerOutlook(input: {
  playerId: string;
  formatSlug: string;
}): Promise<OutlookResult> {
  const playerId = String(input.playerId ?? "");
  if (!UUID_PATTERN.test(playerId)) {
    return { ok: false, error: "Invalid player" };
  }
  const formatSlug = String(input.formatSlug ?? "");
  if (!FORMAT_PATTERN.test(formatSlug)) {
    return { ok: false, error: "Invalid format" };
  }

  if (!(await claimSlot("faab_outlook", OUTLOOK_RATE_MAX))) {
    return { ok: false, error: "Slow down a moment and try that again." };
  }

  const admin = createAdminClient();
  const settings = await loadFaabSettings(admin);

  try {
    const outlook = await loadPlayerOutlook(admin, { playerId, formatSlug, settings });
    if (!outlook) return { ok: false, error: "We have no data for that player." };
    return { ok: true, outlook };
  } catch (err) {
    console.error("[faab] outlook failed", err);
    return { ok: false, error: "Something went wrong reading that player." };
  }
}

export type FreeAgentsResult =
  | {
      ok: true;
      players: FreeAgentOption[];
      rostered: number;
      /** The positions this league actually starts. */
      positions: string[];
    }
  | { ok: false; error: string };

/**
 * Who is actually available in the selected league.
 *
 * Without this the search box offered the top 300 ranked players regardless of
 * whether anyone owned them, which in a real league is mostly a list of players
 * you cannot bid on, and left out the deeper names FAAB is actually for.
 */
export async function fetchLeagueFreeAgents(input: {
  sleeperLeagueId: string;
  formatSlug: string;
  sourceSlug: string;
}): Promise<FreeAgentsResult> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (!SLEEPER_ID_PATTERN.test(sleeperLeagueId)) {
    return { ok: false, error: "Invalid league id" };
  }
  const formatSlug = String(input.formatSlug ?? "");
  const sourceSlug = String(input.sourceSlug ?? "");
  if (!FORMAT_PATTERN.test(formatSlug) || !FORMAT_PATTERN.test(sourceSlug)) {
    return { ok: false, error: "Invalid format or source" };
  }

  if (!(await claimSlot("faab_free_agents", OUTLOOK_RATE_MAX))) {
    return { ok: false, error: "Slow down a moment and try that again." };
  }

  const admin = createAdminClient();

  const [{ data: league }, { data: format }] = await Promise.all([
    admin.from("leagues").select("id").eq("sleeper_league_id", sleeperLeagueId).maybeSingle(),
    admin.from("format_configs").select("id").eq("slug", formatSlug).maybeSingle(),
  ]);

  if (!league) {
    return {
      ok: false,
      error: "We have not synced this league yet. Open it in League Pulse once and come back.",
    };
  }
  if (!format) return { ok: false, error: "Unknown format" };

  try {
    const result = await loadLeagueFreeAgents(admin, {
      leagueRowId: league.id,
      formatConfigId: format.id,
      source: sourceSlug,
    });
    if (!result) {
      return {
        ok: false,
        error:
          "We hold no rosters for this league yet, so we cannot tell who is available. Open it in League Pulse once.",
      };
    }
    return {
      ok: true,
      players: result.players,
      rostered: result.rostered,
      positions: result.positions,
    };
  } catch (err) {
    console.error("[faab] free agent list failed", err);
    return { ok: false, error: "Something went wrong reading that league's rosters." };
  }
}

export type ConnectedLeague = {
  sleeperLeagueId: string;
  name: string;
  season: string;
  totalRosters: number | null;
  /** Your roster in it. Null when we hold no rosters for the league yet. */
  rosterId: number | null;
  teamName: string | null;
  /** False when we have never synced this league, so we cannot price it. */
  synced: boolean;
  /** Remaining FAAB, when the league publishes a budget. */
  remainingBudget: number | null;
};

export type ConnectResult =
  | { ok: true; sleeperUserId: string; leagues: ConnectedLeague[] }
  | { ok: false; error: string };

/**
 * Find the reader's leagues for a season.
 *
 * Sleeper is the source for WHICH leagues they are in, because we do not store
 * that. Our own tables decide which of those we can actually price: a league
 * nobody has opened in League Pulse has no stored rosters, and pricing a bid
 * against rosters we do not have would be a guess dressed as an answer.
 */
export async function connectSleeperLeagues(input: {
  username: string;
  season: string;
}): Promise<ConnectResult> {
  const username = String(input.username ?? "").trim();
  // The dot is allowed because Sleeper handles may contain one, but a run of
  // them would become a path segment in the Sleeper URL this is about to build.
  if (!USERNAME_PATTERN.test(username) || username.includes("..")) {
    return { ok: false, error: "That does not look like a Sleeper username." };
  }
  const season = String(input.season ?? "").trim();
  if (!/^\d{4}$/.test(season)) {
    return { ok: false, error: "Pick a season." };
  }

  if (!(await claimSlot("faab_connect", CONNECT_RATE_MAX))) {
    return { ok: false, error: "That is a lot of lookups in one minute. Give it a moment." };
  }

  const user = await getSleeperUser(username);
  if (!user) {
    return { ok: false, error: `Sleeper has no user called "${username}".` };
  }

  const leagues = await getSleeperLeagues(user.user_id, season);
  if (leagues.length === 0) {
    return { ok: false, error: `No ${season} leagues found for ${username}.` };
  }

  const admin = createAdminClient();
  const sleeperIds = leagues.map((l) => l.league_id);

  const { data: leagueRows } = await admin
    .from("leagues")
    .select("id, sleeper_league_id, metadata")
    .in("sleeper_league_id", sleeperIds);

  const rowBySleeperId = new Map(
    (leagueRows ?? []).map((l) => [l.sleeper_league_id, l]),
  );

  const rowIds = (leagueRows ?? []).map((l) => l.id);
  const { data: rosterRows } = rowIds.length
    ? await admin
        .from("rosters")
        .select("league_id, sleeper_roster_id, owner_user_id, co_owners, waiver_budget")
        .in("league_id", rowIds)
    : { data: [] as never[] };

  const mineByLeagueRow = new Map<
    string,
    { rosterId: number; waiverBudgetUsed: number }
  >();
  const rosterCountByLeagueRow = new Map<string, number>();
  for (const r of rosterRows ?? []) {
    rosterCountByLeagueRow.set(
      r.league_id,
      (rosterCountByLeagueRow.get(r.league_id) ?? 0) + 1,
    );
    const co = Array.isArray(r.co_owners) ? r.co_owners : [];
    const owns =
      r.owner_user_id === user.user_id ||
      co.some((c) => typeof c === "string" && c === user.user_id);
    if (!owns) continue;
    mineByLeagueRow.set(r.league_id, {
      rosterId: Number(r.sleeper_roster_id),
      waiverBudgetUsed: Number(r.waiver_budget ?? 0),
    });
  }

  const out: ConnectedLeague[] = leagues.map((l) => {
    const row = rowBySleeperId.get(l.league_id);
    const mine = row ? mineByLeagueRow.get(row.id) : undefined;
    const meta = (row?.metadata ?? {}) as { settings?: Record<string, unknown> };
    const total = Number(meta.settings?.waiver_budget);
    const remaining =
      mine && Number.isFinite(total)
        ? Math.max(0, total - mine.waiverBudgetUsed)
        : null;
    return {
      sleeperLeagueId: l.league_id,
      name: l.name,
      season: l.season,
      totalRosters: l.total_rosters ?? null,
      rosterId: mine?.rosterId ?? null,
      teamName: null,
      synced: Boolean(row && (rosterCountByLeagueRow.get(row.id) ?? 0) > 0),
      remainingBudget: remaining,
    };
  });

  out.sort((a, b) => {
    if (a.synced !== b.synced) return a.synced ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return { ok: true, sleeperUserId: user.user_id, leagues: out };
}

export type LeagueBidResult =
  | { ok: true; report: LeagueFaabReport }
  | { ok: false; error: string };

/** Price one bid in one league. */
export async function runLeagueBid(input: {
  sleeperLeagueId: string;
  sleeperRosterId: number;
  candidateSleeperId: string;
  needLevel: string;
  budgetOverride?: number | null;
  /** Stands in when the league publishes no FAAB budget through Sleeper. */
  fallbackBudget?: number | null;
}): Promise<LeagueBidResult> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (!SLEEPER_ID_PATTERN.test(sleeperLeagueId)) {
    return { ok: false, error: "Invalid league id" };
  }
  const candidateSleeperId = String(input.candidateSleeperId ?? "");
  if (!PLAYER_ID_PATTERN.test(candidateSleeperId)) {
    return { ok: false, error: "Invalid player id" };
  }
  const rosterId = Number(input.sleeperRosterId);
  if (!Number.isInteger(rosterId) || rosterId <= 0) {
    return { ok: false, error: "Invalid roster" };
  }

  if (!(await claimSlot("faab_league_bid", SINGLE_RATE_MAX))) {
    return { ok: false, error: "That is a lot of bids in one minute. Give it a moment." };
  }

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("id")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) {
    return {
      ok: false,
      error: "We have not synced this league yet. Open it in League Pulse once and come back.",
    };
  }

  const settings = await loadFaabSettings(admin);
  const budgetOverride =
    input.budgetOverride != null && Number.isFinite(Number(input.budgetOverride))
      ? Number(input.budgetOverride)
      : null;
  const fallbackBudget =
    input.fallbackBudget != null && Number.isFinite(Number(input.fallbackBudget))
      ? Number(input.fallbackBudget)
      : null;

  try {
    const outcome = await calculateLeagueFaab(admin, {
      leagueRowId: league.id,
      sleeperRosterId: rosterId,
      candidateSleeperId,
      needLevel: readNeed(input.needLevel),
      budgetOverride,
      fallbackBudget,
      settings,
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, report: outcome.report };
  } catch (err) {
    console.error("[faab] league bid failed", err);
    return { ok: false, error: "Something went wrong pricing that bid. Try again." };
  }
}

export type AllLeaguesResult =
  | { ok: true; rows: MultiLeagueRow[]; notChecked: number; cap: number }
  | { ok: false; error: string };

/** Price the same bid in every league the reader is in. */
export async function runAllLeagueBids(input: {
  sleeperUserId: string;
  sleeperLeagueIds: string[];
  candidateSleeperId: string;
  needLevel: string;
  fallbackBudget?: number | null;
}): Promise<AllLeaguesResult> {
  const sleeperUserId = String(input.sleeperUserId ?? "");
  if (!SLEEPER_ID_PATTERN.test(sleeperUserId)) {
    return { ok: false, error: "Invalid Sleeper user" };
  }
  const candidateSleeperId = String(input.candidateSleeperId ?? "");
  if (!PLAYER_ID_PATTERN.test(candidateSleeperId)) {
    return { ok: false, error: "Invalid player id" };
  }
  const sleeperLeagueIds = (
    Array.isArray(input.sleeperLeagueIds) ? input.sleeperLeagueIds : []
  ).filter((id): id is string => typeof id === "string" && SLEEPER_ID_PATTERN.test(id));
  if (sleeperLeagueIds.length === 0) {
    return { ok: false, error: "No leagues to check" };
  }

  if (!(await claimSlot("faab_all_leagues", ALL_LEAGUES_RATE_MAX))) {
    return {
      ok: false,
      error: "Checking every league is heavy work. Give it a minute and try again.",
    };
  }

  const admin = createAdminClient();
  const settings = await loadFaabSettings(admin);

  try {
    const outcome = await calculateAcrossLeagues(admin, {
      sleeperLeagueIds,
      sleeperUserId,
      candidateSleeperId,
      needLevel: readNeed(input.needLevel),
      fallbackBudget:
        input.fallbackBudget != null && Number.isFinite(Number(input.fallbackBudget))
          ? Number(input.fallbackBudget)
          : null,
      settings,
    });
    return {
      ok: true,
      rows: outcome.rows,
      notChecked: outcome.notChecked,
      cap: MAX_PRICED_LEAGUES,
    };
  } catch (err) {
    console.error("[faab] all-leagues bid failed", err);
    return { ok: false, error: "Something went wrong checking your leagues. Try again." };
  }
}
