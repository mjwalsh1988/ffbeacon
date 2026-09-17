/**
 * Loads the Brief desk tunables from beacon_settings (category 'brief_desk').
 *
 * Same shape as lib/beacon-brief/settings.ts: a defaults object mirroring the
 * seed migration (0285), a key map, and a loader that degrades to the defaults
 * when a row is missing. Memoised for a minute through lib/memo-ttl.ts and
 * busted with bustMemo("settings:brief_desk") by the admin save action.
 *
 * Two things live here that the curation pass reads on every post: the RELAY
 * prompt section and the headline cap. Everything else is the Brief cadence and
 * the editorial instructions the bundle endpoint hands to the desk run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import { RELAY_PROMPT_SECTION } from "@/lib/relays/extract";
import { RELAY_HEADLINE_MAX } from "@/lib/relays/types";
import { BRIEF_INSTRUCTIONS_SEED } from "./instructions-seed";

export interface BriefDeskSettings {
  /** The bundle endpoint answers "due" at all. */
  enabled: boolean;
  /** Fixed at weekly; shown for clarity. */
  inSeasonCadence: string;
  /** Off, the off-season runs every two weeks; on, monthly. */
  offSeasonMonthly: boolean;
  /** 0 is Sunday, 2 is Tuesday. */
  runWeekday: number;
  /** The hour the period closes, Eastern. */
  runHourEt: number;
  /** Off-season only: below this many Relays the period rolls into the next. */
  minRelays: number;
  /** The editorial brief handed to the desk run inside the bundle. */
  briefInstructions: string;
  /** The RELAY section appended to the classify prompt. */
  relayExtractPrompt: string;
  relayHeadlineMax: number;
  /** Post an approved Brief to Discord with an everyone mention and the link. */
  discordBriefsEnabled: boolean;
}

export const BRIEF_DESK_DEFAULTS: BriefDeskSettings = {
  enabled: true,
  inSeasonCadence: "weekly",
  offSeasonMonthly: false,
  runWeekday: 2,
  runHourEt: 9,
  minRelays: 6,
  briefInstructions: BRIEF_INSTRUCTIONS_SEED,
  relayExtractPrompt: RELAY_PROMPT_SECTION,
  relayHeadlineMax: RELAY_HEADLINE_MAX,
  discordBriefsEnabled: true,
};

export const BRIEF_DESK_SETTING_KEYS = [
  "bd_enabled",
  "bd_inseason_cadence",
  "bd_offseason_monthly",
  "bd_run_weekday",
  "bd_run_hour_et",
  "bd_min_relays",
  "bd_discord_briefs_enabled",
  "bd_relay_headline_max",
  "bd_brief_instructions",
  "bd_relay_extract_prompt",
] as const;

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return fallback;
}
function asNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asStr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

export const BRIEF_DESK_MEMO_KEY = "settings:brief_desk";

export async function loadBriefDeskSettings(
  admin: SupabaseClient<Database>,
): Promise<BriefDeskSettings> {
  return memoTtl(BRIEF_DESK_MEMO_KEY, 60_000, async () => {
    const { data, error } = await admin
      .from("beacon_settings")
      .select("key, value")
      .eq("category", "brief_desk");
    if (error || !data) return { ...BRIEF_DESK_DEFAULTS };

    const map = new Map<string, unknown>();
    for (const row of data) map.set(row.key, row.value);
    const d = BRIEF_DESK_DEFAULTS;
    return {
      enabled: asBool(map.get("bd_enabled"), d.enabled),
      inSeasonCadence: asStr(map.get("bd_inseason_cadence"), d.inSeasonCadence),
      offSeasonMonthly: asBool(map.get("bd_offseason_monthly"), d.offSeasonMonthly),
      runWeekday: Math.min(6, Math.max(0, Math.round(asNum(map.get("bd_run_weekday"), d.runWeekday)))),
      runHourEt: Math.min(23, Math.max(0, Math.round(asNum(map.get("bd_run_hour_et"), d.runHourEt)))),
      minRelays: Math.max(0, Math.round(asNum(map.get("bd_min_relays"), d.minRelays))),
      briefInstructions: asStr(map.get("bd_brief_instructions"), d.briefInstructions),
      relayExtractPrompt: asStr(map.get("bd_relay_extract_prompt"), d.relayExtractPrompt),
      relayHeadlineMax: Math.max(40, Math.round(asNum(map.get("bd_relay_headline_max"), d.relayHeadlineMax))),
      discordBriefsEnabled: asBool(map.get("bd_discord_briefs_enabled"), d.discordBriefsEnabled),
    };
  });
}
