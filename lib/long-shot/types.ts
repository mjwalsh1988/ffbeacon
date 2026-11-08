/**
 * Long Shot, the daily rarity game. Shared shapes.
 * Plan of record: docs/completed/long-shot/long-shot-plan.md.
 *
 * Rules that every module in lib/long-shot/ keeps:
 *
 * - Two modes. Hurry-Up (`hurry_up`) is timed, the default, one per user per
 *   Eastern game date, and the ONLY mode with streaks, boards, stats, tallies
 *   and the settled bonus. Film Room (`film_room`) is untimed practice:
 *   nothing it produces is tracked, ranked, counted or shown to anyone but
 *   the player. lib/long-shot/film-room-guard.test.ts holds that line.
 * - Film Room on today's puzzle opens only once today's Hurry-Up is completed
 *   or abandoned; before that it plays the most recent past game date.
 * - At most one active attempt per user across both modes.
 * - The game requires an account. A signed-out visitor gets a browser-only
 *   demo that never touches today's puzzle, the search API or the database.
 * - The prompt rows' answer sets never reach a browser. A route returns the
 *   prompt text, and the room figures only after the player's own answer is
 *   recorded.
 */

export type Tier = "chalk" | "field" | "deep" | "sleeper" | "long_shot";

/** Lowest to highest. */
export const TIERS: readonly Tier[] = ["chalk", "field", "deep", "sleeper", "long_shot"];

export const TIER_WORDS: Record<Tier, string> = {
  chalk: "Chalk",
  field: "Field",
  deep: "Deep",
  sleeper: "Sleeper",
  long_shot: "Long Shot",
};

/** The one-letter share code; X is a miss or a timeout. */
export const TIER_LETTERS: Record<Tier, string> = {
  chalk: "C",
  field: "F",
  deep: "D",
  sleeper: "S",
  long_shot: "L",
};
export const MISS_LETTER = "X";

export type Mode = "hurry_up" | "film_room";

export const MODE_NAMES: Record<Mode, string> = {
  hurry_up: "Hurry-Up",
  film_room: "Film Room",
};

export const ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type EligiblePosition = (typeof ELIGIBLE_POSITIONS)[number];

/** Oldest season player_stats holds; `seasons` runs from here to now. */
export const STATS_FLOOR_SEASON = 2020;

export type TemplateKey =
  | "game_line"
  | "opponent_line"
  | "season_finish"
  | "market_rank"
  | "value_mover"
  | "waiver_wire"
  | "league_trades";

export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  "game_line",
  "opponent_line",
  "season_finish",
  "market_rank",
  "value_mover",
  "waiver_wire",
  "league_trades",
];

/** One entry of a prompt's frozen answer set (long_shot_prompts.answers). */
export interface AnswerEntry {
  player_id: string;
  tier: Tier;
  rate: number;
}

export type AttemptStatus = "active" | "completed" | "abandoned";
export type AnswerState = "pending" | "answered" | "timed_out" | "skipped";

export interface TierCutoffs {
  long_shot: number;
  sleeper: number;
  deep: number;
  field: number;
}

export interface TemplateSettings {
  enabled: boolean;
  min_answers: number;
  max_answers: number;
}

export interface LongShotSettings {
  game_enabled: boolean;
  timer: { seconds: number; grace_seconds: number };
  tiers: {
    cutoffs: TierCutoffs;
    points: Record<Tier, number>;
    min_rate_leagues: number;
  };
  bonus: { min_room: number; lone_share: number; points: number };
  templates: Record<TemplateKey, TemplateSettings>;
  leaderboards: { enabled: boolean; hide_admin_users: boolean };
  film_room_enabled: boolean;
}

/** One answered (or pending) prompt as the browser may see it. */
export interface AnswerSummaryDto {
  position: number;
  state: AnswerState;
  tier: Tier | null;
  points: number;
  playerName: string | null;
  playerSlug: string | null;
  sleeperId: string | null;
  teamCode: string | null;
  loneSignal: boolean;
}

/** An attempt as the browser may see it: no answer set, no other prompt text. */
export interface AttemptDto {
  attemptId: string;
  mode: Mode;
  gameDate: string;
  status: AttemptStatus;
  promptCount: number;
  currentPosition: number;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  settled: boolean;
  /** True when the prompt at currentPosition has been served and its clock is running. */
  hasPending: boolean;
  answers: AnswerSummaryDto[];
}

export interface PromptDto {
  kind: "prompt";
  attemptId: string;
  position: number;
  promptCount: number;
  promptText: string;
  /** Hurry-Up only; grace is never included. Null in Film Room. */
  remainingMs: number | null;
  /** The limit frozen on the attempt when it started; null in Film Room. */
  timerSeconds: number | null;
  mode: Mode;
  gameDate: string;
  basePoints: number;
  answers: AnswerSummaryDto[];
}

export interface CompletedDto {
  kind: "completed";
  attempt: AttemptDto;
  /** Today's rank among completed Hurry-Up attempts so far; null in Film Room. */
  rank: number | null;
  currentStreak: number | null;
  bestDayPoints: number | null;
}

export interface MostGivenDto {
  playerName: string;
  slug: string | null;
  sleeperId: string | null;
  teamCode: string | null;
  tier: Tier;
  count: number;
}

export interface TeamTonesDto {
  code: string;
  primary: string;
  secondary: string;
  tertiary: string | null;
}

export interface ResultDto {
  position: number;
  state: Exclude<AnswerState, "pending">;
  tier: Tier | null;
  points: number;
  correct: boolean;
  playerName: string | null;
  playerSlug: string | null;
  sleeperId: string | null;
  teamCode: string | null;
  team: TeamTonesDto | null;
  roomCount: number;
  roomTotal: number;
  mostGiven: MostGivenDto[];
  basePoints: number;
  next: { kind: "next"; position: number; promptCount: number } | CompletedDto;
}

export interface DayRecordDto {
  gameDate: string;
  status: "completed" | "abandoned" | "none";
  /** One letter per prompt (C F D S L X), a dash per unanswered prompt. */
  letters: string[];
}

export interface StatsDto {
  daysPlayed: number;
  currentStreak: number;
  bestStreak: number;
  totalPoints: number;
  bestDayPoints: number;
  longShots: number;
  loneSignals: number;
  lastSeven: DayRecordDto[];
}

export interface YesterdayDto {
  gameDate: string;
  settled: boolean;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  loneSignalPrompts: Array<{ promptText: string; playerName: string }>;
  rank: number | null;
}

export interface PageStateDto {
  gameDate: string;
  puzzle: { status: "ready" | "short"; promptCount: number } | null;
  active: AttemptDto | null;
  hurryUpToday: AttemptDto | null;
  stats: StatsDto | null;
  yesterday: YesterdayDto | null;
  /** Rank and streak for a completed Hurry-Up today, for the completion panel. */
  todayCompleted: CompletedDto | null;
}
