/**
 * Load + validate Signal Scout settings.
 *
 * Settings live as a single jsonb row (id = 'global') in
 * signal_scout_settings, written only by the admin server action via the
 * service role (the table is service-role-only RLS). The public game reads
 * them server-side with the service-role client. DEFAULT_SIGNAL_SCOUT_SETTINGS
 * is the fallback so a missing or corrupt row degrades gracefully instead of
 * breaking the game.
 *
 * Mirrors the FAAB / On The Clock settings pattern: each field carries a
 * default so a partial or older row is filled in rather than rejected; wrong
 * types still fail validation.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { EligiblePosition, SignalScoutSettings } from "./types";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "./default-settings";
import { CLUE_DEFINITIONS } from "./clues";

type Client = SupabaseClient<Database>;

export const SIGNAL_SCOUT_SETTINGS_ID = "global";

const d = DEFAULT_SIGNAL_SCOUT_SETTINGS;

const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().positive();
const eligiblePosition = z.enum(["QB", "RB", "WR", "TE"]);

// Each field carries a default so a partial or older row is filled in rather
// than rejected on load. Wrong types still fail validation.
export const signalScoutSettingsSchema = z.object({
  game_enabled: z.boolean().default(d.game_enabled),
  guest_play_enabled: z.boolean().default(d.guest_play_enabled),
  guest_daily_round_limit: nonNegativeInt.default(d.guest_daily_round_limit),

  scoring: z
    .object({
      starting_score: positiveInt.default(d.scoring.starting_score),
      weak_signal_cost: nonNegativeInt.default(d.scoring.weak_signal_cost),
      clear_signal_cost: nonNegativeInt.default(d.scoring.clear_signal_cost),
      beacon_ping_cost: nonNegativeInt.default(d.scoring.beacon_ping_cost),
      full_scan_cost: nonNegativeInt.default(d.scoring.full_scan_cost),
      wrong_guess_penalty: nonNegativeInt.default(d.scoring.wrong_guess_penalty),
      max_wrong_guesses: positiveInt.default(d.scoring.max_wrong_guesses),
    })
    .default(d.scoring),

  clues: z
    .object({
      starter_clue_count: nonNegativeInt.default(d.clues.starter_clue_count),
      tier_limits: z
        .object({
          weak: nonNegativeInt.default(d.clues.tier_limits.weak),
          clear: nonNegativeInt.default(d.clues.tier_limits.clear),
          ping: nonNegativeInt.default(d.clues.tier_limits.ping),
          scan: nonNegativeInt.default(d.clues.tier_limits.scan),
        })
        .default(d.clues.tier_limits),
      disabled_clue_keys: z.array(z.string().min(1)).default(d.clues.disabled_clue_keys),
    })
    .default(d.clues),

  pool: z
    .object({
      eligible_positions: z.array(eligiblePosition).min(1).default(d.pool.eligible_positions),
    })
    .default(d.pool),

  leaderboards: z
    .object({
      leaderboard_enabled: z.boolean().default(d.leaderboards.leaderboard_enabled),
      daily_enabled: z.boolean().default(d.leaderboards.daily_enabled),
      all_time_enabled: z.boolean().default(d.leaderboards.all_time_enabled),
      streak_enabled: z.boolean().default(d.leaderboards.streak_enabled),
      require_login: z.boolean().default(d.leaderboards.require_login),
      hide_admin_users: z.boolean().default(d.leaderboards.hide_admin_users),
    })
    .default(d.leaderboards),

  reveal: z
    .object({
      show_player_images: z.boolean().default(d.reveal.show_player_images),
    })
    .default(d.reveal),

  future: z
    .object({
      difficulty_mode_enabled: z.boolean().default(d.future.difficulty_mode_enabled),
      my_league_mode_enabled: z.boolean().default(d.future.my_league_mode_enabled),
    })
    .default(d.future),
});

export type ParsedSignalScoutSettings = z.infer<typeof signalScoutSettingsSchema>;

export type ValidateResult =
  | { ok: true; settings: SignalScoutSettings }
  | { ok: false; error: string };

/** Validate an untrusted settings object (admin save path). */
export function validateSignalScoutSettings(raw: unknown): ValidateResult {
  const parsed = signalScoutSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") ?? "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true, settings: parsed.data as SignalScoutSettings };
}

const ELIGIBLE_POSITIONS: EligiblePosition[] = ["QB", "RB", "WR", "TE"];
const KNOWN_CLUE_KEYS = new Set(CLUE_DEFINITIONS.map((def) => def.key));

/** Round and clamp n into [min, max]; falls back to `fallback` if not finite. */
function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
}

