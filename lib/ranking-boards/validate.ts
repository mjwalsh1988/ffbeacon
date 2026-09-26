/**
 * Validation for the Beacon Ranker settings document.
 *
 * Every field carries a default, so a row written before a field existed is
 * filled in rather than rejected. A wrong TYPE or an out-of-bounds number still
 * fails, because that is a mistake rather than an older version. Client-safe:
 * the admin form and the server action share it.
 */

import { z } from "zod";
import {
  DEFAULT_RANKING_BUILDER_SETTINGS as d,
  RANKING_BUILDER_SETTING_BOUNDS as b,
  type RankingBuilderSettings,
} from "./default-settings";

const int = (bound: { min: number; max: number }, fallback: number) =>
  z.number().int().min(bound.min).max(bound.max).default(fallback);
const num = (bound: { min: number; max: number }, fallback: number) =>
  z.number().finite().min(bound.min).max(bound.max).default(fallback);

export const rankingBuilderSettingsSchema = z.object({
  builder: z
    .object({
      winsBeforePrompt: int(b.builder.winsBeforePrompt, d.builder.winsBeforePrompt),
      defaultDepthMulti: int(b.builder.defaultDepthMulti, d.builder.defaultDepthMulti),
      defaultDepthSingle: int(b.builder.defaultDepthSingle, d.builder.defaultDepthSingle),
      keepGoingStep: int(b.builder.keepGoingStep, d.builder.keepGoingStep),
      maxDepth: int(b.builder.maxDepth, d.builder.maxDepth),
      defenderSecondPass: int(b.builder.defenderSecondPass, d.builder.defenderSecondPass),
      checkpointEvery: int(b.builder.checkpointEvery, d.builder.checkpointEvery),
    })
    .default(d.builder),
  guests: z
    .object({
      capMulti: int(b.guests.capMulti, d.guests.capMulti),
      capSingle: int(b.guests.capSingle, d.guests.capSingle),
      retentionHours: int(b.guests.retentionHours, d.guests.retentionHours),
    })
    .default(d.guests),
  limits: z
    .object({
      seedLoadsPerHour: int(b.limits.seedLoadsPerHour, d.limits.seedLoadsPerHour),
      answersPerMinute: int(b.limits.answersPerMinute, d.limits.answersPerMinute),
    })
    .default(d.limits),
  community: z
    .object({
      minPlayersMulti: int(b.community.minPlayersMulti, d.community.minPlayersMulti),
      minPlayersSingle: int(b.community.minPlayersSingle, d.community.minPlayersSingle),
      minBoardsPerPlayer: int(b.community.minBoardsPerPlayer, d.community.minBoardsPerPlayer),
      minBoardsToPublish: int(b.community.minBoardsToPublish, d.community.minBoardsToPublish),
      poolMargin: num(b.community.poolMargin, d.community.poolMargin),
      withinBoardShare: num(b.community.withinBoardShare, d.community.withinBoardShare),
      shrinkage: num(b.community.shrinkage, d.community.shrinkage),
      agreementWindow: int(b.community.agreementWindow, d.community.agreementWindow),
      sourceEnabled: z.boolean().default(d.community.sourceEnabled),
    })
    .default(d.community),
});

export type ValidateResult =
  | { ok: true; settings: RankingBuilderSettings }
  | { ok: false; error: string };

/** Validate an untrusted settings object. The admin save path's only gate. */
export function validateRankingBuilderSettings(raw: unknown): ValidateResult {
  const parsed = rankingBuilderSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") ?? "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  const settings = parsed.data as RankingBuilderSettings;
  if (settings.builder.defaultDepthMulti > settings.builder.maxDepth) {
    return { ok: false, error: "builder.defaultDepthMulti: must not exceed the maximum depth." };
  }
  if (settings.builder.defaultDepthSingle > settings.builder.maxDepth) {
    return { ok: false, error: "builder.defaultDepthSingle: must not exceed the maximum depth." };
  }
  if (settings.guests.capSingle > settings.guests.capMulti) {
    return {
      ok: false,
      error: "guests.capSingle: a one-position cap above the multi-position cap makes no sense.",
    };
  }
  // The source switch is shown disabled until the source half is built (plan
  // section 9.4). Refuse it here too, so a hand-made request cannot flip it.
  if (settings.community.sourceEnabled) {
    return {
      ok: false,
      error: "community.sourceEnabled: the community source is not built yet and cannot be turned on.",
    };
  }
  return { ok: true, settings };
}

/** Fill a partial or older stored document out to a complete one. Falls back to
 * the code defaults when the row cannot be parsed at all. */
export function mergeRankingBuilderSettings(raw: unknown): RankingBuilderSettings {
  const parsed = rankingBuilderSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? (parsed.data as RankingBuilderSettings) : d;
}
