/**
 * Load + validate On The Clock settings.
 *
 * Settings live as a single jsonb row (id = 'global') in on_the_clock_settings,
 * written only by the admin server action via the service role (the table is
 * service-role-only RLS). The public tool reads them server-side with the
 * service-role client. DEFAULT_ON_THE_CLOCK_SETTINGS is the fallback so a missing
 * or corrupt row degrades gracefully instead of breaking the tool.
 *
 * Mirrors the FAAB settings pattern: each field carries a default so a partial or
 * older row is filled in rather than rejected; wrong types still fail validation.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OnTheClockSettings } from "./types";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";

type Client = SupabaseClient<Database>;

export const ON_THE_CLOCK_SETTINGS_ID = "global";

const d = DEFAULT_ON_THE_CLOCK_SETTINGS;

const playerPool = z.enum(["everyone", "rookies"]);
const aggressiveness = z.enum(["conservative", "balanced", "aggressive"]);
const dstkBehavior = z.enum(["suppress_until_need", "never", "always_allowed"]);

const nonNegative = z.number().min(0);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().min(0);

export const onTheClockSettingsSchema = z.object({
  feature: z
    .object({
      enabled: z.boolean().default(d.feature.enabled),
    })
    .default(d.feature),

  sourceFormat: z
    .object({
      defaultRankingSource: z.string().min(1).nullable().default(d.sourceFormat.defaultRankingSource),
      defaultFormatFallback: z.string().min(1).default(d.sourceFormat.defaultFormatFallback),
    })
    .default(d.sourceFormat),

  pools: z
    .object({
      enabledPools: z.array(playerPool).min(1).default(d.pools.enabledPools),
      defaultPool: playerPool.default(d.pools.defaultPool),
    })
    .default(d.pools)
    .refine((p) => p.enabledPools.includes(p.defaultPool), {
      message: "defaultPool must be one of enabledPools",
    }),

  sync: z
    .object({
      cooldownSeconds: positiveInt.default(d.sync.cooldownSeconds),
      lockSeconds: positiveInt.default(d.sync.lockSeconds),
      realtimeEnabled: z.boolean().default(d.sync.realtimeEnabled),
    })
    .default(d.sync)
    .refine((s) => s.lockSeconds <= s.cooldownSeconds, {
      message: "lockSeconds must be <= cooldownSeconds",
    }),

  cache: z
    .object({
      activeTtlHours: positiveInt.default(d.cache.activeTtlHours),
      completedRetentionHours: positiveInt.default(d.cache.completedRetentionHours),
    })
    .default(d.cache),

  limits: z
    .object({
      maxActiveLeagues: positiveInt.default(d.limits.maxActiveLeagues),
      maxAvailablePlayers: positiveInt.default(d.limits.maxAvailablePlayers),
    })
    .default(d.limits),

  recommendation: z
    .object({
      teamNeedEnabled: z.boolean().default(d.recommendation.teamNeedEnabled),
      aggressiveness: aggressiveness.default(d.recommendation.aggressiveness),
      weights: z
        .object({
          value: nonNegative.default(d.recommendation.weights.value),
          need: nonNegative.default(d.recommendation.weights.need),
          reach: nonNegative.default(d.recommendation.weights.reach),
        })
        .default(d.recommendation.weights),
      maxReachTierBreak: nonNegative.default(d.recommendation.maxReachTierBreak),
    })
    .default(d.recommendation),

  dstk: z
    .object({
      includedInRoom: z.boolean().default(d.dstk.includedInRoom),
      recommendBehavior: dstkBehavior.default(d.dstk.recommendBehavior),
      requireStartingSlot: z.boolean().default(d.dstk.requireStartingSlot),
      minRoundForDst: positiveInt.default(d.dstk.minRoundForDst),
      minRoundForK: positiveInt.default(d.dstk.minRoundForK),
    })
    .default(d.dstk),

  positionAdjust: z
    .object({
      superflexQbMultiplier: z.number().positive().default(d.positionAdjust.superflexQbMultiplier),
      tePremiumMultiplier: z.number().positive().default(d.positionAdjust.tePremiumMultiplier),
    })
    .default(d.positionAdjust),

  positionFallbackTargets: z
    .object({
      QB: nonNegativeInt.default(d.positionFallbackTargets.QB),
      RB: nonNegativeInt.default(d.positionFallbackTargets.RB),
      WR: nonNegativeInt.default(d.positionFallbackTargets.WR),
      TE: nonNegativeInt.default(d.positionFallbackTargets.TE),
      FLEX: nonNegativeInt.default(d.positionFallbackTargets.FLEX),
      SUPER_FLEX: nonNegativeInt.default(d.positionFallbackTargets.SUPER_FLEX),
      K: nonNegativeInt.default(d.positionFallbackTargets.K),
      DEF: nonNegativeInt.default(d.positionFallbackTargets.DEF),
    })
    .default(d.positionFallbackTargets),

  valueIndicators: z
    .object({
      thresholdPicks: positiveInt.default(d.valueIndicators.thresholdPicks),
    })
    .default(d.valueIndicators),

  mappingVisibility: z
    .object({
      showUnmappedPanel: z.boolean().default(d.mappingVisibility.showUnmappedPanel),
    })
    .default(d.mappingVisibility),
});

export type ParsedOnTheClockSettings = z.infer<typeof onTheClockSettingsSchema>;

export type ValidateResult =
  | { ok: true; settings: OnTheClockSettings }
  | { ok: false; error: string };

/** Round and clamp n into [min, max]; falls back to `fallback` if not finite. */
function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
}

