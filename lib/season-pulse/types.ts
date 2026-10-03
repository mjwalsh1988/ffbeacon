/**
 * Shared shapes for Season Pulse (/season and the pages under it).
 *
 * Plan of record: docs/season-pulse/season-pulse-plan.md.
 *
 * WHAT VARIES AND WHAT DOES NOT. Every fantasy figure on these pages is points
 * under one of three stored scoring bases plus an optional tight end premium,
 * so the only half of a reader's format that changes anything is its scoring.
 * League type and superflex change nothing here, and no value source is read at
 * all, which is why SeasonScoring is the whole of the format these modules see.
 *
 * Everything in this file crosses the server to client boundary as a prop, so
 * it is plain data: no Map, no Date, no class.
 */

import type { ScoringBase } from "@/lib/league-scoring";
import type { OffensePosition } from "@/lib/site";

/** The six positions the leaders board ranks. Defenders are out of scope. */
export type SeasonPosition = OffensePosition;

/** The scoring half of a format, which is all these pages depend on. */
export type SeasonScoring = {
  base: ScoringBase;
  /** Extra points per tight end reception. 0 when the format has none. */
  tePremium: number;
  /** "PPR", "Half PPR", "Standard", with "TE premium" appended when it applies. */
  label: string;
  /** Stable cache key part: the base and the premium. */
  key: string;
};

/**
 * The stat columns a row carries. Sparse on the wire: a key is present only
 * when the figure is not zero, so a kicker's row does not carry twenty zeros.
 */
