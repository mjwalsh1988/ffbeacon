/**
 * Server-side validation for the Manager Pulse model config.
 *
 * The admin form posts a whole settings document, and a bad value here would
 * corrupt every report and every tendency row rather than throwing a visible
 * error, so nothing from the client is trusted. Every field is bounded to the
 * range in MANAGER_PULSE_SETTING_BOUNDS, the same object the admin form reads
 * for its input min/max attributes, so the two cannot drift apart.
 */

import { z } from "zod";
import {
  DEFAULT_MANAGER_PULSE_SETTINGS,
  MANAGER_PULSE_SETTING_BOUNDS,
  type ManagerPulseSettings,
} from "./default-settings";

const B = MANAGER_PULSE_SETTING_BOUNDS;

const bounded = (bounds: { min: number; max: number }) => z.number().min(bounds.min).max(bounds.max);

export const managerPulseSettingsSchema = z
  .object({
    capture: z.object({
      seasonWindowDefault: bounded(B.capture.seasonWindowDefault),
      seasonWindowMax: bounded(B.capture.seasonWindowMax),
      seasonWindowMin: bounded(B.capture.seasonWindowMin),
      maxLeaguesPerRun: bounded(B.capture.maxLeaguesPerRun),
      maxLeaguesPerSeason: bounded(B.capture.maxLeaguesPerSeason),
      runCooldownSeconds: bounded(B.capture.runCooldownSeconds),
      reportTtlHours: bounded(B.capture.reportTtlHours),
      tendencyTtlHours: bounded(B.capture.tendencyTtlHours),
      captureTtlMinutes: bounded(B.capture.captureTtlMinutes),
      jobMaxAttempts: bounded(B.capture.jobMaxAttempts),
      includeBestBall: z.boolean(),
      adminBypassThrottle: z.boolean(),
    }),

    lookup: z.object({
      handleLookupPerMinute: bounded(B.lookup.handleLookupPerMinute),
      handleLookupPerDay: bounded(B.lookup.handleLookupPerDay),
    }),

    samples: z.object({
      minTradesForMargin: bounded(B.samples.minTradesForMargin),
      minTradesForPositionLean: bounded(B.samples.minTradesForPositionLean),
      minTradesForAgeLean: bounded(B.samples.minTradesForAgeLean),
      minOverpaySample: bounded(B.samples.minOverpaySample),
      minDraftsForReach: bounded(B.samples.minDraftsForReach),
      minAvoidSeasons: bounded(B.samples.minAvoidSeasons),
      minAvoidRosterRate: bounded(B.samples.minAvoidRosterRate),
      minSeasonsForTendency: bounded(B.samples.minSeasonsForTendency),
      minLeagueSeasonsForRate: bounded(B.samples.minLeagueSeasonsForRate),
    }),

    draft: z.object({
      reachRoundsThreshold: bounded(B.draft.reachRoundsThreshold),
      earlyRoundCutoff: bounded(B.draft.earlyRoundCutoff),
    }),

    display: z.object({
      favouritesShown: bounded(B.display.favouritesShown),
      avoidsShown: bounded(B.display.avoidsShown),
      tradesShown: bounded(B.display.tradesShown),
      leagueRowsShown: bounded(B.display.leagueRowsShown),
      narrativeSentencesMax: bounded(B.display.narrativeSentencesMax),
    }),

    tendency: z.object({
      bandStepMax: bounded(B.tendency.bandStepMax),
      confidenceLowMax: bounded(B.tendency.confidenceLowMax),
      confidenceMediumMax: bounded(B.tendency.confidenceMediumMax),
      enabledForTradeIdeas: z.boolean(),
    }),

    behaviour: z.object({
      moveShapeMinMoves: bounded(B.behaviour.moveShapeMinMoves),
      moveShapeFrontLoaded: bounded(B.behaviour.moveShapeFrontLoaded),
      moveShapeFaded: bounded(B.behaviour.moveShapeFaded),
      abandonmentQuietWeeks: bounded(B.behaviour.abandonmentQuietWeeks),
    }),

    wording: z.object({
      tradesOftenPerSeason: bounded(B.wording.tradesOftenPerSeason),
      tradesRarePerSeason: bounded(B.wording.tradesRarePerSeason),
      marginDeadzone: bounded(B.wording.marginDeadzone),
      ageLeanDeadzone: bounded(B.wording.ageLeanDeadzone),
      lineupGood: bounded(B.wording.lineupGood),
      lineupPoor: bounded(B.wording.lineupPoor),
      draftEarlyRounds: bounded(B.wording.draftEarlyRounds),
      unluckyPointsAgainstMax: bounded(B.wording.unluckyPointsAgainstMax),
      unluckyPointsForMin: bounded(B.wording.unluckyPointsForMin),
      unluckyPointsForMax: bounded(B.wording.unluckyPointsForMax),
    }),

    // Matches the id shape a modelVersion bump is written in ("mp-1", "mp-2.1"):
    // lowercase alphanumerics, dot, underscore and hyphen, starting with an
    // alphanumeric, 1 to 32 characters.
    modelVersion: z
      .string()
      .min(B.modelVersion.minLength)
      .max(B.modelVersion.maxLength)
      .regex(
        /^[a-z0-9][a-z0-9._-]{0,31}$/,
        "Model version must be lowercase alphanumeric, dot, underscore, or hyphen, starting with a letter or digit.",
      ),
  })
  // Cross-field checks the per-field bounds cannot express.
  .refine((s) => s.capture.seasonWindowMin <= s.capture.seasonWindowDefault, {
    message: "The default season window cannot be smaller than the minimum window.",
    path: ["capture", "seasonWindowDefault"],
  })
  .refine((s) => s.capture.seasonWindowDefault <= s.capture.seasonWindowMax, {
    message: "The default season window cannot be larger than the maximum window.",
    path: ["capture", "seasonWindowDefault"],
  })
  .refine((s) => s.capture.seasonWindowMin <= s.capture.seasonWindowMax, {
    message: "The minimum season window cannot be larger than the maximum window.",
    path: ["capture", "seasonWindowMin"],
  })
  .refine((s) => s.tendency.confidenceLowMax < s.tendency.confidenceMediumMax, {
    message: "The low-confidence sample ceiling must be smaller than the medium-confidence ceiling.",
    path: ["tendency", "confidenceLowMax"],
  })
  // Without this the two bands overlap and a season could be called both
  // front-loaded and faded, so whichever branch the code tests first silently
  // wins. The bounds alone cannot catch it: each number is legal on its own.
  .refine((s) => s.behaviour.moveShapeFaded < s.behaviour.moveShapeFrontLoaded, {
    message:
      "The faded threshold must be smaller than the front-loaded threshold, or the two bands overlap.",
    path: ["behaviour", "moveShapeFaded"],
  })
  // Same overlap trap as the move-shape bands: each number is legal alone, and
  // crossed they would let one manager be called both good and poor at setting
  // a lineup, with whichever template fires first silently winning.
  .refine((s) => s.wording.lineupPoor < s.wording.lineupGood, {
    message:
      "The poor-lineup threshold must be smaller than the good-lineup threshold, or the two overlap.",
    path: ["wording", "lineupPoor"],
  })
  .refine((s) => s.wording.unluckyPointsForMin < s.wording.unluckyPointsForMax, {
    message: "The middle-of-the-table band's minimum must be smaller than its maximum.",
    path: ["wording", "unluckyPointsForMin"],
  })
  .refine((s) => s.wording.tradesRarePerSeason < s.wording.tradesOftenPerSeason, {
    message:
      "The rarely-trades threshold must be smaller than the trades-a-lot threshold, or a manager could be both.",
    path: ["wording", "tradesRarePerSeason"],
  });

export type ValidationResult =
  | { ok: true; settings: ManagerPulseSettings }
  | { ok: false; error: string };

export function validateManagerPulseSettings(raw: unknown): ValidationResult {
  const parsed = managerPulseSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, error: `${where}${first?.message ?? "Invalid settings."}` };
  }
  return { ok: true, settings: parsed.data as ManagerPulseSettings };
}

export { DEFAULT_MANAGER_PULSE_SETTINGS };
