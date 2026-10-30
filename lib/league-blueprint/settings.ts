/**
 * Load, validate, and persist Team Blueprint settings.
 *
 * One jsonb row (id = 'global') in league_blueprint_settings, service-role
 * only, read and written with the admin client. Same shape as
 * would_you_rather_settings (lib/would-you-rather/settings.ts).
 *
 * Every field carries a default, so a row written before a field existed is
 * filled in rather than rejected; a wrong TYPE still fails. The cross-field
 * rules of plan section 13.1 (activity weights summing to 1, lowBelow under
 * highAbove) live in validateLeagueBlueprintSettings, the admin save path's
 * only gate. Saving rebuilds nothing; `version` is the rebuild switch.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import {
  DEFAULT_LEAGUE_BLUEPRINT_SETTINGS,
  type LeagueBlueprintSettings,
} from "./default-settings";

type Client = SupabaseClient<Database>;

export const LEAGUE_BLUEPRINT_SETTINGS_ID = "global";
export const BLUEPRINT_SETTINGS_MEMO_KEY = "settings:league_blueprint";

const d = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS;

const weight = z.number().min(0).max(1);
const positiveWeight = z.number().positive().max(10);
const ageCutoff = z.number().min(20).max(45);
const grade = z.number().int().min(1).max(10);

export const leagueBlueprintSettingsSchema = z.object({
  version: z.number().int().min(1).max(100_000).default(d.version),
  cache: z
    .object({ ttlHours: z.number().min(1).max(168).default(d.cache.ttlHours) })
    .default(d.cache),
  grades: z
    .object({
      valueWeight: weight.default(d.grades.valueWeight),
      pointsWeight: weight.default(d.grades.pointsWeight),
      overall: z
        .object({
          qb: positiveWeight.default(d.grades.overall.qb),
          qbSuperflex: positiveWeight.default(d.grades.overall.qbSuperflex),
          rb: positiveWeight.default(d.grades.overall.rb),
          wr: positiveWeight.default(d.grades.overall.wr),
          te: positiveWeight.default(d.grades.overall.te),
          bench: positiveWeight.default(d.grades.overall.bench),
          picks: positiveWeight.default(d.grades.overall.picks),
        })
        .default(d.grades.overall),
    })
    .default(d.grades),
  archetype: z
    .object({
      topHeavyShare: weight.default(d.archetype.topHeavyShare),
      deepShare: weight.default(d.archetype.deepShare),
      reloadAgeGap: z.number().min(-10).max(10).default(d.archetype.reloadAgeGap),
      reloadPicksGrade: grade.default(d.archetype.reloadPicksGrade),
      contendHoldAgeGap: z.number().min(-10).max(10).default(d.archetype.contendHoldAgeGap),
      rebuildYoungShare: weight.default(d.archetype.rebuildYoungShare),
      rebuildPicksGrade: grade.default(d.archetype.rebuildPicksGrade),
      youngAge: z.number().min(20).max(35).default(d.archetype.youngAge),
    })
    .default(d.archetype),
  calls: z
    .object({
      ageCutoff: z
        .object({
          QB: ageCutoff.default(d.calls.ageCutoff.QB),
          RB: ageCutoff.default(d.calls.ageCutoff.RB),
          WR: ageCutoff.default(d.calls.ageCutoff.WR),
          TE: ageCutoff.default(d.calls.ageCutoff.TE),
        })
        .default(d.calls.ageCutoff),
      needMinPoints: z.number().min(0).max(50).default(d.calls.needMinPoints),
      targetValueLow: z.number().min(0).max(5).default(d.calls.targetValueLow),
      targetValueHigh: z.number().min(0).max(5).default(d.calls.targetValueHigh),
      targetsPerPosition: z.number().int().min(1).max(5).default(d.calls.targetsPerPosition),
      maxNeedPositions: z.number().int().min(1).max(4).default(d.calls.maxNeedPositions),
    })
    .default(d.calls),
  activity: z
    .object({
      sellWeight: weight.default(d.activity.sellWeight),
      needWeight: weight.default(d.activity.needWeight),
      divergenceWeight: weight.default(d.activity.divergenceWeight),
      lowBelow: z.number().int().min(0).max(100).default(d.activity.lowBelow),
      highAbove: z.number().int().min(0).max(100).default(d.activity.highAbove),
    })
    .default(d.activity),
  movers: z
    .object({
      window: z.enum(["7d", "30d"]).default(d.movers.window),
      limit: z.number().int().min(1).max(10).default(d.movers.limit),
      minGated: z.number().int().min(0).max(30).default(d.movers.minGated),
    })
    .default(d.movers),
  strategy: z
    .object({
      maxRuns: z.number().int().min(1).max(3).default(d.strategy.maxRuns),
      pivotGapPct: weight.default(d.strategy.pivotGapPct),
    })
    .default(d.strategy),
  partners: z
    .object({
      needWeight: weight.default(d.partners.needWeight),
      giveWeight: weight.default(d.partners.giveWeight),
      directionWeight: weight.default(d.partners.directionWeight),
      tendencyWeight: weight.default(d.partners.tendencyWeight),
      count: z.number().int().min(1).max(5).default(d.partners.count),
    })
    .default(d.partners),
  priorities: z
    .object({ count: z.number().int().min(1).max(5).default(d.priorities.count) })
    .default(d.priorities),
});

export type ValidateResult =
  | { ok: true; settings: LeagueBlueprintSettings }
  | { ok: false; error: string };

/** The cross-field rules the schema cannot express. Null when they hold. */
function crossFieldError(s: LeagueBlueprintSettings): string | null {
  const sum = s.activity.sellWeight + s.activity.needWeight + s.activity.divergenceWeight;
  if (Math.abs(sum - 1) > 0.001) {
    return `activity: the three weights must sum to 1 (they sum to ${sum.toFixed(3)}).`;
  }
  if (s.activity.lowBelow >= s.activity.highAbove) {
    return "activity.lowBelow: must be below highAbove.";
  }
  if (s.calls.targetValueLow >= s.calls.targetValueHigh) {
    return "calls.targetValueLow: must be below targetValueHigh.";
  }
  if (s.archetype.deepShare >= s.archetype.topHeavyShare) {
    return "archetype.deepShare: must be below topHeavyShare.";
  }
  return null;
}

