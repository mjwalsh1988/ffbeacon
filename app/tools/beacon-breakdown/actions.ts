"use server";

/**
 * League mode's one server call: find the reader's leagues.
 *
 * The Beacon Breakdown is public and stays public. Connecting a league is an
 * opt-in extra, not a sign-in wall, so this takes a Sleeper username the same
 * way /tools/league-pulse and the FAAB calculator do.
 *
 * A reader who saved a handle in My Beacon sends `{ saved: true }` instead, and
 * the handle is read here, server-side, from their own row. The username never
 * crosses the wire on that path: one that did would be a handle anybody could
 * send, which would turn "use mine" into "look up anyone" (D1, D3, D7).
 *
 * The heavy work is NOT here. Picking a league navigates to a URL carrying the
 * league and roster, and the page computes the comparison server-side through
 * lib/breakdown/league-mode.ts, which has its own cache and rate limit. That
 * keeps the answer shareable and keeps the meter, the table, and the verdict all
 * computed from one set of numbers rather than patched afterwards on the client.
 *
 * WHY THE SERVICE ROLE. Everything this touches (leagues, rosters, league_users)
 * is public-read under RLS and already rendered to anyone by /leagues/<id>, so
 * naming a league you are not in reveals nothing new. The admin client is used
 * because the reader's own leagues have to be matched against stored rosters in
 * one pass. The gate that matters is the rate limit, not an ownership check.
 */

import { headers } from "next/headers";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { getSleeperLeagues, getSleeperUser } from "@/lib/sleeper";
import { syncLeagueOnDemand } from "@/lib/league-on-demand-sync";
import {
  ensureSleeperUserId,
  loadSavedSleeperHandle,
} from "@/lib/sleeper-handle/resolve";
import { LOOKUP_THROTTLED_MESSAGE } from "@/lib/on-the-clock/lookup-failure";

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const RATE_WINDOW_SECONDS = 60;
const CONNECT_RATE_MAX = 10;

async function claimSlot(bucket: string, max: number): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/breakdown", {
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
    console.error("[breakdown] rate-limit check failed", err);
    return false;
  }
}

export type BreakdownLeague = {
  sleeperLeagueId: string;
  name: string;
  season: string;
  /** The reader's roster in it. Null when we hold no rosters for the league. */
  rosterId: number | null;
  /** False when nobody has ever opened this league in League Pulse. */
  synced: boolean;
  teams: number | null;
  /** Sleeper's own league image id, straight off the payload. May be null. */
  avatar: string | null;
};

/**
 * Why a connect failed, so the caller can tell "wait a moment" apart from
 * "your handle is wrong".
 *
 * A message string is not something a caller can branch on, and the difference
 * matters: D7 says a 429 on an AUTO-RUN keeps the identity card with a Retry,
 * and never drops the reader into a username form to retype a handle that is
 * perfectly fine. Without this the panel could only ever say "failed", which
 * opens the form.
 */
export type ConnectBreakdownFailure =
  | "invalid-input"
  | "no-saved-handle"
  | "rate-limited"
  | "not-found"
  | "empty";

export type ConnectBreakdownResult =
  | { ok: true; sleeperUserId: string; leagues: BreakdownLeague[] }
  | { ok: false; error: string; reason: ConnectBreakdownFailure };

/**
 * Either the reader typed a handle, or they have one saved and we read it here.
 *
 * The saved branch never takes a username from the client. A handle that
 * arrived over the wire is a handle anyone can send, so trusting one labelled
 * "saved" would make the whole saved path a way to look up a stranger with
 * somebody else's rate-limit slot. The only thing the client says is "use
 * mine", and the server decides what that means.
 */
export type ConnectBreakdownInput = { season: string } & (
  { username: string; saved?: false } | { saved: true; username?: never }
);