/**
 * Coerce an admin-edited settings object into safe ranges BEFORE validation,
 * so a fat-fingered number can never push the public game into a dangerous
 * state (a zero starting score, a round with more wrong-guess allowance than
 * the schema can sanely support, a clue budget above the catalog). Unknown /
 * unwired keys are passed through untouched. Modeled on
 * clampOnTheClockSettings in lib/on-the-clock/settings.ts.
 *
 * pool.eligible_positions is intersected against the four known positions and
 * deduped; if that leaves an EMPTY array, the default pool is restored
 * instead, since an empty pool would brick every round start (there would be
 * no player left to target).
 *
 * clues.disabled_clue_keys is filtered to keys that exist in
 * CLUE_DEFINITIONS and deduped. This lives here (not in the actions file)
 * because lib/signal-scout/clues.ts imports only from ./types and
 * ./eligibility (type-only), never from ./settings, so importing
 * CLUE_DEFINITIONS here does not create a cycle.
 */
export function clampSignalScoutSettings(raw: SignalScoutSettings): SignalScoutSettings {
  const dd = DEFAULT_SIGNAL_SCOUT_SETTINGS;

  const dedupedPositions = Array.from(new Set(raw.pool?.eligible_positions ?? [])).filter(
    (p): p is EligiblePosition => ELIGIBLE_POSITIONS.includes(p as EligiblePosition),
  );
  const eligiblePositions = dedupedPositions.length > 0 ? dedupedPositions : dd.pool.eligible_positions;

  const dedupedClueKeys = Array.from(new Set(raw.clues?.disabled_clue_keys ?? []));
  const disabledClueKeys = dedupedClueKeys.filter((key) => KNOWN_CLUE_KEYS.has(key));

  return {
    ...raw,
    guest_play_enabled: Boolean(raw.guest_play_enabled),
    guest_daily_round_limit: clampInt(raw.guest_daily_round_limit, 0, 20, dd.guest_daily_round_limit),
    scoring: {
      ...raw.scoring,
      starting_score: clampInt(raw.scoring?.starting_score, 100, 10000, dd.scoring.starting_score),
      weak_signal_cost: clampInt(raw.scoring?.weak_signal_cost, 0, 5000, dd.scoring.weak_signal_cost),
      clear_signal_cost: clampInt(raw.scoring?.clear_signal_cost, 0, 5000, dd.scoring.clear_signal_cost),
      beacon_ping_cost: clampInt(raw.scoring?.beacon_ping_cost, 0, 5000, dd.scoring.beacon_ping_cost),
      full_scan_cost: clampInt(raw.scoring?.full_scan_cost, 0, 5000, dd.scoring.full_scan_cost),
      wrong_guess_penalty: clampInt(raw.scoring?.wrong_guess_penalty, 0, 5000, dd.scoring.wrong_guess_penalty),
      max_wrong_guesses: clampInt(raw.scoring?.max_wrong_guesses, 1, 10, dd.scoring.max_wrong_guesses),
    },
    clues: {
      ...raw.clues,
      starter_clue_count: clampInt(raw.clues?.starter_clue_count, 1, 6, dd.clues.starter_clue_count),
      tier_limits: {
        weak: clampInt(raw.clues?.tier_limits?.weak, 0, 10, dd.clues.tier_limits.weak),
        clear: clampInt(raw.clues?.tier_limits?.clear, 0, 10, dd.clues.tier_limits.clear),
        ping: clampInt(raw.clues?.tier_limits?.ping, 0, 10, dd.clues.tier_limits.ping),
        scan: clampInt(raw.clues?.tier_limits?.scan, 0, 10, dd.clues.tier_limits.scan),
      },
      disabled_clue_keys: disabledClueKeys,
    },
    pool: {
      ...raw.pool,
      eligible_positions: eligiblePositions,
    },
  };
}

/**
 * Load settings for the game. Always returns a complete, valid object: the
 * stored row is merged onto defaults via the schema's per-field defaults, and
 * any failure falls back to DEFAULT_SIGNAL_SCOUT_SETTINGS.
 */
export async function loadSignalScoutSettings(supabase: Client): Promise<SignalScoutSettings> {
  const { data, error } = await supabase
    .from("signal_scout_settings")
    .select("settings")
    .eq("id", SIGNAL_SCOUT_SETTINGS_ID)
    .maybeSingle();

  if (error || !data?.settings) return { ...DEFAULT_SIGNAL_SCOUT_SETTINGS };

  const parsed = signalScoutSettingsSchema.safeParse(data.settings);
  if (!parsed.success) {
    console.error("[signal-scout] stored settings invalid, using defaults", parsed.error.issues);
    return { ...DEFAULT_SIGNAL_SCOUT_SETTINGS };
  }
  return parsed.data as SignalScoutSettings;
}