/** Clamp a float into [min, max]; falls back to `fallback` if not finite. */
function clampFloat(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

/**
 * Coerce an admin-edited settings object into safe ranges BEFORE validation, so a
 * fat-fingered number can never push the public tool into a dangerous state (a
 * 0-second cooldown that hammers Sleeper, a million-row board, a negative weight).
 * Unknown / unwired keys are passed through untouched. lockSeconds is additionally
 * clamped to never exceed cooldownSeconds so the schema refinement always holds.
 */
export function clampOnTheClockSettings(raw: OnTheClockSettings): OnTheClockSettings {
  const dd = DEFAULT_ON_THE_CLOCK_SETTINGS;
  const cooldownSeconds = clampInt(raw.sync?.cooldownSeconds, 5, 600, dd.sync.cooldownSeconds);
  const lockSeconds = Math.min(
    cooldownSeconds,
    clampInt(raw.sync?.lockSeconds, 1, 120, dd.sync.lockSeconds),
  );
  return {
    ...raw,
    sync: {
      ...raw.sync,
      cooldownSeconds,
      lockSeconds,
      realtimeEnabled: Boolean(raw.sync?.realtimeEnabled),
    },
    cache: {
      ...raw.cache,
      activeTtlHours: clampInt(raw.cache?.activeTtlHours, 1, 8760, dd.cache.activeTtlHours),
      completedRetentionHours: clampInt(
        raw.cache?.completedRetentionHours,
        1,
        8760,
        dd.cache.completedRetentionHours,
      ),
    },
    limits: {
      ...raw.limits,
      maxActiveLeagues: clampInt(raw.limits?.maxActiveLeagues, 1, 100, dd.limits.maxActiveLeagues),
      maxAvailablePlayers: clampInt(
        raw.limits?.maxAvailablePlayers,
        10,
        2000,
        dd.limits.maxAvailablePlayers,
      ),
    },
    recommendation: {
      ...raw.recommendation,
      weights: {
        value: clampFloat(raw.recommendation?.weights?.value, 0, 10, dd.recommendation.weights.value),
        need: clampFloat(raw.recommendation?.weights?.need, 0, 10, dd.recommendation.weights.need),
        reach: clampFloat(raw.recommendation?.weights?.reach, 0, 10, dd.recommendation.weights.reach),
      },
      maxReachTierBreak: clampFloat(
        raw.recommendation?.maxReachTierBreak,
        0,
        10,
        dd.recommendation.maxReachTierBreak,
      ),
    },
    dstk: {
      ...raw.dstk,
      minRoundForDst: clampInt(raw.dstk?.minRoundForDst, 1, 50, dd.dstk.minRoundForDst),
      minRoundForK: clampInt(raw.dstk?.minRoundForK, 1, 50, dd.dstk.minRoundForK),
    },
    positionAdjust: {
      ...raw.positionAdjust,
      superflexQbMultiplier: clampFloat(
        raw.positionAdjust?.superflexQbMultiplier,
        0.1,
        5,
        dd.positionAdjust.superflexQbMultiplier,
      ),
      tePremiumMultiplier: clampFloat(
        raw.positionAdjust?.tePremiumMultiplier,
        0.1,
        5,
        dd.positionAdjust.tePremiumMultiplier,
      ),
    },
    valueIndicators: {
      thresholdPicks: clampInt(
        raw.valueIndicators?.thresholdPicks,
        1,
        100,
        dd.valueIndicators.thresholdPicks,
      ),
    },
    positionFallbackTargets: {
      QB: clampInt(raw.positionFallbackTargets?.QB, 0, 20, dd.positionFallbackTargets.QB),
      RB: clampInt(raw.positionFallbackTargets?.RB, 0, 20, dd.positionFallbackTargets.RB),
      WR: clampInt(raw.positionFallbackTargets?.WR, 0, 20, dd.positionFallbackTargets.WR),
      TE: clampInt(raw.positionFallbackTargets?.TE, 0, 20, dd.positionFallbackTargets.TE),
      FLEX: clampInt(raw.positionFallbackTargets?.FLEX, 0, 20, dd.positionFallbackTargets.FLEX),
      SUPER_FLEX: clampInt(
        raw.positionFallbackTargets?.SUPER_FLEX,
        0,
        20,
        dd.positionFallbackTargets.SUPER_FLEX,
      ),
      K: clampInt(raw.positionFallbackTargets?.K, 0, 20, dd.positionFallbackTargets.K),
      DEF: clampInt(raw.positionFallbackTargets?.DEF, 0, 20, dd.positionFallbackTargets.DEF),
    },
  };
}

/** Validate an untrusted settings object (admin save path). */
export function validateOnTheClockSettings(raw: unknown): ValidateResult {
  const parsed = onTheClockSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") ?? "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true, settings: parsed.data as OnTheClockSettings };
}

/**
 * Load settings for the tool. Always returns a complete, valid object: the stored
 * row is merged onto defaults via the schema's per-field defaults, and any failure
 * falls back to DEFAULT_ON_THE_CLOCK_SETTINGS.
 */
export async function loadOnTheClockSettings(supabase: Client): Promise<OnTheClockSettings> {
  const { data, error } = await supabase
    .from("on_the_clock_settings")
    .select("settings")
    .eq("id", ON_THE_CLOCK_SETTINGS_ID)
    .maybeSingle();

  if (error || !data?.settings) return { ...DEFAULT_ON_THE_CLOCK_SETTINGS };

  const parsed = onTheClockSettingsSchema.safeParse(data.settings);
  if (!parsed.success) {
    console.error("[on-the-clock] stored settings invalid, using defaults", parsed.error.issues);
    return { ...DEFAULT_ON_THE_CLOCK_SETTINGS };
  }
  return parsed.data as OnTheClockSettings;
}