/**
 * Resolve the Sleeper identity this lookup runs as.
 *
 * Both branches end in the same pair (username for the messages, user id for
 * the Sleeper call). The saved branch skips `getSleeperUser` entirely when the
 * id was cached at save time, which is the one Sleeper call per visit that D3
 * exists to save.
 */
async function resolveConnectIdentity(
  input: ConnectBreakdownInput,
): Promise<
  | { ok: true; username: string; sleeperUserId: string }
  | { ok: false; error: string; reason: ConnectBreakdownFailure }
> {
  if (input.saved === true) {
    const supabase = await createClient();
    const saved = await loadSavedSleeperHandle(supabase);
    if (!saved) {
      return {
        ok: false,
        reason: "no-saved-handle",
        error:
          "You have no saved Sleeper username. Type one below, or save it in My Beacon.",
      };
    }

    if (!(await claimSlot("breakdown_connect", CONNECT_RATE_MAX))) {
      return {
        ok: false,
        reason: "rate-limited",
        error: LOOKUP_THROTTLED_MESSAGE,
      };
    }

    // Null only for a row saved before the id was stored. One Sleeper call
    // fills it in and writes it back, so the next visit costs nothing.
    const filled = saved.sleeperUserId
      ? saved
      : await ensureSleeperUserId(supabase, saved);
    if (!filled.sleeperUserId) {
      return {
        ok: false,
        reason: "not-found",
        error: `Sleeper no longer has a user called "${saved.username}". Type the current one below.`,
      };
    }
    return {
      ok: true,
      username: filled.username,
      sleeperUserId: filled.sleeperUserId,
    };
  }

  const username = String(input.username ?? "").trim();
  // The dot is allowed because Sleeper handles may contain one, but a run of
  // them would become a path segment in the Sleeper URL this is about to build.
  if (!USERNAME_PATTERN.test(username) || username.includes("..")) {
    return {
      ok: false,
      reason: "invalid-input",
      error: "That does not look like a Sleeper username.",
    };
  }

  if (!(await claimSlot("breakdown_connect", CONNECT_RATE_MAX))) {
    return {
      ok: false,
      reason: "rate-limited",
      error: LOOKUP_THROTTLED_MESSAGE,
    };
  }

  const user = await getSleeperUser(username);
  if (!user) {
    return {
      ok: false,
      reason: "not-found",
      error: `Sleeper has no user called "${username}".`,
    };
  }
  return { ok: true, username, sleeperUserId: user.user_id };
}

