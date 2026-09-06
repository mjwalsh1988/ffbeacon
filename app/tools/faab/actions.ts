"use server";

/**
 * League mode's server calls.
 *
 * The FAAB page is public and stays public: connecting a league is an opt-in
 * extra, not a sign-in wall. So these take a Sleeper username the same way
 * /tools/league-pulse does, rather than requiring an account.
 *
 * A signed-in reader with a saved handle passes `{ saved: true }` instead of a
 * username. The handle is then read server-side through
 * `lib/sleeper-handle/resolve.ts`, never taken from the browser, and the
 * Sleeper user id cached beside it means the lookup costs one Sleeper call
 * instead of two.
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
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { getSleeperLeagues, getSleeperUser } from "@/lib/sleeper";
import {
  ensureSleeperUserId,
  loadSavedSleeperHandle,
} from "@/lib/sleeper-handle/resolve";
import { loadFaabSettings } from "@/lib/faab/settings";
import {
  categorizeLeague,
  type LeagueCategoryKey,
} from "@/lib/league-category";
import { calculateLeagueFaab } from "@/lib/faab/league-faab";
import {
  calculateAcrossLeagues,
  MAX_PRICED_LEAGUES,
} from "@/lib/faab/multi-league";
import { syncLeagueOnDemand } from "@/lib/league-on-demand-sync";
import { loadPlayerOutlook, type PlayerOutlook } from "@/lib/faab/outlook";
import {
  loadLeagueFreeAgents,
  type FreeAgentOption,
} from "@/lib/faab/free-agents";
import type {
  LeagueFaabReport,
  MultiLeagueRow,
  NeedLevel,
} from "@/lib/faab/types";

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
      new Request("https://ffbeacon.internal/faab", {
        headers: requestHeaders,
      }),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "try_claim_rate_limit" as never,
      {
        p_bucket: bucket,
        p_key: actorKey,
        p_max_requests: max,
        p_window_seconds: RATE_WINDOW_SECONDS,
      } as never,
    );
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
  { ok: true; outlook: PlayerOutlook } | { ok: false; error: string };

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
    const outlook = await loadPlayerOutlook(admin, {
      playerId,
      formatSlug,
      settings,
    });
    if (!outlook)
      return { ok: false, error: "We have no data for that player." };
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
    admin
      .from("leagues")
      .select("id")
      .eq("sleeper_league_id", sleeperLeagueId)
      .maybeSingle(),
    admin
      .from("format_configs")
      .select("id")
      .eq("slug", formatSlug)
      .maybeSingle(),
  ]);

  if (!league) {
    return {
      ok: false,
      error: "That league did not finish syncing. Pick it again in a moment.",
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
          "We hold no rosters for this league yet, so we cannot tell who is available. Pick it again in a moment.",
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
    return {
      ok: false,
      error: "Something went wrong reading that league's rosters.",
    };
  }
}

export type ConnectedLeague = {
  sleeperLeagueId: string;
  name: string;
  season: string;
  /** Sleeper's own avatar id for the league. Null when it has no custom image. */
  avatar: string | null;
  totalRosters: number | null;
  /** Your roster in it. Null when we hold no rosters for the league yet. */
  rosterId: number | null;
  teamName: string | null;
  /** False when we have never synced this league, so we cannot price it. */
  synced: boolean;
  /** Remaining FAAB, when the league publishes a budget. */
  remainingBudget: number | null;
  /**
   * Which bucket the picker's type toggles put this league in, from the site's
   * one classification rule. Computed here rather than shipping the raw
   * Sleeper settings the panel has no other use for.
   */
  categoryKey: LeagueCategoryKey;
};

/**
 * Why a lookup did not produce leagues.
 *
 * The panel needs the difference: a rate limit is worth a Retry button, a
 * handle Sleeper cannot resolve is worth opening the form. A message string is
 * not something a caller can branch on.
 */
export type ConnectFailure =
  | "invalid-input"
  | "no-saved-handle"
  | "rate-limited"
  | "unknown-user"
  | "no-leagues";

export type ConnectResult =
  | {
      ok: true;
      sleeperUserId: string;
      /** The handle the lookup actually ran for, resolved server-side. */
      username: string;
      leagues: ConnectedLeague[];
    }
  | { ok: false; error: string; reason: ConnectFailure };

/** What the caller is asking for: a typed handle, or the one we already hold. */
export type ConnectInput = { season: string } & (
  | { username: string; saved?: undefined }
  | { saved: true; username?: undefined }
);

/**
 * Find the reader's leagues for a season.
 *
 * Sleeper is the source for WHICH leagues they are in, because we do not store
 * that. Our own tables decide which of those we can actually price: a league
 * nobody has opened in League Pulse has no stored rosters, and pricing a bid
 * against rosters we do not have would be a guess dressed as an answer.
 *
 * Every cheap check runs BEFORE the rate-limit claim, so a typo or a missing
 * handle costs the reader nothing out of their minute's budget.
 */