export const STAT_KEYS = [
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "rush_att",
  "rush_yd",
  "rush_td",
  "rec",
  "rec_tgt",
  "rec_yd",
  "rec_td",
  "fum_lost",
  "fgm",
  "fga",
  "xpm",
  "sack",
  "interceptions",
  "def_td",
  "pts_allow",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatTotals = Partial<Record<StatKey, number>>;

/** One player's line for one week he played, as stored. */
export type WeekStatRow = {
  playerId: string;
  week: number;
  position: SeasonPosition;
  /** The team he played FOR that week (player_stats.metadata.team). */
  team: string | null;
  opponent: string | null;
  ppr: number | null;
  half: number | null;
  std: number | null;
  /** Share of his team's offensive snaps, 0 to 1. Null when not recorded. */
  snapPct: number | null;
  stats: StatTotals;
};

/** Who a player is, for a row label and a link. */
export type PlayerRef = {
  id: string;
  slug: string;
  name: string;
  position: SeasonPosition;
  /** Today's team, which can differ from the team he played a past week for. */
  team: string | null;
  sleeperId: string | null;
};

/** One player's season to date on the leaders board. */
export type BoardPlayer = PlayerRef & {
  /**
   * Points by week, index 0 is week 1. Null is a week he did not play (a bye,
   * an inactive, or a week not reached yet), never a zero.
   */
  weeks: (number | null)[];
  /** His positional finish each week he played. Same indexing, null likewise. */
  weekRanks: (number | null)[];
  total: number;
  games: number;
  /** total / games. Null with no games. */
  perGame: number | null;
  /** Rank within the position by total points. Ties share a rank. */
  rank: number;
  /** Rank within the position by points per game, among qualified players. */
  perGameRank: number | null;
  /** Weeks finished inside the starting range at the position. */
  starterWeeks: number;
  best: number | null;
  worst: number | null;
  stats: StatTotals;
  /** Mean share of offensive snaps across the weeks it was recorded. */
  snapPct: number | null;
  /** Mean share of team targets across the weeks it was recorded. */
  targetShare: number | null;
};

export type SeasonBoard = {
  season: number;
  /** The last week any row was read for, complete or not. */
  throughWeek: number;
  /** The newest week every game of has been played. 0 before week 1 ends. */
  lastCompletedWeek: number;
  scoring: SeasonScoring;
  /** Every player with a game this season, ordered by position then rank. */
  players: BoardPlayer[];
  /** How many players were ranked at each position. */
  rankedByPosition: Record<SeasonPosition, number>;
  computedAt: string;
};

/** A player's week against the projection published for it. */
export type GradedWeek = {
  playerId: string;
  week: number;
  position: SeasonPosition;
  projected: number;
  actual: number;
};

export type PositionGrade = {
  position: SeasonPosition | "ALL";
  graded: number;
  /** Share of graded weeks the player met or beat the projection, 0 to 1. */
  beatRate: number | null;
  /** Mean of |actual - projected|. */
  averageMiss: number | null;
  /** Mean of actual - projected. Positive means the projection ran low. */
  lean: number | null;
};

export type ReliabilityRow = PlayerRef & {
  graded: number;
  beats: number;
  /** Mean projected points across his graded weeks. */
  averageProjected: number;
  /** Mean of actual - projected across his graded weeks. */
  averageDiff: number;
};

export type ProjectionReport = {
  /** Display name of the projection engine the grades are against. */
  sourceName: string;
  season: PositionGrade[];
  byWeek: { week: number; graded: number; beatRate: number | null }[];
  mostReliable: ReliabilityRow[];
  leastReliable: ReliabilityRow[];
};

/** One player's week, for a spotlight card or a top scorers list. */
export type WeekPerformance = PlayerRef & {
  week: number;
  /** The team he played for that week. */
  gameTeam: string | null;
  opponent: string | null;
  points: number;
  /** Positional finish for the week. */
  weekRank: number;
  projected: number | null;
  /** points - projected. Null with no projection. */
  diff: number | null;
  /** The box score as a sentence. */
  line: string;
};

export type WeekSpotlights = {
  week: number;
  /** The highest scores of the week, any position. */
  best: WeekPerformance[];
  /** The biggest beats of a real projection. */
  beats: WeekPerformance[];
  /** A big week from a player projected for little, or not projected at all. */
  surprises: WeekPerformance[];
  /** A small week from a player projected for a lot. */
  letdowns: WeekPerformance[];
  /** Top scorers at each position. */
  byPosition: Record<SeasonPosition, WeekPerformance[]>;
};

/** One finished game. */
export type GameResult = {
  /** "ATL-GB": away first. Matches the Beacon Brief's game anchors. */
  gameKey: string;
  week: number;
  kickoffAt: string | null;
  away: TeamSide;
  home: TeamSide;
  winner: string | null;
  /** "GB -4.5" or null with no line. */
  spreadText: string | null;
  /** "GB covered -4.5", "Push against the spread", or null with no line. */
  coverText: string | null;
  total: number | null;
  totalResult: "over" | "under" | "push" | null;
  /** The best fantasy lines of the game, both teams, in the reader's scoring. */
  topLines: WeekPerformance[];
  /** The Beacon Brief's headline for the game, when an edition is published. */
  recapHeadline: string | null;
  /** The opening of the desk's recap, as plain text. */
  recapTeaser: string | null;
  /** Path to the recap on the Brief edition, when there is one. */
  recapHref: string | null;
};

export type TeamSide = {
  code: string;
  name: string;
  nickname: string;
  color: string | null;
  score: number | null;
  implied: number | null;
};

/** The newest forecast for one game, or the fact that it is indoors. */
export type GameWeather = {
  isIndoor: boolean;
  /** outdoors, dome or retractable. Null when the venue is unknown. */
  roof: "outdoors" | "dome" | "retractable" | null;
  stadium: string | null;
  city: string | null;
  provider: string | null;
  fetchedAt: string | null;
  leadHours: number | null;
  tempF: number | null;
  feelsLikeF: number | null;
  windMph: number | null;
  windGustMph: number | null;
  windDirDeg: number | null;
  windMphMax3h: number | null;
  precipProbPct: number | null;
  precipIn: number | null;
  snowIn: number | null;
  humidityPct: number | null;
  conditions: string | null;
};

/** One game that has not been played yet. */
export type UpcomingGame = {
  gameKey: string;
  week: number;
  kickoffAt: string | null;
  away: TeamSide;
  home: TeamSide;
  /** Home spread; negative means the home side is favoured. */
  homeSpread: number | null;
  total: number | null;
  /** Where it is played, from the forecast row's stadium or the schedule row. */
  venue: string | null;
  /** Null when no forecast row exists. Never read as calm. */
  weather: GameWeather | null;
  /** Display name of the projection engine behind `toWatch`. */
  projectedBy: string;
  /** The players projected to score the most, both teams. */
  toWatch: (PlayerRef & { projected: number; gameTeam: string | null })[];
  /** Template sentences, each citing a figure on the card. */
  preview: string[];
};

export type TeamRecord = {
  code: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  games: number;
};

export type DefenseVsPositionRow = {
  team: string;
  name: string;
  /** Keyed by position: fantasy points allowed per game and the rank, 1 = most. */
  cells: Partial<Record<SeasonPosition, { perGame: number; rank: number; games: number }>>;
};
