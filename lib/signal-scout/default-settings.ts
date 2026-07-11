/**
 * Fallback defaults for Signal Scout, the "guess the player from signals" game.
 *
 * These are the single source of truth when signal_scout_settings has no row
 * (or fails to load), so the game degrades gracefully instead of breaking.
 * The admin page seeds these on first save. Keep every value plain and
 * source-agnostic: nothing here assumes a particular value scale.
 *
 * NOTE: there is deliberately NO minimum_correct_score field. The dead-signal
 * scoring model removed it; do not add one back.
 */

import type { SignalScoutSettings } from "./types";

export const DEFAULT_SIGNAL_SCOUT_SETTINGS: SignalScoutSettings = {
  game_enabled: true,
  guest_play_enabled: true,
  guest_daily_round_limit: 2,

  scoring: {
    starting_score: 1000,
    weak_signal_cost: 100,
    clear_signal_cost: 200,
    beacon_ping_cost: 350,
    full_scan_cost: 500,
    wrong_guess_penalty: 100,
    max_wrong_guesses: 3,
  },

  clues: {
    starter_clue_count: 3,
    tier_limits: {
      weak: 4,
      clear: 3,
      ping: 2,
      scan: 1,
    },
    disabled_clue_keys: [],
  },

  pool: {
    eligible_positions: ["QB", "RB", "WR", "TE"],
  },

  leaderboards: {
    leaderboard_enabled: true,
    daily_enabled: true,
    all_time_enabled: true,
    streak_enabled: true,
    require_login: true,
    hide_admin_users: true,
  },

  reveal: {
    show_player_images: true,
  },

  future: {
    difficulty_mode_enabled: false,
    my_league_mode_enabled: false,
  },
};
