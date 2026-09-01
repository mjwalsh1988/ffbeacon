/**
 * Load, validate, and persist League Relay settings.
 *
 * One jsonb row (id = 'global') in league_relay_settings, service-role only, so
 * the admin action writes it with the service client and the cron reads it with
 * the service client. Same shape as would_you_rather_settings and
 * league_power_pulse_settings.
 *
 * Every field carries a default, so a row written before a field existed is
 * filled in rather than rejected. A wrong TYPE still fails, because that is a
 * mistake rather than an older version.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  DEFAULT_LEAGUE_RELAY_SETTINGS,
  DEFAULT_RELAY_CHANNEL,
  RELAY_MESSAGE_LABEL,
  RELAY_MESSAGE_TYPES,
  RELAY_SETTING_BOUNDS,
  type LeagueRelaySettings,
  type RelayMessageType,
} from "./default-settings";

type Client = SupabaseClient<Database>;

export const LEAGUE_RELAY_SETTINGS_ID = "global";

const d = DEFAULT_LEAGUE_RELAY_SETTINGS;
const b = RELAY_SETTING_BOUNDS;

/**
 * A webhook id, or nothing.
 *
 * An empty string from a cleared <select> means the same thing as "no webhook
 * chosen", so it is coerced rather than rejected.
 */
const webhookId = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .transform((v) => (v ? v : null));

const channelSchema = z
  .object({
    enabled: z.boolean().default(DEFAULT_RELAY_CHANNEL.enabled),
    webhook_id: webhookId.default(DEFAULT_RELAY_CHANNEL.webhook_id),
    poll: z.boolean().default(DEFAULT_RELAY_CHANNEL.poll),
    poll_hours: z
      .number()
      .int()
      .min(b.poll_hours.min)
      .max(b.poll_hours.max)
      .default(DEFAULT_RELAY_CHANNEL.poll_hours),
    // Discord role ids are snowflakes: digits only. Anything else would be sent
    // into an allowed_mentions list, so it is rejected here rather than sent.
    mention_role_ids: z
      .array(z.string().regex(/^\d{1,25}$/))
      .max(10)
      .default(DEFAULT_RELAY_CHANNEL.mention_role_ids),
  })
  .default(DEFAULT_RELAY_CHANNEL);

const hour = z.number().int().min(b.hour.min).max(b.hour.max);
const weekday = z.number().int().min(b.weekday.min).max(b.weekday.max);

export const leagueRelaySettingsSchema = z.object({
  enabled: z.boolean().default(d.enabled),

  sync: z
    .object({
      max_leagues_per_run: z
        .number()
        .int()
        .min(b.max_leagues_per_run.min)
        .max(b.max_leagues_per_run.max)
        .default(d.sync.max_leagues_per_run),
      max_transaction_age_hours: z
        .number()
        .int()
        .min(b.max_transaction_age_hours.min)
        .max(b.max_transaction_age_hours.max)
        .default(d.sync.max_transaction_age_hours),
      max_messages_per_league_per_run: z
        .number()
        .int()
        .min(b.max_messages_per_league_per_run.min)
        .max(b.max_messages_per_league_per_run.max)
        .default(d.sync.max_messages_per_league_per_run),
    })
    .default(d.sync),

  channels: z
    .object({
      trade: channelSchema.default(d.channels.trade),
      waiver: channelSchema.default(d.channels.waiver),
      matchup_preview: channelSchema.default(d.channels.matchup_preview),
      matchup_recap: channelSchema.default(d.channels.matchup_recap),
    })
    .default(d.channels),

  waivers: z
    .object({
      digest_threshold: z
        .number()
        .int()
        .min(b.digest_threshold.min)
        .max(b.digest_threshold.max)
        .default(d.waivers.digest_threshold),
      include_bare_drops: z.boolean().default(d.waivers.include_bare_drops),
    })
    .default(d.waivers),

  matchups: z
    .object({
      preview_weekday: weekday.default(d.matchups.preview_weekday),
      preview_hour: hour.default(d.matchups.preview_hour),
      preview_headline: z.boolean().default(d.matchups.preview_headline),
      preview_undercard: z.boolean().default(d.matchups.preview_undercard),
      recap_weekday: weekday.default(d.matchups.recap_weekday),
      recap_start_hour: hour.default(d.matchups.recap_start_hour),
      recap_end_hour: hour.default(d.matchups.recap_end_hour),
    })
    .default(d.matchups),

  voice: z
    .object({
      snark: z.number().min(b.snark.min).max(b.snark.max).default(d.voice.snark),
      show_numbers: z.boolean().default(d.voice.show_numbers),
      link_back: z.boolean().default(d.voice.link_back),
    })
    .default(d.voice),
});

