/**
 * Load + validate FAAB calculator settings.
 *
 * Settings live as a single jsonb row (id = 'global') in
 * faab_calculator_settings, written only by the admin server action via the
 * service role. The public page reads them with the service-role client
 * server-side (same pattern as Signal Check). DEFAULT_FAAB_SETTINGS is the
 * fallback so a missing/corrupt row degrades gracefully instead of breaking the
 * calculator.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { FaabSettings } from "./types";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";

type Client = SupabaseClient<Database>;

export const FAAB_SETTINGS_ID = "global";

const d = DEFAULT_FAAB_SETTINGS;

const needLevel = z.enum(["low", "medium", "high"]);

const pct = z.number().min(0).max(100);
const nonNegative = z.number().min(0);
const unitInterval = z.number().min(0).max(1);

/** The shared shape of a league-mode signal: an on/off switch and a ceiling on
 * how far it can move a bid. Extended per signal with its own extra fields. */
const signalToggle = z.object({
  enabled: z.boolean().default(true),
  maxAdjustPct: pct.default(15),
});

const pctRange = z
  .object({ minPct: pct, maxPct: pct })
  .refine((r) => r.minPct <= r.maxPct, { message: "minPct must be <= maxPct" });

const bidBand = z
  .object({
    id: z.string().min(1),
    minRatio: nonNegative,
    maxRatio: nonNegative.nullable(),
    tierLabel: z.string().min(1),
    minPct: pct,
    maxPct: pct,
    capPct: pct,
  })
  .refine((b) => b.minPct <= b.maxPct, { message: "band minPct must be <= maxPct" })
  .refine((b) => b.maxRatio === null || b.minRatio <= b.maxRatio, {
    message: "band minRatio must be <= maxRatio",
  });

