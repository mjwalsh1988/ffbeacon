/**
 * Load, validate, and persist Would You Rather settings.
 *
 * One jsonb row (id = 'global') in would_you_rather_settings, which is
 * service-role only, so the admin action writes it with the service client and
 * the game reads it with the service client. Same shape as
 * league_power_pulse_settings and signal_scout_settings.
 *
 * Every field carries a default, so a row written before a field existed is
 * filled in rather than rejected. A wrong TYPE still fails, because that is a
 * mistake rather than an older version.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  DEFAULT_WOULD_YOU_RATHER_SETTINGS,
  WYR_SETTING_BOUNDS,
  type WouldYouRatherSettings,
} from "./default-settings";
import { hasAnyWebhook } from "./routing";

type Client = SupabaseClient<Database>;

export const WOULD_YOU_RATHER_SETTINGS_ID = "global";

const d = DEFAULT_WOULD_YOU_RATHER_SETTINGS;
const b = WYR_SETTING_BOUNDS;

/**
 * Post hours, cleaned rather than merely checked: duplicates collapse and the
 * list sorts, so "8, 20, 8" and "8, 20" are the same schedule and the admin
 * panel always reads back in the order the day runs.
 */
const postHours = z
  .array(z.number().int().min(0).max(23))
  .max(b.post_hours_max_count)
  .transform((hours) => Array.from(new Set(hours)).sort((x, y) => x - y));

/**
 * A webhook id, or nothing.
 *
 * An empty string from a cleared <select> means the same thing as "no webhook
 * chosen", so it is coerced rather than rejected. Shared by the fallback
 * webhook and by each per-league-type route.
 */
const webhookId = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .transform((v) => (v ? v : null));

export const wouldYouRatherSettingsSchema = z.object({
  game_enabled: z.boolean().default(d.game_enabled),
  guest_play_enabled: z.boolean().default(d.guest_play_enabled),
  guest_vote_limit: z
    .number()
    .int()
    .min(b.guest_vote_limit.min)
    .max(b.guest_vote_limit.max)
    .default(d.guest_vote_limit),

  pool: z
    .object({
      min_assets_per_side: z
        .number()
        .int()
        .min(b.min_assets_per_side.min)
        .max(b.min_assets_per_side.max)
        .default(d.pool.min_assets_per_side),
      include_startup_trades: z.boolean().default(d.pool.include_startup_trades),
      require_player_asset: z.boolean().default(d.pool.require_player_asset),
      prefer_leagues_with_war: z.boolean().default(d.pool.prefer_leagues_with_war),
      candidate_batch_size: z
        .number()
        .int()
        .min(b.candidate_batch_size.min)
        .max(b.candidate_batch_size.max)
        .default(d.pool.candidate_batch_size),
    })
    .default(d.pool),

  reveal: z
    .object({
      show_community_results: z.boolean().default(d.reveal.show_community_results),
      show_signal_check: z.boolean().default(d.reveal.show_signal_check),
      show_team_context: z.boolean().default(d.reveal.show_team_context),
      show_positional_war: z.boolean().default(d.reveal.show_positional_war),
      show_value_trends: z.boolean().default(d.reveal.show_value_trends),
    })
    .default(d.reveal),

  discord: z
    .object({
      enabled: z.boolean().default(d.discord.enabled),
      webhook_id: webhookId.default(d.discord.webhook_id),
      // One channel per league type. Every key carries its own default, so a
      // settings row written before routing existed parses into "no route set,
      // fall back to webhook_id", which is exactly what it used to do.
      routes: z
        .object({
          dynasty: webhookId.default(d.discord.routes.dynasty),
          redraft: webhookId.default(d.discord.routes.redraft),
          "best-ball-dynasty": webhookId.default(d.discord.routes["best-ball-dynasty"]),
          "best-ball-redraft": webhookId.default(d.discord.routes["best-ball-redraft"]),
        })
        .default(d.discord.routes),
      post_hours: postHours.default(d.discord.post_hours),
      poll_hours: z
        .number()
        .int()
        .min(b.poll_hours.min)
        .max(b.poll_hours.max)
        .default(d.discord.poll_hours),
      // Discord role ids are snowflakes: digits only. Anything else would be
      // sent into an allowed_mentions list, so it is rejected here.
      mention_role_ids: z
        .array(z.string().regex(/^\d{1,25}$/))
        .max(10)
        .default(d.discord.mention_role_ids),
    })
    .default(d.discord),
});

export type ValidateResult =
  | { ok: true; settings: WouldYouRatherSettings }
  | { ok: false; error: string };

/** Validate an untrusted settings object. The admin save path's only gate. */
export function validateWouldYouRatherSettings(raw: unknown): ValidateResult {
  const parsed = wouldYouRatherSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") ?? "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  const settings = parsed.data as WouldYouRatherSettings;

  // Two cross-field rules the schema cannot express. Turning the Discord post
  // on with no webhook anywhere, or with no hours picked, would save a
  // configuration that silently never posts, and the admin would have no way to
  // tell that from a Discord outage.
  //
  // "Anywhere" rather than specifically the fallback webhook: an admin who has
  // given every league type its own channel and deliberately left the fallback
  // empty has a complete configuration, and refusing it would force them to
  // nominate a channel they want nothing posted to.
  if (settings.discord.enabled && !hasAnyWebhook(settings)) {
    return {
      ok: false,
      error:
        "discord.webhook_id: choose a webhook, either per league type or as the fallback, before turning posting on.",
    };
  }
  if (settings.discord.enabled && settings.discord.post_hours.length === 0) {
    return { ok: false, error: "discord.post_hours: pick at least one time of day." };
  }
  return { ok: true, settings };
}

/**
 * Fill a partial or older stored document out to a complete one. Falls all the
 * way back to the code defaults when the row cannot be parsed at all, so the
 * game keeps running on a corrupt row rather than 500ing on it.
 */
export function mergeWouldYouRatherSettings(raw: unknown): WouldYouRatherSettings {
  const parsed = wouldYouRatherSettingsSchema.safeParse(raw ?? {});
  return parsed.success
    ? (parsed.data as WouldYouRatherSettings)
    : DEFAULT_WOULD_YOU_RATHER_SETTINGS;
}

export async function loadWouldYouRatherSettings(
  supabase: Client,
): Promise<WouldYouRatherSettings> {
  try {
    const { data, error } = await supabase
      .from("would_you_rather_settings")
      .select("settings")
      .eq("id", WOULD_YOU_RATHER_SETTINGS_ID)
      .maybeSingle();
    if (error || !data?.settings) return DEFAULT_WOULD_YOU_RATHER_SETTINGS;
    return mergeWouldYouRatherSettings(data.settings);
  } catch {
    return DEFAULT_WOULD_YOU_RATHER_SETTINGS;
  }
}

/** Persist a full settings document. Admin server actions only. */
export async function saveWouldYouRatherSettings(
  supabase: Client,
  settings: WouldYouRatherSettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("would_you_rather_settings").upsert(
    {
      id: WOULD_YOU_RATHER_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { DEFAULT_WOULD_YOU_RATHER_SETTINGS };
export type { WouldYouRatherSettings };
