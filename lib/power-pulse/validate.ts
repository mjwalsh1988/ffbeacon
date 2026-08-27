/**
 * Server-side validation for the Power Pulse model config.
 *
 * The admin form posts a whole settings document, and a bad value here corrupts
 * every league's score rather than throwing a visible error, so nothing is
 * trusted. Every field is bounded to a range where the model still behaves:
 * weights on 0 to 1, multiplier caps that cannot invert, a simulation count that
 * cannot lock a request up.
 */

import { z } from "zod";
import { DEFAULT_POWER_PULSE_SETTINGS, type PowerPulseSettings } from "./default-settings";
import { WAR_SETTING_BOUNDS } from "../positional-war/default-settings";

const unit = z.number().min(0).max(1);
const multiplier = z.number().min(0.1).max(3);

const positionCv = z.object({
  QB: z.number().min(0.05).max(2),
  RB: z.number().min(0.05).max(2),
  WR: z.number().min(0.05).max(2),
  TE: z.number().min(0.05).max(2),
  K: z.number().min(0.05).max(2),
  DEF: z.number().min(0.05).max(2),
});

export const powerPulseSettingsSchema = z
  .object({
    modelVersion: z.string().min(1).max(32),

    weights: z.object({
      points: unit,
      schedule: unit,
      depth: unit,
      form: unit,
    }),

    recency: z.object({
      currentSeason: z.number().min(0).max(1),
      oneSeasonBack: z.number().min(0).max(1),
      twoSeasonsBack: z.number().min(0).max(1),
      olderSeasons: z.number().min(0).max(1),
      currentSeasonHalfLifeWeeks: z.number().min(1).max(52),
    }),

    reliability: z.object({
      enabled: z.boolean(),
      priorGames: z.number().min(0).max(200),
      minMultiplier: multiplier,
      maxMultiplier: multiplier,
    }),

    availability: z.object({
      enabled: z.boolean(),
      damping: unit,
      minMultiplier: multiplier,
    }),

    injury: z.object({
      enabled: z.boolean(),
      multipliers: z.record(z.string(), z.number().min(0).max(1)),
    }),

    opponent: z.object({
      enabled: z.boolean(),
      minMultiplier: multiplier,
      maxMultiplier: multiplier,
      currentSeasonWeight: unit,
      priorSeasonWeight: unit,
      minGamesSampled: z.number().min(0).max(34),
    }),

    variance: z.object({
      defaultCv: positionCv,
      minGamesForMeasured: z.number().min(0).max(100),
      minCv: z.number().min(0.01).max(2),
      maxCv: z.number().min(0.01).max(3),
    }),

    simulation: z.object({
      // Upper bound keeps a league page render bounded: this runs inline on a
      // deep-view load, not in a background job.
      runs: z.number().min(200).max(20000),
      seed: z.number().int(),
    }),

    display: z.object({
      min: z.number().min(0).max(50),
      max: z.number().min(51).max(100),
      sharpness: z.number().min(0.2).max(3),
    }),

    // Positional WAR (section 15.7). Bounds chosen so the model still behaves
    // at either end: below 1.0 displayDepthMultiple would cut the curve
    // before the replacement line, and above 6 a WR series runs past 250
    // points for no gain. cliffThreshold outside (0, 1) makes cliff_rank
    // meaningless, since it is a fraction of the rank-1 Positional WAR
    // figure.
    war: z.object({
      modelVersion: z
        .string()
        .min(WAR_SETTING_BOUNDS.modelVersion.minLength)
        .max(WAR_SETTING_BOUNDS.modelVersion.maxLength),
      displayDepthMultiple: z
        .number()
        .min(WAR_SETTING_BOUNDS.displayDepthMultiple.min)
        .max(WAR_SETTING_BOUNDS.displayDepthMultiple.max),
      minDisplayDepth: z
        .number()
        .int()
        .min(WAR_SETTING_BOUNDS.minDisplayDepth.min)
        .max(WAR_SETTING_BOUNDS.minDisplayDepth.max),
      cliffThreshold: z
        .number()
        .min(WAR_SETTING_BOUNDS.cliffThreshold.min)
        .max(WAR_SETTING_BOUNDS.cliffThreshold.max),
      clampBelowReplacement: z.boolean(),
    }),
  })
  // Cross-field checks the per-field bounds cannot express.
  .refine((s) => s.weights.points + s.weights.schedule + s.weights.depth + s.weights.form > 0, {
    message: "At least one component weight must be above zero.",
    path: ["weights"],
  })
  .refine((s) => s.reliability.minMultiplier <= s.reliability.maxMultiplier, {
    message: "Reliability minimum must not exceed the maximum.",
    path: ["reliability", "minMultiplier"],
  })
  .refine((s) => s.opponent.minMultiplier <= s.opponent.maxMultiplier, {
    message: "Opponent minimum must not exceed the maximum.",
    path: ["opponent", "minMultiplier"],
  })
  .refine((s) => s.variance.minCv <= s.variance.maxCv, {
    message: "Variance minimum must not exceed the maximum.",
    path: ["variance", "minCv"],
  })
  .refine((s) => s.display.min < s.display.max, {
    message: "Display minimum must be below the maximum.",
    path: ["display", "min"],
  });

export type ValidationResult =
  | { ok: true; settings: PowerPulseSettings }
  | { ok: false; error: string };

export function validatePowerPulseSettings(raw: unknown): ValidationResult {
  const parsed = powerPulseSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, error: `${where}${first?.message ?? "Invalid settings."}` };
  }
  return { ok: true, settings: parsed.data as PowerPulseSettings };
}

export { DEFAULT_POWER_PULSE_SETTINGS };