export async function connectSleeperLeagues(
  input: ConnectInput,
): Promise<ConnectResult> {
  const season = String(input.season ?? "").trim();
  if (!/^\d{4}$/.test(season)) {
    return { ok: false, error: "Pick a season.", reason: "invalid-input" };
  }

  const useSaved = input.saved === true;

  let username = "";
  // Filled from the saved identity when we already hold it, which is what lets
  // the auto-run skip getSleeperUser entirely.
  let cachedUserId: string | null = null;
  // Held over the rate-limit claim so the pre-0268 upgrade happens after it.
  let pendingHandle: Awaited<ReturnType<typeof loadSavedSleeperHandle>> = null;
  let pendingClient: Awaited<ReturnType<typeof createClient>> | null = null;

  if (useSaved) {
    // Server-side, always. A handle the browser sent us is a handle anyone can
    // send us, and this branch exists precisely because it is not one.
    const supabase = await createClient();
    const handle = await loadSavedSleeperHandle(supabase);
    if (!handle) {
      return {
        ok: false,
        error: "We have no Sleeper username saved for you yet.",
        reason: "no-saved-handle",
      };
    }
    username = handle.username.trim();
    cachedUserId = handle.sleeperUserId;
    // NOTE: a row saved before the id was stored is upgraded AFTER the rate
    // limit below, never here. `ensureSleeperUserId` spends a Sleeper call and
    // a write, and doing that before the claim would let a reader who clears
    // their own cached id draw on the shared budget in lib/sleeper-budget.ts
    // without spending any of their own. The Breakdown action orders it the
    // same way.
    pendingHandle = handle;
    pendingClient = supabase;
  } else {
    username = String(input.username ?? "").trim();
  }

  // The dot is allowed because Sleeper handles may contain one, but a run of
  // them would become a path segment in the Sleeper URL this is about to build.
  if (!USERNAME_PATTERN.test(username) || username.includes("..")) {
    return {
      ok: false,
      error: "That does not look like a Sleeper username.",
      reason: "invalid-input",
    };
  }

  if (!(await claimSlot("faab_connect", CONNECT_RATE_MAX))) {
    return {
      ok: false,
      error: "That is a lot of lookups in one minute. Give it a moment.",
      reason: "rate-limited",
    };
  }

  // The slot is claimed. Now the pre-0268 upgrade may spend its call.
  if (!cachedUserId && pendingHandle && pendingClient) {
    cachedUserId = (await ensureSleeperUserId(pendingClient, pendingHandle))
      .sleeperUserId;
  }

  const sleeperUserId =
    cachedUserId ?? (await getSleeperUser(username))?.user_id ?? null;
  if (!sleeperUserId) {
    return {
      ok: false,
      error: `Sleeper has no user called "${username}".`,
      reason: "unknown-user",
    };
  }
  const user = { user_id: sleeperUserId };

  const leagues = await getSleeperLeagues(user.user_id, season);
  if (leagues.length === 0) {
    return {
      ok: false,
      error: `No ${season} leagues found for ${username}.`,
      reason: "no-leagues",
    };
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
        .select(
          "league_id, sleeper_roster_id, owner_user_id, co_owners, waiver_budget",
        )
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
    const meta = (row?.metadata ?? {}) as {
      settings?: Record<string, unknown>;
    };
    const total = Number(meta.settings?.waiver_budget);
    const remaining =
      mine && Number.isFinite(total)
        ? Math.max(0, total - mine.waiverBudgetUsed)
        : null;
    return {
      sleeperLeagueId: l.league_id,
      name: l.name,
      season: l.season,
      avatar: l.avatar ?? null,
      totalRosters: l.total_rosters ?? null,
      rosterId: mine?.rosterId ?? null,
      teamName: null,
      synced: Boolean(row && (rosterCountByLeagueRow.get(row.id) ?? 0) > 0),
      remainingBudget: remaining,
      categoryKey: categorizeLeague(l),
    };
  });

  out.sort((a, b) => {
    if (a.synced !== b.synced) return a.synced ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return { ok: true, sleeperUserId: user.user_id, username, leagues: out };
}

export type LeagueSyncPatch = {
  rosterId: number | null;
  synced: boolean;
  remainingBudget: number | null;
};

export type SyncConnectedLeagueResult =
  { ok: true; patch: LeagueSyncPatch } | { ok: false; error: string };

/**
 * Sync one league the reader just picked, then report what it changed.
 *
 * Picking a league nobody has opened used to be impossible: the option was
 * greyed out and the reader was told to go and open it in League Pulse first,
 * which is an errand, not an answer. Now picking it runs the same sync opening
 * the league would have run, and the free-agent list loads behind it.
 *
 * Returns a patch rather than a whole league so the name, season, and team count
 * the reader is looking at keep coming from Sleeper's own list, not from a
 * string the browser sent us and we echoed back.
 *
 * The per-visitor claim inside syncLeagueOnDemand is the gate. It is the same
 * slot /api/leagues/[league_id]/sync holds, so a reader alternating between the
 * League Pulse list and this calculator gets one sync budget, not two.
 */
export async function syncConnectedLeague(input: {
  sleeperLeagueId: string;
  sleeperUserId: string;
}): Promise<SyncConnectedLeagueResult> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (!SLEEPER_ID_PATTERN.test(sleeperLeagueId)) {
    return { ok: false, error: "Invalid league id" };
  }
  const sleeperUserId = String(input.sleeperUserId ?? "");
  if (!SLEEPER_ID_PATTERN.test(sleeperUserId)) {
    return { ok: false, error: "Invalid user id" };
  }

  let actorKey: string;
  try {
    const requestHeaders = await headers();
    actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/faab", {
        headers: requestHeaders,
      }),
    );
  } catch (err) {
    console.error("[faab] could not derive a sync limit key", err);
    return {
      ok: false,
      error:
        "Syncing is unavailable right now. Open the league in League Pulse instead.",
    };
  }

  const admin = createAdminClient();
  const outcome = await syncLeagueOnDemand(admin, sleeperLeagueId, actorKey);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  return {
    ok: true,
    patch: await readLeagueMembership(admin, sleeperLeagueId, sleeperUserId),
  };
}

