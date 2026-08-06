"use server";

/**
 * League mode's one server call: find the reader's leagues.
 *
 * The Beacon Breakdown is public and stays public. Connecting a league is an
 * opt-in extra, not a sign-in wall, so this takes a Sleeper username the same
 * way /tools/league-pulse and the FAAB calculator do.
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
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { getSleeperLeagues, getSleeperUser } from "@/lib/sleeper";

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const RATE_WINDOW_SECONDS = 60;
const CONNECT_RATE_MAX = 10;

async function claimSlot(bucket: string, max: number): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/breakdown", { headers: requestHeaders }),
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
};

export type ConnectBreakdownResult =
  | { ok: true; leagues: BreakdownLeague[] }
  | { ok: false; error: string };

export async function connectBreakdownLeagues(input: {
  username: string;
  season: string;
}): Promise<ConnectBreakdownResult> {
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

  if (!(await claimSlot("breakdown_connect", CONNECT_RATE_MAX))) {
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
    .select("id, sleeper_league_id")
    .in("sleeper_league_id", sleeperIds);

  const rowBySleeperId = new Map((leagueRows ?? []).map((l) => [l.sleeper_league_id, l]));
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
    rosterCountByLeagueRow.set(r.league_id, (rosterCountByLeagueRow.get(r.league_id) ?? 0) + 1);
    const co = Array.isArray(r.co_owners) ? r.co_owners : [];
    const owns =
      r.owner_user_id === user.user_id ||
      co.some((c) => typeof c === "string" && c === user.user_id);
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

  return { ok: true, leagues: out };
}