export type ValidateResult =
  | { ok: true; settings: LeagueRelaySettings }
  | { ok: false; error: string };

/** Validate an untrusted settings object. The admin save path's only gate. */
export function validateLeagueRelaySettings(raw: unknown): ValidateResult {
  const parsed = leagueRelaySettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") ?? "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  const settings = parsed.data as LeagueRelaySettings;

  // Cross-field rules the schema cannot express. Each one would otherwise save a
  // configuration that silently never posts, and an admin has no way to tell
  // that apart from a Discord outage.
  for (const type of RELAY_MESSAGE_TYPES) {
    const channel = settings.channels[type];
    if (channel.enabled && !channel.webhook_id) {
      return {
        ok: false,
        error: `channels.${type}.webhook_id: choose a channel for ${RELAY_MESSAGE_LABEL[type].toLowerCase()} before turning them on.`,
      };
    }
  }

  const m = settings.matchups;
  if (settings.channels.matchup_recap.enabled && m.recap_end_hour < m.recap_start_hour) {
    return {
      ok: false,
      error:
        "matchups.recap_end_hour: the last recap hour is before the first, so no recap could ever go out.",
    };
  }
  if (
    settings.channels.matchup_preview.enabled &&
    !m.preview_headline &&
    !m.preview_undercard
  ) {
    return {
      ok: false,
      error:
        "matchups.preview_headline: previews are on but neither the headline nor the undercard is selected.",
    };
  }

  return { ok: true, settings };
}

/**
 * Fill a partial or older stored document out to a complete one. Falls all the
 * way back to the code defaults when the row cannot be parsed at all, so the
 * relay keeps running on a corrupt row rather than throwing inside a cron.
 */
export function mergeLeagueRelaySettings(raw: unknown): LeagueRelaySettings {
  const parsed = leagueRelaySettingsSchema.safeParse(raw ?? {});
  return parsed.success
    ? (parsed.data as LeagueRelaySettings)
    : DEFAULT_LEAGUE_RELAY_SETTINGS;
}

export async function loadLeagueRelaySettings(
  supabase: Client,
): Promise<LeagueRelaySettings> {
  try {
    const { data, error } = await supabase
      .from("league_relay_settings")
      .select("settings")
      .eq("id", LEAGUE_RELAY_SETTINGS_ID)
      .maybeSingle();
    if (error || !data?.settings) return DEFAULT_LEAGUE_RELAY_SETTINGS;
    return mergeLeagueRelaySettings(data.settings);
  } catch {
    return DEFAULT_LEAGUE_RELAY_SETTINGS;
  }
}

/** Persist a full settings document. Admin server actions only. */
export async function saveLeagueRelaySettings(
  supabase: Client,
  settings: LeagueRelaySettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("league_relay_settings").upsert(
    {
      id: LEAGUE_RELAY_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Which message types are switched on AND have somewhere to go. */
export function liveMessageTypes(settings: LeagueRelaySettings): RelayMessageType[] {
  if (!settings.enabled) return [];
  return RELAY_MESSAGE_TYPES.filter(
    (t) => settings.channels[t].enabled && settings.channels[t].webhook_id,
  );
}

export { DEFAULT_LEAGUE_RELAY_SETTINGS };
export type { LeagueRelaySettings, RelayMessageType };
