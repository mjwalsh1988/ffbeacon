/**
 * Types for Signal Scout, the "guess the player from signals" game.
 *
 * The admin-editable settings document mirrors the FAAB / On The Clock
 * pattern: code holds the fallback defaults in default-settings.ts; the
 * admin page persists overrides to the single-row signal_scout_settings
 * table. settings.ts holds the Zod schema and the loader.
 *
 * NOTE: settings field names use snake_case (not the camelCase used by the
 * FAAB / On The Clock settings documents) to match the approved plan's
 * settings shape (plan section 18) verbatim.
 */

/** Signal reveal tiers, from cheapest/least revealing to most expensive/most revealing. */
export type SignalTier = "weak" | "clear" | "ping" | "scan";

/** Positions eligible for the daily/guest player pool. */
export type EligiblePosition = "QB" | "RB" | "WR" | "TE";

export interface ScoringSettings {
  starting_score: number;
  weak_signal_cost: number;
  clear_signal_cost: number;
  beacon_ping_cost: number;
  full_scan_cost: number;
  wrong_guess_penalty: number;
  max_wrong_guesses: number;
}

/** Max clues offered per signal tier. */
export interface ClueTierLimits {
  weak: number;
  clear: number;
  ping: number;
  scan: number;
}

export interface ClueSettings {
  starter_clue_count: number;
  tier_limits: ClueTierLimits;
  /** Clue keys disabled admin-side (e.g. a clue that leaks the answer). */
  disabled_clue_keys: string[];
}

export interface PoolSettings {
  eligible_positions: EligiblePosition[];
}

export interface LeaderboardSettings {
  leaderboard_enabled: boolean;
  daily_enabled: boolean;
  all_time_enabled: boolean;
  streak_enabled: boolean;
  require_login: boolean;
  hide_admin_users: boolean;
}

export interface RevealSettings {
  show_player_images: boolean;
}

/** Toggles for not-yet-shipped modes, gated off until built. */
export interface FutureSettings {
  difficulty_mode_enabled: boolean;
  my_league_mode_enabled: boolean;
}

export interface SignalScoutSettings {
  game_enabled: boolean;
  guest_play_enabled: boolean;
  guest_daily_round_limit: number;
  scoring: ScoringSettings;
  clues: ClueSettings;
  pool: PoolSettings;
  leaderboards: LeaderboardSettings;
  reveal: RevealSettings;
  future: FutureSettings;
}
