/**
 * Load and validate BEAM settings.
 *
 * Single pinned row (id = 'global') in beam_settings, written only by the admin
 * editor through the service role. Same pattern as lib/faab/settings.ts and
 * lib/draft-value/settings.ts: every field carries a default, so a partial or
 * older row is filled in rather than rejected, and a wrong TYPE still fails.
 *
 * The load path never throws. BEAM answering with slightly stale thresholds is
 * fine; BEAM 500ing because a settings row got mangled is not.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { CAPABILITY_IDS, type CapabilityId } from "./types";
import { DEFAULT_BEAM_SETTINGS, type BeamSettings } from "./default-settings";

type Client = SupabaseClient<Database>;

export const BEAM_SETTINGS_ID = "global";

const d = DEFAULT_BEAM_SETTINGS;

const unitInterval = z.number().min(0).max(1);

export const beamSettingsSchema = z.object({
  resolver: z
    .object({
      acceptConfidence: unitInterval.default(d.resolver.acceptConfidence),
      acceptMargin: unitInterval.default(d.resolver.acceptMargin),
      clarifyFloor: unitInterval.default(d.resolver.clarifyFloor),
      clarifyWindow: unitInterval.default(d.resolver.clarifyWindow),
      maxClarifyOptions: z
        .number()
        .int()
        .min(2)
        .max(8)
        .default(d.resolver.maxClarifyOptions),
      trigramFloor: unitInterval.default(d.resolver.trigramFloor),
      maxEditDistance: z.number().int().min(0).max(4).default(d.resolver.maxEditDistance),
    })
    .default(d.resolver)
    .refine((r) => r.clarifyFloor <= r.acceptConfidence, {
      message: "clarifyFloor must be <= acceptConfidence",
    }),

  intent: z
    .object({
      acceptScore: unitInterval.default(d.intent.acceptScore),
      acceptMargin: unitInterval.default(d.intent.acceptMargin),
    })
    .default(d.intent),

  limits: z
    .object({
      // Capped at 500 so an admin cannot turn the ask endpoint into a text sink.
      maxQuestionLength: z.number().int().min(40).max(500).default(d.limits.maxQuestionLength),
      askMaxPerWindow: z.number().int().min(1).max(600).default(d.limits.askMaxPerWindow),
      askWindowSeconds: z.number().int().min(10).max(3600).default(d.limits.askWindowSeconds),
      // Floored at 60 so the global ceiling can never be set below a single
      // actor's allowance, which would reject everyone the moment one person
      // asked a normal number of questions.
      askGlobalMaxPerWindow: z
        .number()
        .int()
        .min(60)
        .max(20000)
        .default(d.limits.askGlobalMaxPerWindow),
      askGlobalWindowSeconds: z
        .number()
        .int()
        .min(10)
        .max(3600)
        .default(d.limits.askGlobalWindowSeconds),
      learnMaxPerWindow: z.number().int().min(1).max(50).default(d.limits.learnMaxPerWindow),
      learnWindowSeconds: z
        .number()
        .int()
        .min(60)
        .max(86400)
        .default(d.limits.learnWindowSeconds),
    })
    .default(d.limits)
    // The ceiling on everyone must not sit below what one visitor may spend, or
    // a single reader behaving exactly as configured locks out the endpoint.
    // Compared as rates, because the two windows are configured independently
    // and "600 per minute" against "30 per 10 seconds" is not a comparison you
    // can make on the numerators alone.
    .refine(
      (l) =>
        l.askGlobalMaxPerWindow / l.askGlobalWindowSeconds >=
        l.askMaxPerWindow / l.askWindowSeconds,
      {
        message:
          "the combined ceiling must allow at least as many questions per second as one visitor",
      },
    ),

  capabilities: z
    .object({
      disabled: z
        .array(z.enum(CAPABILITY_IDS))
        .default(d.capabilities.disabled as CapabilityId[]),
    })
    .default(d.capabilities),

  logging: z
    .object({
      enabled: z.boolean().default(d.logging.enabled),
      retentionDays: z.number().int().min(7).max(1095).default(d.logging.retentionDays),
    })
    .default(d.logging),

  interpreter: z
    .object({
      strategy: z
        .enum(["deterministic", "llm", "deterministic-then-llm"])
        .default(d.interpreter.strategy),
      model: z.string().max(120).nullable().default(d.interpreter.model),
      systemPrompt: z.string().max(20000).nullable().default(d.interpreter.systemPrompt),
    })
    .default(d.interpreter),
});

export type ValidateBeamSettingsResult =
  | { ok: true; settings: BeamSettings }
  | { ok: false; error: string };

/** Validate an untrusted settings object. The admin save path's only gate. */
export function validateBeamSettings(raw: unknown): ValidateBeamSettingsResult {
  const parsed = beamSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true, settings: parsed.data as BeamSettings };
}

/**
 * Settings for one request. Always returns a complete, valid object: the stored
 * row is merged onto defaults by the schema, and any failure falls back whole.
 */
export async function loadBeamSettings(admin: Client): Promise<BeamSettings> {
  try {
    const { data, error } = await admin
      .from("beam_settings")
      .select("settings")
      .eq("id", BEAM_SETTINGS_ID)
      .maybeSingle();

    if (error || !data?.settings) return { ...DEFAULT_BEAM_SETTINGS };

    const parsed = beamSettingsSchema.safeParse(data.settings);
    if (!parsed.success) {
      console.error("[beam] stored settings invalid, using defaults", parsed.error.issues);
      return { ...DEFAULT_BEAM_SETTINGS };
    }
    return parsed.data as BeamSettings;
  } catch (err) {
    console.error("[beam] settings load failed, using defaults", err);
    return { ...DEFAULT_BEAM_SETTINGS };
  }
}
