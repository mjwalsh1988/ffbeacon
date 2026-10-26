/**
 * Leaderboards: the shapes, and the rules they carry.
 *
 * EVERY PLAYER, NOT EVERY ROSTERED PLAYER. A league's weekly matchup rows score
 * only the players on a roster that week, so a board built from them alone
 * would leave out the waiver pickup who scored thirty before anybody claimed
 * him, and the player nobody has claimed at all. The board here is every
 * player who took the field in a settled week, scored under this league's own
 * rules.
 *
 * WHO OWNED HIM, WEEK BY WEEK. The same matchup rows are an ownership record:
 * a player appears under exactly one roster per week, or under none. That is
 * the precise answer to "whose team was he on in week 5", trades, waiver
 * claims and drops included, without replaying a transaction log. A player
 * under no roster that week was a free agent that week, and every list says
 * so in words.
 *
 * WHICH NUMBER IS USED. A rostered week uses the points Sleeper credited in
 * this league, the figure that counted. A free agent week is scored from his
 * stat line under the league's scoring settings, the same dot product Sleeper
 * runs (lib/league-scoring.ts scoreActualLine). The two agree to the decimal
 * except where Sleeper has applied a stat correction to one and not the other.
 *
 * SETTLED WEEKS ONLY. A week counts once the league's matchup rows are final,
 * the same gate the Manager Ledger uses, so a Sunday afternoon never shows up
 * as a result.
 *
 * NO VALUE SOURCE, NO FORMAT. Everything here is points scored under the
 * league's literal settings, so the source toggle changes nothing and there is
 * nothing to price. Draft picks do not appear: a pick has scored no points.
 */

import type { PulsePosition } from "@/lib/power-pulse/types";

export type LeaderboardPosition = PulsePosition;

/** One team, as every list names it. */
export type LeaderboardTeam = {
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
  avatarId: string | null;
};

/** One player, as every list names him. */
export type LeaderboardPlayer = {
  sleeperId: string;
  name: string;
  /** players.slug, for the profile link. Null when the row has none. */
  slug: string | null;
  position: LeaderboardPosition;
  /** NFL team code, for the logo and the meta line. */
  nflTeam: string | null;
};

/** Who held a player in one settled week. Null roster means a free agent. */
export type OwnershipWeek = {
  week: number;
  rosterId: number | null;
  /** Points that week, or null when he did not play. */
  points: number | null;
};

/** One player across the weeks in scope. */
export type PlayerLeader = {
  player: LeaderboardPlayer;
  points: number;
  games: number;
  /** Points per game played, or null with no games. */
  perGame: number | null;
  /** Rank in the list it came from; ties share a rank. */
  rank: number;
  /** Points behind the player one place above, or null for the first row. */
  gapAbove: number | null;
  /** The roster holding him today, or null when nobody does. */
  currentRosterId: number | null;
  /** Every settled week in scope, in order, with who held him. */
  ownership: OwnershipWeek[];
};

/** One player in one week. */
export type PlayerWeekLeader = {
  player: LeaderboardPlayer;
  week: number;
  points: number;
  /** The roster that held him that week, or null for a free agent. */
  rosterId: number | null;
  /** True when he was in that roster's starting lineup. */
  started: boolean;
  playoff: boolean;
};

/** One team score in one week. */
export type TeamWeekScore = {
  rosterId: number;
  week: number;
  points: number;
  playoff: boolean;
};

/** One game: both sides and the margin. `winnerId` is null on a tie. */
export type GameResult = {
  week: number;
  playoff: boolean;
  homeId: number;
  homePoints: number;
  awayId: number;
  awayPoints: number;
  margin: number;
  combined: number;
  winnerId: number | null;
};

/** A season figure per team, already sorted. */
export type TeamTotal = { rosterId: number; value: number; rank: number };

/** How many of the top X at each position a team holds today. */
export type TopTierRow = {
  rosterId: number;
  total: number;
  byPosition: Partial<Record<LeaderboardPosition, number>>;
  rank: number;
};

/** The cut line for one position: teams times its dedicated starting slots. */
export type TopTierCutoff = {
  position: LeaderboardPosition;
  slots: number;
  cutoff: number;
  /** How many of the top X nobody holds. */
  unowned: number;
};

export type LeaderboardsView = {
  season: number;
  /** Every settled week, in order. Empty means nothing has settled yet. */
  settledWeeks: number[];
  /** The week in scope, or null for the whole season. */
  week: number | null;
  /** First playoff week, or null when the league runs no bracket. */
  playoffWeekStart: number | null;
  positions: LeaderboardPosition[];
  teams: Record<number, LeaderboardTeam>;
  /** The overall board, then one board per position, each already ranked. */
  boards: { all: PlayerLeader[] } & Partial<Record<LeaderboardPosition, PlayerLeader[]>>;
  /** The best players nobody holds today. */
  unowned: PlayerLeader[];
  /** The biggest single player games in scope. For one week this is that week's top scorers. */
  bestWeeks: PlayerWeekLeader[];
  /** The biggest games that did not count, rostered but not started. */
  benchHeroes: PlayerWeekLeader[];
  /** False in a best ball league, where nobody chose a bench. */
  showsBench: boolean;
  topTier: { cutoffs: TopTierCutoff[]; rows: TopTierRow[] };
  teamHighs: TeamWeekScore[];
  teamLows: TeamWeekScore[];
  pointsFor: TeamTotal[];
  /** Weeks each team posted the league's top score. Season scope only. */
  weeklyHighs: TeamTotal[];
  games: { blowouts: GameResult[]; closest: GameResult[]; shootouts: GameResult[] };
  /** True when free agent weeks could be scored (the league's scoring is usable). */
  scoresFreeAgents: boolean;
};
