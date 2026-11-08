/**
 * Load, validate, clamp and persist Long Shot settings.
 *
 * One jsonb row (id = 'global') in long_shot_settings, service-role only, the
 * same shape as would_you_rather_settings. Every field carries a default, so
 * a row written before a field existed is filled in rather than rejected;
 * unknown keys are stripped. A wrong TYPE still fails validation, because
 * that is a mistake rather than an older version.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { bustMemo, memoTtl } from "@/lib/memo-ttl";
import { DEFAULT_LONG_SHOT_SETTINGS, LONG_SHOT_SETTING_BOUNDS } from "./default-settings";
import { TEMPLATE_KEYS, TIERS, type LongShotSettings, type TemplateKey } from "./types";

type Client = SupabaseClient<Database>;

export const LONG_SHOT_SETTINGS_ID = "global";
const MEMO_KEY = "settings:long_shot";

const d = DEFAULT_LONG_SHOT_SETTINGS;
const b = LONG_SHOT_SETTING_BOUNDS;

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const share = () => z.number().gt(0).lt(1);

function templateSchema(key: TemplateKey) {
  const t = d.templates[key];
  return z
    .object({
      enabled: z.boolean().default(t.enabled),
      min_answers: int(b.min_answers.min, b.min_answers.max).default(t.min_answers),
      max_answers: int(b.max_answers.min, b.max_answers.max).default(t.max_answers),
    })
    .default(t);
}

const templatesShape = Object.fromEntries(
  TEMPLATE_KEYS.map((key) => [key, templateSchema(key)]),
) as Record<TemplateKey, ReturnType<typeof templateSchema>>;

const pointsInt = () => int(b.tier_points.min, b.tier_points.max);

export const longShotSettingsSchema = z.object({
  game_enabled: z.boolean().default(d.game_enabled),
  timer: z
    .object({
      seconds: int(b.timer_seconds.min, b.timer_seconds.max).default(d.timer.seconds),
      grace_seconds: int(b.grace_seconds.min, b.grace_seconds.max).default(d.timer.grace_seconds),
    })
    .default(d.timer),
  tiers: z
    .object({
      cutoffs: z
        .object({
          long_shot: share().default(d.tiers.cutoffs.long_shot),
          sleeper: share().default(d.tiers.cutoffs.sleeper),
          deep: share().default(d.tiers.cutoffs.deep),
          field: share().default(d.tiers.cutoffs.field),
        })
        .default(d.tiers.cutoffs),
      points: z
        .object({
          chalk: pointsInt().default(d.tiers.points.chalk),
          field: pointsInt().default(d.tiers.points.field),
          deep: pointsInt().default(d.tiers.points.deep),
          sleeper: pointsInt().default(d.tiers.points.sleeper),
          long_shot: pointsInt().default(d.tiers.points.long_shot),
        })
        .default(d.tiers.points),
      min_rate_leagues: int(b.min_rate_leagues.min, b.min_rate_leagues.max).default(
        d.tiers.min_rate_leagues,
      ),
    })
    .default(d.tiers),
  bonus: z
    .object({
      min_room: int(b.min_room.min, b.min_room.max).default(d.bonus.min_room),
      lone_share: share().default(d.bonus.lone_share),
      points: int(b.bonus_points.min, b.bonus_points.max).default(d.bonus.points),
    })
    .default(d.bonus),
  templates: z.object(templatesShape).default(d.templates),
  leaderboards: z
    .object({
      enabled: z.boolean().default(d.leaderboards.enabled),
      hide_admin_users: z.boolean().default(d.leaderboards.hide_admin_users),
    })
    .default(d.leaderboards),
  film_room_enabled: z.boolean().default(d.film_room_enabled),
});

export type ValidateResult =
  | { ok: true; settings: LongShotSettings }
  | { ok: false; error: string };

/** Cross-field rules the schema cannot express. Returns the first broken one. */
function crossFieldError(s: LongShotSettings): string | null {
  const c = s.tiers.cutoffs;
  if (!(c.long_shot < c.sleeper && c.sleeper < c.deep && c.deep < c.field)) {
    return "tiers.cutoffs: must be strictly increasing (long_shot < sleeper < deep < field).";
  }
  for (let i = 1; i < TIERS.length; i++) {
    if (s.tiers.points[TIERS[i]] <= s.tiers.points[TIERS[i - 1]]) {
      return "tiers.points: must be strictly increasing from chalk to long_shot.";
    }
  }
  for (const key of TEMPLATE_KEYS) {
    const t = s.templates[key];
    if (t.max_answers < t.min_answers) {
      return `templates.${key}.max_answers: must be at least min_answers.`;
    }
  }
  return null;
}

