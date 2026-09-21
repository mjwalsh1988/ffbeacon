/**
 * The read behind lib/league-season/phase.ts.
 *
 * One league, one answer: what phase it is in, who won it, and who was chopped
 * most recently, with the identities already resolved so a card can render
 * without a second round trip. Wrapped in React `cache()` so the overview's
 * two consumers (the cards at the top of the column and the post-season notice
 * in the shell) share one result per render.
 *
 * Reads only rows the sync has already written. No Sleeper request, no
 * compute, and nothing here can trigger one.
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { teamLabelParts } from "@/lib/team-label";
import {
  isChopThisWeek,
  resolveLeagueOutcome,
  type ChampionSource,
  type LeaguePhase,
} from "./phase";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** A team named for a card: the display name, the owner line, and an avatar. */
export type OutcomeTeam = {
  sleeperRosterId: number;
  /** Team name, or the handle when there is no team name. */
  name: string;
  /**
   * The manager's handle ALREADY PREFIXED with the at-sign, or null when
   * printing it would repeat the name.
   *
   * Named `ownerLabel` rather than `ownerHandle` because it is the rendered
   * label and not the bare handle: teamLabelParts returns "@someone", so a
   * call site that adds its own at-sign prints "@@someone". Matches
   * LedgerViewTeam, whose table renders it bare for the same reason.
   */
  ownerLabel: string | null;
  avatarId: string | null;
  /** Total points scored, for the line under a champion's name. */
  pointsFor: number | null;
  record: { wins: number; losses: number; ties: number };
};

export type LeagueSeasonView = {
  phase: LeaguePhase;
  chopped: boolean;
  champion: OutcomeTeam | null;
  /** How the champion was decided. Null when there is no champion. */
  championSource: ChampionSource | null;
  runnerUp: OutcomeTeam | null;
  /** Chopped leagues only: the most recently eliminated team. */
  latestChop: (OutcomeTeam & { week: number; thisWeek: boolean }) | null;
  /** Chopped leagues only: how many teams are still in. */
  aliveCount: number;
  /** Chopped leagues only: how many have gone out. */
  choppedCount: number;
};

type RosterRow = {
  sleeper_roster_id: number;
  owner_user_id: string | null;
  metadata: unknown;
  points_for: number | string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
};

function rosterSettings(metadata: unknown): Record<string, unknown> | null {
  const meta = (metadata ?? {}) as { settings?: Record<string, unknown> };
  return meta.settings ?? null;
}

export const loadLeagueSeasonView = cache(async function loadLeagueSeasonView(
  supabase: AnySupabase,
  leagueRowId: string,
): Promise<LeagueSeasonView | null> {
  const [leagueRes, rostersRes, usersRes] = await Promise.all([
    supabase
      .from("leagues")
      .select("status, season, metadata")
      .eq("id", leagueRowId)
      .maybeSingle(),
    supabase
      .from("rosters")
      .select(
        "sleeper_roster_id, owner_user_id, metadata, points_for, wins, losses, ties",
      )
      .eq("league_id", leagueRowId),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
  ]);

  if (!leagueRes.data) return null;

  const metadata = (leagueRes.data.metadata ?? {}) as {
    settings?: Record<string, unknown>;
    brackets?: { winners?: unknown };
  };

  const rosterRows = (rostersRes.data ?? []) as unknown as RosterRow[];
  const outcome = resolveLeagueOutcome({
    status: leagueRes.data.status,
    settings: metadata.settings ?? null,
    winnersBracket: metadata.brackets?.winners,
    rosters: rosterRows.map((r) => ({
      sleeperRosterId: Number(r.sleeper_roster_id),
      settings: rosterSettings(r.metadata),
    })),
  });

  const usersById = new Map(
    (usersRes.data ?? []).map((u) => [u.sleeper_user_id, u] as const),
  );
  const rosterById = new Map(
    rosterRows.map((r) => [Number(r.sleeper_roster_id), r] as const),
  );

  const teamFor = (sleeperRosterId: number | null): OutcomeTeam | null => {
    if (sleeperRosterId === null) return null;
    const roster = rosterById.get(sleeperRosterId);
    if (!roster) return null;
    const user = roster.owner_user_id
      ? usersById.get(roster.owner_user_id)
      : null;
    const parts = teamLabelParts({
      teamName: user?.team_name ?? null,
      username: user?.display_name ?? null,
      sleeperRosterId,
    });
    const points = Number(roster.points_for);
    return {
      sleeperRosterId,
      name: parts.primary,
      ownerLabel: parts.owner,
      avatarId: user?.avatar ?? null,
      pointsFor: Number.isFinite(points) ? points : null,
      record: {
        wins: Number(roster.wins ?? 0),
        losses: Number(roster.losses ?? 0),
        ties: Number(roster.ties ?? 0),
      },
    };
  };

  const championTeam = teamFor(outcome.champion?.sleeperRosterId ?? null);
  const latestChopTeam = teamFor(outcome.latestChop?.sleeperRosterId ?? null);

  // Is the most recent chop the one that just happened? Answered from the
  // weeks this league has actually settled rather than from the NFL calendar,
  // so it needs no Sleeper request and cannot disagree with the scores on the
  // Schedules page. A league with nothing settled yet cannot have chopped
  // anyone this week, and the card then names the week instead of claiming it
  // is news.
  let chopIsThisWeek = false;
  if (outcome.latestChop) {
    const { data: settled } = await supabase
      .from("league_matchups")
      .select("week")
      .eq("league_id", leagueRowId)
      .eq("season", Number(leagueRes.data.season))
      .eq("is_final", true)
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSettledWeek = settled?.week == null ? null : Number(settled.week);
    chopIsThisWeek =
      lastSettledWeek !== null &&
      isChopThisWeek(outcome.latestChop, lastSettledWeek + 1);
  }

  return {
    phase: outcome.phase,
    chopped: outcome.chopped,
    champion: championTeam,
    championSource: outcome.champion?.source ?? null,
    runnerUp: teamFor(outcome.runnerUpRosterId),
    latestChop:
      latestChopTeam && outcome.latestChop
        ? {
            ...latestChopTeam,
            week: outcome.latestChop.week,
            thisWeek: chopIsThisWeek,
          }
        : null,
    aliveCount: outcome.aliveCount,
    choppedCount: outcome.chops.length,
  };
});