export async function connectBreakdownLeagues(
  input: ConnectBreakdownInput,
): Promise<ConnectBreakdownResult> {
  // The season is checked first because it costs nothing and it is the one
  // input that is wrong just as often on the saved path as on the typed one.
  const season = String(input.season ?? "").trim();
  if (!/^\d{4}$/.test(season)) {
    return { ok: false, reason: "invalid-input", error: "Pick a season." };
  }

  // Shape and ownership first, then the rate-limit slot, then Sleeper. A
  // request that was never going to run must not spend the reader's budget.
  const identity = await resolveConnectIdentity(input);
  if (!identity.ok) return identity;
  const { username, sleeperUserId } = identity;

  const leagues = await getSleeperLeagues(sleeperUserId, season);
  if (leagues.length === 0) {
    return {
      ok: false,
      reason: "empty",
      error: `No ${season} leagues found for ${username}.`,
    };
  }

  const admin = createAdminClient();
  const sleeperIds = leagues.map((l) => l.league_id);

  const { data: leagueRows } = await admin
    .from("leagues")
    .select("id, sleeper_league_id")
    .in("sleeper_league_id", sleeperIds);

  const rowBySleeperId = new Map(
    (leagueRows ?? []).map((l) => [l.sleeper_league_id, l]),
  );
  const rowIds = (leagueRows ?? []).map((l) => l.id);

  const { data: rosterRows } = rowIds.length
    ? await admin
        .from("rosters")
        .select("league_id, sleeper_roster_id, owner_user_id, co_owners")
        .in("league_id", rowIds)
    : { data: [] as never[] };

  const mineByLeagueRow = new Map<string, number>();
  const rosterCountByLeagueRow = new Map<string, number>();
  for (const r of rosterRows ?? []) {
    rosterCountByLeagueRow.set(
      r.league_id,
      (rosterCountByLeagueRow.get(r.league_id) ?? 0) + 1,
    );
    const co = Array.isArray(r.co_owners) ? r.co_owners : [];
    const owns =
      r.owner_user_id === sleeperUserId ||
      co.some((c) => typeof c === "string" && c === sleeperUserId);
    if (owns) mineByLeagueRow.set(r.league_id, Number(r.sleeper_roster_id));
  }

  const out: BreakdownLeague[] = leagues.map((l) => {
    const row = rowBySleeperId.get(l.league_id);
    const rosterId = row ? (mineByLeagueRow.get(row.id) ?? null) : null;
    return {
      sleeperLeagueId: l.league_id,
      name: l.name,
      season: l.season,
      rosterId,
      synced: Boolean(row && (rosterCountByLeagueRow.get(row.id) ?? 0) > 0),
      teams: l.total_rosters ?? null,
      avatar: l.avatar ?? null,
    };
  });

  // Leagues we can actually compare against come first; inside each group,
  // alphabetical, so the list does not reshuffle between visits.
  out.sort((a, b) => {
    const aReady = a.synced && a.rosterId != null;
    const bReady = b.synced && b.rosterId != null;
    if (aReady !== bReady) return aReady ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return { ok: true, sleeperUserId, leagues: out };
}

export type SyncBreakdownLeagueResult =
  | { ok: true; rosterId: number | null; synced: boolean }
  | { ok: false; error: string };

/**
 * Sync one league the reader just picked, then say where their team is in it.
 *
 * A league nobody has opened has no stored rosters, which used to make it a
 * dead row in this list: visible, disabled, and pointing at League Pulse. Now
 * picking it runs the same sync opening the league would have run, and the
 * comparison loads against the roster that sync just wrote.
 *
 * The claim inside syncLeagueOnDemand is the same per-visitor slot the League
 * Pulse list and the FAAB calculator hold, so three surfaces share one budget.
 */
export async function syncBreakdownLeague(input: {
  sleeperLeagueId: string;
  sleeperUserId: string;
}): Promise<SyncBreakdownLeagueResult> {
  const sleeperLeagueId = String(input.sleeperLeagueId ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sleeperLeagueId)) {
    return { ok: false, error: "Invalid league id" };
  }
  const sleeperUserId = String(input.sleeperUserId ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sleeperUserId)) {
    return { ok: false, error: "Invalid user id" };
  }

  let actorKey: string;
  try {
    const requestHeaders = await headers();
    actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/breakdown", {
        headers: requestHeaders,
      }),
    );
  } catch (err) {
    console.error("[breakdown] could not derive a sync limit key", err);
    return {
      ok: false,
      error:
        "Syncing is unavailable right now. Open the league in League Pulse instead.",
    };
  }

  const admin = createAdminClient();
  const outcome = await syncLeagueOnDemand(admin, sleeperLeagueId, actorKey);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const { data: row } = await admin
    .from("leagues")
    .select("id")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!row) return { ok: true, rosterId: null, synced: false };

  const { data: rosterRows } = await admin
    .from("rosters")
    .select("sleeper_roster_id, owner_user_id, co_owners")
    .eq("league_id", row.id);

  let rosterId: number | null = null;
  for (const r of rosterRows ?? []) {
    const co = Array.isArray(r.co_owners) ? r.co_owners : [];
    const owns =
      r.owner_user_id === sleeperUserId ||
      co.some((c) => typeof c === "string" && c === sleeperUserId);
    if (owns) {
      rosterId = Number(r.sleeper_roster_id);
      break;
    }
  }

  return { ok: true, rosterId, synced: (rosterRows ?? []).length > 0 };
}