/** Validate an untrusted settings object. The admin save path's only gate. */
export function validateLeagueBlueprintSettings(raw: unknown): ValidateResult {
  const parsed = leagueBlueprintSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  const settings = parsed.data as LeagueBlueprintSettings;
  const cross = crossFieldError(settings);
  if (cross) return { ok: false, error: cross };
  return { ok: true, settings };
}

/**
 * Fill a partial or older stored document out to a complete one. Falls back to
 * the code defaults when the row cannot be parsed or breaks a cross-field
 * rule, so the page keeps running on a corrupt row rather than failing on it.
 */
export function mergeLeagueBlueprintSettings(raw: unknown): LeagueBlueprintSettings {
  const result = validateLeagueBlueprintSettings(raw);
  return result.ok ? result.settings : DEFAULT_LEAGUE_BLUEPRINT_SETTINGS;
}

/** One admin-edited row for every caller: memoized for a minute. */
export async function loadLeagueBlueprintSettings(
  supabase: Client,
): Promise<LeagueBlueprintSettings> {
  return memoTtl(BLUEPRINT_SETTINGS_MEMO_KEY, 60_000, async () => {
    try {
      const { data, error } = await supabase
        .from("league_blueprint_settings")
        .select("settings")
        .eq("id", LEAGUE_BLUEPRINT_SETTINGS_ID)
        .maybeSingle();
      if (error || !data?.settings) return DEFAULT_LEAGUE_BLUEPRINT_SETTINGS;
      return mergeLeagueBlueprintSettings(data.settings);
    } catch {
      return DEFAULT_LEAGUE_BLUEPRINT_SETTINGS;
    }
  });
}

/** Persist a full settings document. Admin server actions only. */
export async function saveLeagueBlueprintSettings(
  supabase: Client,
  settings: LeagueBlueprintSettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("league_blueprint_settings").upsert(
    {
      id: LEAGUE_BLUEPRINT_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS };
export type { LeagueBlueprintSettings };
