/**
 * Code fallbacks for long_shot_settings (plan section 21). A missing or
 * corrupt row degrades to these, so the game keeps running.
 */

import type { LongShotSettings, TemplateKey, TemplateSettings } from "./types";

const TEMPLATE_DEFAULT: TemplateSettings = { enabled: true, min_answers: 8, max_answers: 60 };

const templates = {
  game_line: { ...TEMPLATE_DEFAULT },
  opponent_line: { ...TEMPLATE_DEFAULT },
  season_finish: { ...TEMPLATE_DEFAULT },
  market_rank: { ...TEMPLATE_DEFAULT },
  value_mover: { ...TEMPLATE_DEFAULT },
  waiver_wire: { ...TEMPLATE_DEFAULT },
  league_trades: { ...TEMPLATE_DEFAULT },
} satisfies Record<TemplateKey, TemplateSettings>;

export const DEFAULT_LONG_SHOT_SETTINGS: LongShotSettings = {
  game_enabled: true,
  timer: { seconds: 30, grace_seconds: 2 },
  tiers: {
    cutoffs: { long_shot: 0.1, sleeper: 0.25, deep: 0.5, field: 0.75 },
    points: { chalk: 10, field: 30, deep: 60, sleeper: 85, long_shot: 100 },
    min_rate_leagues: 50,
  },
  bonus: { min_room: 20, lone_share: 0.05, points: 15 },
  templates,
  leaderboards: { enabled: true, hide_admin_users: true },
  film_room_enabled: true,
};

/** Clamp ranges, shown in the admin form's help text and enforced on save. */
export const LONG_SHOT_SETTING_BOUNDS = {
  timer_seconds: { min: 10, max: 120 },
  grace_seconds: { min: 0, max: 10 },
  tier_points: { min: 0, max: 1000 },
  min_rate_leagues: { min: 1, max: 100_000 },
  min_room: { min: 1, max: 10_000 },
  bonus_points: { min: 0, max: 500 },
  min_answers: { min: 3, max: 200 },
  max_answers: { min: 3, max: 500 },
} as const;