// Each field carries a default so a partial or older row is filled in rather
// than rejected on load. Wrong types still fail validation.
export const faabSettingsSchema = z.object({
  userDefaults: z
    .object({
      defaultTeams: z.number().int().positive().default(d.userDefaults.defaultTeams),
      teamOptions: z.array(z.number().int().positive()).min(1).default(d.userDefaults.teamOptions),
      defaultStarters: z.number().int().positive().default(d.userDefaults.defaultStarters),
      starterOptions: z.array(z.number().int().positive()).min(1).default(d.userDefaults.starterOptions),
      defaultNeed: needLevel.default(d.userDefaults.defaultNeed),
      defaultBudget: z.number().int().positive().default(d.userDefaults.defaultBudget),
    })
    .default(d.userDefaults),

  bidCurve: z.array(bidBand).min(1).default(d.bidCurve),

  depthAdjustments: z
    .object({
      shallowMaxDemand: nonNegative.default(d.depthAdjustments.shallowMaxDemand),
      standardMaxDemand: nonNegative.default(d.depthAdjustments.standardMaxDemand),
      eliteRatioMax: nonNegative.default(d.depthAdjustments.eliteRatioMax),
      depthRatioMin: nonNegative.default(d.depthAdjustments.depthRatioMin),
      shallowEliteBoostPct: z.number().default(d.depthAdjustments.shallowEliteBoostPct),
      shallowDepthCutPct: z.number().default(d.depthAdjustments.shallowDepthCutPct),
      deepEliteBoostReductionPct: z.number().default(d.depthAdjustments.deepEliteBoostReductionPct),
      deepDepthBoostPct: z.number().default(d.depthAdjustments.deepDepthBoostPct),
    })
    .default(d.depthAdjustments)
    .refine((a) => a.shallowMaxDemand <= a.standardMaxDemand, {
      message: "shallowMaxDemand must be <= standardMaxDemand",
    }),

  needMultipliers: z
    .object({
      low: nonNegative.default(d.needMultipliers.low),
      medium: nonNegative.default(d.needMultipliers.medium),
      high: nonNegative.default(d.needMultipliers.high),
    })
    .default(d.needMultipliers),

  dump: z
    .object({
      enabled: z.boolean().default(d.dump.enabled),
      thresholdRatio: nonNegative.default(d.dump.thresholdRatio),
      valueScoreThreshold: nonNegative.default(d.dump.valueScoreThreshold),
      ranges: z
        .object({
          low: pctRange.default(d.dump.ranges.low),
          medium: pctRange.default(d.dump.ranges.medium),
          high: pctRange.default(d.dump.ranges.high),
        })
        .default(d.dump.ranges),
    })
    .default(d.dump),

  valueNormalization: z
    .object({
      replacementRankMultiplier: z.number().positive().default(d.valueNormalization.replacementRankMultiplier),
      eliteRankMultiplier: z.number().positive().default(d.valueNormalization.eliteRankMultiplier),
      valueScoreClampMin: z.number().default(d.valueNormalization.valueScoreClampMin),
      valueScoreClampMax: z.number().default(d.valueNormalization.valueScoreClampMax),
      valueScoreNeutral: z.number().default(d.valueNormalization.valueScoreNeutral),
      valueAdjustmentMaxPct: z.number().min(0).max(100).default(d.valueNormalization.valueAdjustmentMaxPct),
    })
    .default(d.valueNormalization)
    .refine((v) => v.valueScoreClampMin < v.valueScoreClampMax, {
      message: "valueScoreClampMin must be < valueScoreClampMax",
    }),

  copy: z
    .object({
      economyNotice: z.string().default(d.copy.economyNotice),
      missingValueNote: z.string().default(d.copy.missingValueNote),
      dumpNote: z.string().default(d.copy.dumpNote),
      teamsHelp: z.string().default(d.copy.teamsHelp),
      startersHelp: z.string().default(d.copy.startersHelp),
      leagueModeNotice: z.string().default(d.copy.leagueModeNotice),
      thinDataNote: z.string().default(d.copy.thinDataNote),
    })
    .default(d.copy),

  marginal: z
    .object({
      bigUpgradePointsPerWeek: z.number().positive().default(d.marginal.bigUpgradePointsPerWeek),
      bigUpgradeOddsPoints: z.number().positive().default(d.marginal.bigUpgradeOddsPoints),
      oddsWeight: unitInterval.default(d.marginal.oddsWeight),
      // Capped so an admin cannot make an on-demand page view run a
      // hundred-thousand-iteration simulation twice.
      simulationRuns: z.number().int().min(200).max(20000).default(d.marginal.simulationRuns),
      maxPctFromUpgrade: pct.default(d.marginal.maxPctFromUpgrade),
      minMeaningfulPointsPerWeek: nonNegative.default(d.marginal.minMeaningfulPointsPerWeek),
    })
    .default(d.marginal),

  signals: z
    .object({
      beatRate: signalToggle
        .extend({
          neutral: unitInterval.default(d.signals.beatRate.neutral),
          minWeeks: z.number().int().min(0).default(d.signals.beatRate.minWeeks),
        })
        .default(d.signals.beatRate),
      availability: signalToggle
        .extend({ neutral: unitInterval.default(d.signals.availability.neutral) })
        .default(d.signals.availability),
      volatility: z
        .object({
          enabled: z.boolean().default(d.signals.volatility.enabled),
          neutral: nonNegative.default(d.signals.volatility.neutral),
          maxSpreadPct: pct.default(d.signals.volatility.maxSpreadPct),
        })
        .default(d.signals.volatility),
      opportunity: signalToggle
        .extend({
          minTeamSnaps: nonNegative.default(d.signals.opportunity.minTeamSnaps),
          breakoutDeltaPoints: pct.default(d.signals.opportunity.breakoutDeltaPoints),
          collapseDeltaPoints: pct.default(d.signals.opportunity.collapseDeltaPoints),
          recentGames: z.number().int().min(1).max(8).default(d.signals.opportunity.recentGames),
        })
        .default(d.signals.opportunity),
      matchup: signalToggle.default(d.signals.matchup),
      ceiling: z
        .object({
          enabled: z.boolean().default(d.signals.ceiling.enabled),
          lookbackSeasons: z.number().int().min(1).max(10).default(d.signals.ceiling.lookbackSeasons),
        })
        .default(d.signals.ceiling),
    })
    .default(d.signals),

  market: z
    .object({
      rivalBudget: signalToggle.default(d.market.rivalBudget),
      rivalNeed: signalToggle
        .extend({ minPointsPerWeek: nonNegative.default(d.market.rivalNeed.minPointsPerWeek) })
        .default(d.market.rivalNeed),
      history: z
        .object({
          enabled: z.boolean().default(d.market.history.enabled),
          minSamples: z.number().int().min(1).default(d.market.history.minSamples),
          lookbackSeasons: z.number().int().min(1).max(10).default(d.market.history.lookbackSeasons),
          blendWeight: unitInterval.default(d.market.history.blendWeight),
        })
        .default(d.market.history),
      urgency: z
        .object({
          enabled: z.boolean().default(d.market.urgency.enabled),
          lateSeasonWeek: z.number().int().min(1).max(18).default(d.market.urgency.lateSeasonWeek),
          maxLateBoostPct: z.number().min(0).max(300).default(d.market.urgency.maxLateBoostPct),
          earlySeasonWeek: z.number().int().min(0).max(18).default(d.market.urgency.earlySeasonWeek),
          maxEarlyDiscountPct: pct.default(d.market.urgency.maxEarlyDiscountPct),
        })
        .default(d.market.urgency)
        .refine((u) => u.earlySeasonWeek < u.lateSeasonWeek, {
          message: "earlySeasonWeek must be before lateSeasonWeek",
        }),
    })
    .default(d.market),

  ladder: z
    .object({
      walkAwayTrimPct: pct.default(d.ladder.walkAwayTrimPct),
      aggressiveAbovePct: z.number().min(0).max(300).default(d.ladder.aggressiveAbovePct),
      minStartableBid: z.number().int().min(0).default(d.ladder.minStartableBid),
    })
    .default(d.ladder),

  manualReplacement: z
    .object({
      startersPerTeam: z
        .record(z.string(), z.number().min(0))
        .default(d.manualReplacement.startersPerTeam),
      baselineStarters: z
        .number()
        .positive()
        .default(d.manualReplacement.baselineStarters),
      flatPositions: z.array(z.string()).default(d.manualReplacement.flatPositions),
    })
    .default(d.manualReplacement),

  leagueDump: z
    .object({
      enabled: z.boolean().default(d.leagueDump.enabled),
      oddsPointsThreshold: pct.default(d.leagueDump.oddsPointsThreshold),
      pointsPerWeekThreshold: nonNegative.default(d.leagueDump.pointsPerWeekThreshold),
      loserOddsCeiling: pct.default(d.leagueDump.loserOddsCeiling),
      ranges: z
        .object({
          low: pctRange.default(d.leagueDump.ranges.low),
          medium: pctRange.default(d.leagueDump.ranges.medium),
          high: pctRange.default(d.leagueDump.ranges.high),
        })
        .default(d.leagueDump.ranges),
    })
    .default(d.leagueDump),
}).superRefine((s, ctx) => {
  // The bid curve must cover every playerRatio from 0 upward with no gaps, so a
  // valid player can never fall through to the wrong band. Enforce: starts at 0,
  // exactly one open-ended (null max) band which must be last, and contiguous
  // boundaries (band i's max == band i+1's min).
  const bands = s.bidCurve;
  if (bands.length === 0) return;
  if (bands[0].minRatio > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bidCurve", 0, "minRatio"],
      message: "The first band must start at ratio 0 so elite players are covered.",
    });
  }
  const openEnded = bands.filter((b) => b.maxRatio === null).length;
  if (openEnded !== 1 || bands[bands.length - 1].maxRatio !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bidCurve"],
      message: "Exactly one band, the last, must have no upper limit (open-ended).",
    });
  }
  for (let i = 0; i < bands.length - 1; i++) {
    const max = bands[i].maxRatio;
    if (max === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bidCurve", i, "maxRatio"],
        message: "Only the last band may be open-ended.",
      });
      continue;
    }
    if (Math.abs(max - bands[i + 1].minRatio) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bidCurve", i + 1, "minRatio"],
        message: `Band ${i + 2} must start where band ${i + 1} ends so the curve has no gaps.`,
      });
    }
  }
});

export type ParsedFaabSettings = z.infer<typeof faabSettingsSchema>;

export type ValidateResult =
  | { ok: true; settings: FaabSettings }
  | { ok: false; error: string };

/** Validate an untrusted settings object (admin save path). */
export function validateFaabSettings(raw: unknown): ValidateResult {
  const parsed = faabSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") ?? "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true, settings: parsed.data as FaabSettings };
}

/**
 * Load settings for the calculator. Always returns a complete, valid object:
 * the stored row is merged onto defaults via the schema's per-field defaults,
 * and any failure falls back to DEFAULT_FAAB_SETTINGS.
 */
export async function loadFaabSettings(supabase: Client): Promise<FaabSettings> {
  const { data, error } = await supabase
    .from("faab_calculator_settings")
    .select("settings")
    .eq("id", FAAB_SETTINGS_ID)
    .maybeSingle();

  if (error || !data?.settings) return { ...DEFAULT_FAAB_SETTINGS };

  const parsed = faabSettingsSchema.safeParse(data.settings);
  if (!parsed.success) {
    console.error("[faab] stored settings invalid, using defaults", parsed.error.issues);
    return { ...DEFAULT_FAAB_SETTINGS };
  }
  return parsed.data as FaabSettings;
}
