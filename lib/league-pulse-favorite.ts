/**
 * The one team the Power Pulse model expects to win a league, for the League
 * Overview's rail card.
 *
 * A SEPARATE, DELIBERATELY SMALL READ. `loadPowerPulseView` in
 * lib/league-power-pulse-data.ts is the right function for the Power Pulse tab:
 * it joins the pulse cache to rosters, to league_users, to the trade-value
 * cache, and it decodes every team's weekly distribution, its drivers, and its
 * starting lineup. That is five reads and a lot of jsonb to render a rail card
 * that names one team and four figures.
 *
 * This reads the pulse cache and the two identity tables, nothing else, and it
 * selects the eight columns the card prints. Everything jsonb (weekly,
 * drivers, components) is left in the database.
 *
 * Returns null when the league has no Power Pulse rows yet, so the card can
 * render nothing rather than an empty frame. The panel below it still renders,
 * and `leagues.power_pulse_status` on the Power Pulse page itself carries the
 * honest reason.
 *
 * READ ONLY. It never computes and never imports lib/league-power-pulse.ts.
 * Power Pulse is recomputed on demand through pulseLeague, gated by its own
 * TTL (CLAUDE.md), and the overview already runs the derived pulse.
 *
 * Wrapped in React cache() and keyed on primitives, so a page that mounts the
 * card more than once on one render issues one set of queries.
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatTeamLabel } from "@/lib/team-label";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type PulseFavorite = {
  /** Team name and handle, through the one site-wide formatter. */
  label: string;
  /** The manager's Sleeper handle on its own, or null when the roster has no owner. */
  handle: string | null;
  /** league_users.avatar, for SleeperAvatar. */
  avatarId: string | null;
  sleeperRosterId: number;
  /** 1 to 99, ranked within this league. */
  powerPulse: number;
  pulseRank: number | null;
  /** Fraction, 0 to 1. Null when the simulation produced none. */
  titleOdds: number | null;
  playoffOdds: number | null;
  projectedWins: number | null;
  projectedLosses: number | null;
  /** How many other teams share the top title odds. 0 when the favorite is alone. */
  tiedWith: number;
  /** The week the stored run scored through, for the card's footnote. */
  throughWeek: number;
  generatedAt: string | null;
};

type CacheRow = {
  roster_id: string;
  power_pulse: number;
  pulse_rank: number | null;
  title_odds: number | null;
  playoff_odds: number | null;
  projected_wins: number | null;
  projected_losses: number | null;
  through_week: number;
  generated_at: string;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rank the stored rows and return the top one.
 *
 * Title odds first, because "who wins this league" is the question the card
 * answers and title odds is the only column that answers it: a team can lead
 * the pulse score and still be an underdog once the bracket is simulated.
 * Falls back to pulse rank when no row carries title odds at all, which is the
 * shape a run produces before a playoff bracket exists.
 *
 * Exported for its own test. Pure.
 */
export function pickFavorite(rows: CacheRow[]): { row: CacheRow; tiedWith: number } | null {
  if (rows.length === 0) return null;

  const withOdds = rows.filter((r) => num(r.title_odds) !== null && Number(r.title_odds) > 0);
  if (withOdds.length > 0) {
    const sorted = [...withOdds].sort((a, b) => {
      const byOdds = Number(b.title_odds) - Number(a.title_odds);
      if (byOdds !== 0) return byOdds;
      // A tie on odds falls to the pulse rank, then to the roster id, so two
      // identical rows always resolve the same way across renders.
      const byRank = (a.pulse_rank ?? Infinity) - (b.pulse_rank ?? Infinity);
      if (byRank !== 0) return byRank;
      return a.roster_id < b.roster_id ? -1 : 1;
    });
    const top = Number(sorted[0].title_odds);
    // Counted on the ROUNDED percentage the card prints, not on the raw float.
    // Two teams at 0.2413 and 0.2409 both read "24%", and a card that shows a
    // sole favorite next to a number another team also has is the kind of small
    // lie a reader catches immediately.
    const topPct = Math.round(top * 100);
    const tiedWith =
      sorted.filter((r) => Math.round(Number(r.title_odds) * 100) === topPct).length - 1;
    return { row: sorted[0], tiedWith };
  }

  const byPulse = [...rows].sort((a, b) => {
    const byRank = (a.pulse_rank ?? Infinity) - (b.pulse_rank ?? Infinity);
    if (byRank !== 0) return byRank;
    const byScore = b.power_pulse - a.power_pulse;
    if (byScore !== 0) return byScore;
    return a.roster_id < b.roster_id ? -1 : 1;
  });
  return { row: byPulse[0], tiedWith: 0 };
}

export const loadPulseFavorite = cache(async function loadPulseFavorite(
  supabase: AnySupabase,
  leagueRowId: string,
  season: number,
): Promise<PulseFavorite | null> {
  const { data, error } = await supabase
    .from("league_power_pulse_cache")
    .select(
      "roster_id, power_pulse, pulse_rank, title_odds, playoff_odds, projected_wins, projected_losses, through_week, generated_at",
    )
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (error || !data || data.length === 0) return null;

  const picked = pickFavorite(data as unknown as CacheRow[]);
  if (!picked) return null;

  // Identity, resolved for the ONE roster the card names. Two tiny reads
  // rather than the whole league's rosters and members.
  const { data: roster } = await supabase
    .from("rosters")
    .select("sleeper_roster_id, owner_user_id")
    .eq("id", picked.row.roster_id)
    .maybeSingle();
  if (!roster) return null;

  const { data: user } = roster.owner_user_id
    ? await supabase
        .from("league_users")
        .select("display_name, team_name, avatar")
        .eq("league_id", leagueRowId)
        .eq("sleeper_user_id", roster.owner_user_id)
        .maybeSingle()
    : { data: null };

  return {
    label: formatTeamLabel({
      teamName: user?.team_name ?? null,
      username: user?.display_name ?? null,
      sleeperRosterId: roster.sleeper_roster_id,
    }),
    handle: user?.display_name ?? null,
    avatarId: user?.avatar ?? null,
    sleeperRosterId: roster.sleeper_roster_id,
    powerPulse: Number(picked.row.power_pulse),
    pulseRank: picked.row.pulse_rank === null ? null : Number(picked.row.pulse_rank),
    titleOdds: num(picked.row.title_odds),
    playoffOdds: num(picked.row.playoff_odds),
    projectedWins: num(picked.row.projected_wins),
    projectedLosses: num(picked.row.projected_losses),
    tiedWith: picked.tiedWith,
    throughWeek: Number(picked.row.through_week),
    generatedAt: picked.row.generated_at ?? null,
  };
});