/**
 * Where the reader stands in one league, read from our own tables.
 *
 * Shared by the connect call, which does this for every league at once, and by
 * the on-demand sync, which does it for the one league that just finished.
 */
async function readLeagueMembership(
  admin: ReturnType<typeof createAdminClient>,
  sleeperLeagueId: string,
  sleeperUserId: string,
): Promise<LeagueSyncPatch> {
  const { data: row } = await admin
    .from("leagues")
    .select("id, metadata")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();

  if (!row) return { rosterId: null, synced: false, remainingBudget: null };

  const { data: rosterRows } = await admin
    .from("rosters")
    .select("sleeper_roster_id, owner_user_id, co_owners, waiver_budget")
    .eq("league_id", row.id);

  let mine: { rosterId: number; waiverBudgetUsed: number } | null = null;
  for (const r of rosterRows ?? []) {
    const co = Array.isArray(r.co_owners) ? r.co_owners : [];
    const owns =
      r.owner_user_id === sleeperUserId ||
      co.some((c) => typeof c === "string" && c === sleeperUserId);
    if (!owns) continue;
    mine = {
      rosterId: Number(r.sleeper_roster_id),
      waiverBudgetUsed: Number(r.waiver_budget ?? 0),
    };
    break;
  }

  const meta = (row.metadata ?? {}) as { settings?: Record<string, unknown> };
  const total = Number(meta.settings?.waiver_budget);
  return {
    rosterId: mine?.rosterId ?? null,
    synced: (rosterRows ?? []).length > 0,
    remainingBudget:
      mine && Number.isFinite(total)
        ? Math.max(0, total - mine.waiverBudgetUsed)
        : null,
  };
}

export type LeagueBidResult =
  { ok: true; report: LeagueFaabReport } | { ok: false; error: string };

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
    return {
      ok: false,
      error: "That is a lot of bids in one minute. Give it a moment.",
    };
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
      error: "That league did not finish syncing. Pick it again in a moment.",
    };
  }

  const settings = await loadFaabSettings(admin);
  const budgetOverride =
    input.budgetOverride != null &&
    Number.isFinite(Number(input.budgetOverride))
      ? Number(input.budgetOverride)
      : null;
  const fallbackBudget =
    input.fallbackBudget != null &&
    Number.isFinite(Number(input.fallbackBudget))
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
    return {
      ok: false,
      error: "Something went wrong pricing that bid. Try again.",
    };
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
  ).filter(
    (id): id is string => typeof id === "string" && SLEEPER_ID_PATTERN.test(id),
  );
  if (sleeperLeagueIds.length === 0) {
    return { ok: false, error: "No leagues to check" };
  }

  if (!(await claimSlot("faab_all_leagues", ALL_LEAGUES_RATE_MAX))) {
    return {
      ok: false,
      error:
        "Checking every league is heavy work. Give it a minute and try again.",
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
        input.fallbackBudget != null &&
        Number.isFinite(Number(input.fallbackBudget))
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
    return {
      ok: false,
      error: "Something went wrong checking your leagues. Try again.",
    };
  }
}