/** Validate an untrusted settings object. The admin save path's only gate. */
export function validateLongShotSettings(raw: unknown): ValidateResult {
  const parsed = longShotSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  const settings = parsed.data as LongShotSettings;
  const cross = crossFieldError(settings);
  if (cross) return { ok: false, error: cross };
  return { ok: true, settings };
}

const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Pull every number back inside its range. Used on read so a row edited by
 * hand in the database cannot run the game outside the bounds the admin
 * form enforces. A document that still breaks a cross-field rule after
 * clamping falls back to the defaults for that group.
 */
export function clampLongShotSettings(s: LongShotSettings): LongShotSettings {
  const out: LongShotSettings = structuredClone(s);
  out.timer.seconds = clampNum(out.timer.seconds, b.timer_seconds.min, b.timer_seconds.max);
  out.timer.grace_seconds = clampNum(out.timer.grace_seconds, b.grace_seconds.min, b.grace_seconds.max);
  for (const tier of TIERS) {
    out.tiers.points[tier] = clampNum(out.tiers.points[tier], b.tier_points.min, b.tier_points.max);
  }
  out.tiers.min_rate_leagues = clampNum(
    out.tiers.min_rate_leagues,
    b.min_rate_leagues.min,
    b.min_rate_leagues.max,
  );
  out.bonus.min_room = clampNum(out.bonus.min_room, b.min_room.min, b.min_room.max);
  out.bonus.points = clampNum(out.bonus.points, b.bonus_points.min, b.bonus_points.max);
  for (const key of TEMPLATE_KEYS) {
    const t = out.templates[key];
    t.min_answers = clampNum(t.min_answers, b.min_answers.min, b.min_answers.max);
    t.max_answers = clampNum(Math.max(t.max_answers, t.min_answers), b.max_answers.min, b.max_answers.max);
  }
  const c = out.tiers.cutoffs;
  if (!(c.long_shot < c.sleeper && c.sleeper < c.deep && c.deep < c.field)) {
    out.tiers.cutoffs = { ...d.tiers.cutoffs };
  }
  for (let i = 1; i < TIERS.length; i++) {
    if (out.tiers.points[TIERS[i]] <= out.tiers.points[TIERS[i - 1]]) {
      out.tiers.points = { ...d.tiers.points };
      break;
    }
  }
  return out;
}

/** Fill a partial or older stored document out to a complete, clamped one. */
export function mergeLongShotSettings(raw: unknown): LongShotSettings {
  const parsed = longShotSettingsSchema.safeParse(raw ?? {});
  return parsed.success
    ? clampLongShotSettings(parsed.data as LongShotSettings)
    : DEFAULT_LONG_SHOT_SETTINGS;
}

/** Same row for every caller and admin-edited only, so memoised for a minute. */
export async function loadLongShotSettings(supabase: Client): Promise<LongShotSettings> {
  return memoTtl(MEMO_KEY, 60_000, async () => {
    try {
      const { data, error } = await supabase
        .from("long_shot_settings")
        .select("settings")
        .eq("id", LONG_SHOT_SETTINGS_ID)
        .maybeSingle();
      if (error || !data?.settings) return DEFAULT_LONG_SHOT_SETTINGS;
      return mergeLongShotSettings(data.settings);
    } catch {
      return DEFAULT_LONG_SHOT_SETTINGS;
    }
  });
}

/** Persist a full, already validated settings document. Admin actions only. */
export async function saveLongShotSettings(
  supabase: Client,
  settings: LongShotSettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("long_shot_settings").upsert(
    {
      id: LONG_SHOT_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  bustMemo(MEMO_KEY);
  return { ok: true };
}

export { DEFAULT_LONG_SHOT_SETTINGS };
