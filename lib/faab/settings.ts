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
import { memoTtl } from "@/lib/memo-ttl";

type Client = SupabaseClient<Database>;

export const FAAB_SETTINGS_ID = "global";

const d = DEFAULT_FAAB_SETTINGS;

const needLevel = z.enum(["low", "medium", "high"]);
const bidStyle = z.enum(["tight", "typical", "wild"]);
const goalKey = z.enum(["value", "sure"]);

const pct = z.number().min(0).max(100);
const nonNegative = z.number().min(0);
const unitInterval = z.number().min(0).max(1);

/** The shared shape of a league-mode signal: an on/off switch and a ceiling on
 * how far it can move a bid. Extended per signal with its own extra fields. */
const signalToggle = z.object({
  enabled: z.boolean().default(true),
  maxAdjustPct: pct.default(15),
});

/** A [min, max] pair, stored as a tuple so the admin form can edit both ends. */
const clampPair = z
  .tuple([z.number(), z.number()])
  .refine(([min, max]) => min < max, { message: "The lower clamp must be below the upper one." });

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
      defaultLastRegularWeek: z
        .number()
        .int()
        .min(10)
        .max(18)
        .default(d.userDefaults.defaultLastRegularWeek),
      defaultLeagueBudget: z
        .number()
        .int()
        .positive()
        .default(d.userDefaults.defaultLeagueBudget),
      defaultStyle: bidStyle.default(d.userDefaults.defaultStyle),
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

  dropGuard: z
    .object({
      enabled: z.boolean().default(d.dropGuard.enabled),
      useHealthyBaseline: z.boolean().default(d.dropGuard.useHealthyBaseline),
      // Above 1 the calculator would start naming players worth more than the
      // claim, which is the behavior this guard exists to stop.
      maxDropValueRatio: z.number().min(0).max(1).default(d.dropGuard.maxDropValueRatio),
      // Capped below 1 so a keeper roster always keeps a protected top.
      keeperBottomShare: z.number().min(0.05).max(0.9).default(d.dropGuard.keeperBottomShare),
      minValuedPlayers: z.number().int().min(0).default(d.dropGuard.minValuedPlayers),
    })
    .default(d.dropGuard),

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
      calendar: z
        .object({
          enabled: z.boolean().default(d.market.calendar.enabled),
          bands: z
            .array(
              z.object({
                fromWeek: z.number().int().min(1).max(18),
                toWeek: z.number().int().min(1).max(18).nullable(),
                multiplier: z.number().min(0.1).max(5),
              }),
            )
            .min(1)
            .default(d.market.calendar.bands),
        })
        .default(d.market.calendar)
        // Contiguous, in order, and open at the end. A gap would price one week
        // of the season at nothing, and an overlap would price it twice.
        .refine((c) => c.bands[0]?.fromWeek === 1, {
          message: "The first calendar band must start at week 1.",
        })
        .refine((c) => c.bands[c.bands.length - 1]?.toWeek === null, {
          message: "The last calendar band must run to the end of the season (toWeek null).",
        })
        .refine(
          (c) =>
            c.bands.every((band, i) => {
              if (i === c.bands.length - 1) return true;
              return band.toWeek !== null && c.bands[i + 1].fromWeek === band.toWeek + 1;
            }),
          { message: "Calendar bands must be contiguous and in week order." },
        ),
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
      superflexQbPerTeam: z
        .number()
        .min(1)
        .max(2)
        .default(d.manualReplacement.superflexQbPerTeam),
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
      contestedRivals: z.number().int().min(1).max(32).default(d.leagueDump.contestedRivals),
      contestedRivalShare: unitInterval.default(d.leagueDump.contestedRivalShare),
      contestedMinPointsPerWeek: nonNegative.default(d.leagueDump.contestedMinPointsPerWeek),
      superflexQbStarterOut: z.boolean().default(d.leagueDump.superflexQbStarterOut),
    })
    .default(d.leagueDump),

  auction: z
    .object({
      enabled: z.boolean().default(d.auction.enabled),
      runs: z.number().int().min(500).max(20000).default(d.auction.runs),
      participation: unitInterval.default(d.auction.participation),
      strayBidRate: unitInterval.default(d.auction.strayBidRate),
      bidSigma: z.number().min(0.1).max(1.5).default(d.auction.bidSigma),
      worthToBidRatio: unitInterval.default(d.auction.worthToBidRatio),
      scarcityPremiumPct: z
        .number()
        .min(0)
        .max(200)
        .default(d.auction.scarcityPremiumPct),
      heatShrink: nonNegative.default(d.auction.heatShrink),
      tendencyShrink: nonNegative.default(d.auction.tendencyShrink),
      heatClamp: clampPair.default(d.auction.heatClamp),
      tendencyClamp: clampPair.default(d.auction.tendencyClamp),
      minContestedWeek: z.number().int().min(1).max(18).default(d.auction.minContestedWeek),
      oddNudge: z.boolean().default(d.auction.oddNudge),
    })
    .default(d.auction),

  goal: z
    .object({
      defaultGoal: goalKey.default(d.goal.defaultGoal),
      valueTarget: unitInterval.default(d.goal.valueTarget),
      sureTarget: unitInterval.default(d.goal.sureTarget),
      sureMaxOverWorthPct: z.number().min(0).max(200).default(d.goal.sureMaxOverWorthPct),
      scarceShare: unitInterval.default(d.goal.scarceShare),
    })
    .default(d.goal)
    .refine((g) => g.valueTarget < g.sureTarget, {
      message: "The value target must be below the sure target.",
    }),

  priors: z
    .object({
      minCellSamples: z.number().int().min(1).default(d.priors.minCellSamples),
      staleAfterDays: z.number().int().min(1).max(60).default(d.priors.staleAfterDays),
      styleMultipliers: z
        .object({
          tight: z.number().min(0.1).max(3).default(d.priors.styleMultipliers.tight),
          typical: z.number().min(0.1).max(3).default(d.priors.styleMultipliers.typical),
          wild: z.number().min(0.1).max(3).default(d.priors.styleMultipliers.wild),
        })
        .default(d.priors.styleMultipliers),
    })
    .default(d.priors),

  playoffValue: z
    .object({
      enabled: z.boolean().default(d.playoffValue.enabled),
      playoffWeekWeight: z.number().min(0).max(3).default(d.playoffValue.playoffWeekWeight),
      titleOddsWeight: unitInterval.default(d.playoffValue.titleOddsWeight),
      bigTitleOddsPoints: z.number().min(0.1).max(100).default(d.playoffValue.bigTitleOddsPoints),
    })
    .default(d.playoffValue),

  dynastyValue: z
    .object({
      enabled: z.boolean().default(d.dynastyValue.enabled),
      blendByStatus: z
        .object({
          competitor: unitInterval.default(d.dynastyValue.blendByStatus.competitor),
          loaded: unitInterval.default(d.dynastyValue.blendByStatus.loaded),
          middle: unitInterval.default(d.dynastyValue.blendByStatus.middle),
          rebuilder: unitInterval.default(d.dynastyValue.blendByStatus.rebuilder),
        })
        .default(d.dynastyValue.blendByStatus),
      eliteRankFactor: z.number().min(0.01).max(2).default(d.dynastyValue.eliteRankFactor),
    })
    .default(d.dynastyValue),

  injury: z
    .object({
      carryOutFromSource: z.boolean().default(d.injury.carryOutFromSource),
      teammateSignal: signalToggle.default(d.injury.teammateSignal),
    })
    .default(d.injury),

  breakout: z
    .object({
      enabled: z.boolean().default(d.breakout.enabled),
      blendWeight: unitInterval.default(d.breakout.blendWeight),
    })
    .default(d.breakout),

  chopped: z
    .object({
      enabled: z.boolean().default(d.chopped.enabled),
      runs: z.number().int().min(500).max(20000).default(d.chopped.runs),
      strengthWeights: z
        .object({
          surviveThisWeek: unitInterval.default(d.chopped.strengthWeights.surviveThisWeek),
          winLeague: unitInterval.default(d.chopped.strengthWeights.winLeague),
          weeksAlive: unitInterval.default(d.chopped.strengthWeights.weeksAlive),
        })
        .default(d.chopped.strengthWeights)
        .refine(
          (w) => {
            const sum = w.surviveThisWeek + w.winLeague + w.weeksAlive;
            return sum >= 0.99 && sum <= 1.01;
          },
          { message: "The three chopped strength weights must sum to 1." },
        ),
      bigSurvivePoints: z.number().min(0.1).max(100).default(d.chopped.bigSurvivePoints),
      bigWinPoints: z.number().min(0.1).max(100).default(d.chopped.bigWinPoints),
      bigWeeksAlive: z.number().min(0.1).max(18).default(d.chopped.bigWeeksAlive),
      maxPctFromUpgrade: pct.default(d.chopped.maxPctFromUpgrade),
      priceByAliveFraction: z
        .array(
          z.object({
            minFraction: unitInterval,
            multiplier: z.number().min(0).max(3),
          }),
        )
        .min(1)
        .default(d.chopped.priceByAliveFraction)
        .refine(
          (rows) => rows.every((r, i) => i === 0 || rows[i - 1].minFraction > r.minFraction),
          { message: "Alive-fraction bands must run from the highest fraction down." },
        )
        .refine((rows) => rows[rows.length - 1]?.minFraction === 0, {
          message: "The last alive-fraction band must start at 0, so every league is covered.",
        }),
      dangerThreshold: unitInterval.default(d.chopped.dangerThreshold),
      dangerWeight: z.number().min(0).max(3).default(d.chopped.dangerWeight),
      substituteShare: unitInterval.default(d.chopped.substituteShare),
      substituteDiscount: z.number().min(0).max(3).default(d.chopped.substituteDiscount),
      paceTargets: z
        .array(
          z.object({
            throughWeek: z.number().int().min(1).max(18),
            holdPct: pct,
          }),
        )
        .min(1)
        .default(d.chopped.paceTargets)
        .refine(
          (rows) => rows.every((r, i) => i === 0 || rows[i - 1].throughWeek < r.throughWeek),
          { message: "Pace targets must run in week order." },
        ),
      manualDangerMultipliers: z
        .object({
          bottomTwo: z.number().min(0.1).max(3).default(d.chopped.manualDangerMultipliers.bottomTwo),
          nearCut: z.number().min(0.1).max(3).default(d.chopped.manualDangerMultipliers.nearCut),
          midPack: z.number().min(0.1).max(3).default(d.chopped.manualDangerMultipliers.midPack),
          safe: z.number().min(0.1).max(3).default(d.chopped.manualDangerMultipliers.safe),
        })
        .default(d.chopped.manualDangerMultipliers),
    })
    .default(d.chopped),
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
/**
 * Same row for every caller, admin-edited only: safe to memoise across
 * requests for a minute. See lib/memo-ttl.ts.
 */
export async function loadFaabSettings(supabase: Client): Promise<FaabSettings> {
  return memoTtl("settings:faab", 60_000, async () => {
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
  });
}
