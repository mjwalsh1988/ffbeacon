/**
 * Team Blueprint cache policy (plan 8.1).
 *
 * A stored view is FRESH when its fingerprint matches and it is inside the
 * TTL. The fingerprint is a hash of everything a rebuild would read that can
 * change: the roster's player ids, the generated_at of every cache the build
 * reads (power rankings for this format and source, Power Pulse, Positional
 * WAR, the Manager Ledger), the newest market signal for this format and
 * source, the Power Pulse week, the settings version and the model version.
 *
 * THE WARM PATH IS SIX SMALL QUERIES AND NO ENGINE. Every read here is a
 * single-row select or a limit-1 ordered read on an indexed column, the same
 * split lib/league-positional-war.ts makes between its staleness gate and its
 * compute. Building the view to learn that nothing changed is what this file
 * exists to prevent.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { latestSignalComputedAt } from "@/lib/market-signals/read";
import { BLUEPRINT_MODEL_VERSION, type BlueprintView } from "./types";

type Client = SupabaseClient<Database>;

export type FingerprintInput = {
  playerIds: string[];
  powerRankingsAt: string | null;
  pulseAt: string | null;
  warAt: string | null;
  ledgerAt: string | null;
  signalsAt: string | null;
  throughWeek: number | null;
  settingsVersion: number;
  modelVersion: number;
};

/** Pure: sha1 of the inputs in a fixed order, player ids sorted. */
export function buildFingerprint(input: FingerprintInput): string {
  const payload = JSON.stringify([
    [...input.playerIds].sort(),
    input.powerRankingsAt,
    input.pulseAt,
    input.warAt,
    input.ledgerAt,
    input.signalsAt,
    input.throughWeek,
    input.settingsVersion,
    input.modelVersion,
  ]);
  return createHash("sha1").update(payload).digest("hex");
}

export type CachedBlueprint = {
  view: BlueprintView;
  fingerprint: string;
  modelVersion: number;
  generatedAt: string;
};

/** Pure: fresh when the fingerprint and model match and the row is inside the TTL. */
export function isFresh(
  row: Pick<CachedBlueprint, "fingerprint" | "modelVersion" | "generatedAt"> | null,
  fingerprint: string,
  ttlMs: number,
  now: number,
): boolean {
  if (!row) return false;
  if (row.modelVersion !== BLUEPRINT_MODEL_VERSION) return false;
  if (row.fingerprint !== fingerprint) return false;
  const at = Date.parse(row.generatedAt);
  return Number.isFinite(at) && now - at < ttlMs;
}

function asIds(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== "0");
}

const first = <T>(data: T[] | null | undefined): T | null => (data && data.length > 0 ? data[0] : null);

/** The six small reads behind the fingerprint. No engine, no Sleeper call. */
export async function loadFingerprintInput(
  admin: Client,
  args: {
    leagueRowId: string;
    rosterId: number;
    season: string;
    formatConfigId: string;
    source: string;
    settingsVersion: number;
  },
): Promise<FingerprintInput> {
  const seasonNum = Number(args.season);
  const [roster, rankings, pulse, war, ledger, signalsAt] = await Promise.all([
    admin
      .from("rosters")
      .select("player_ids")
      .eq("league_id", args.leagueRowId)
      .eq("sleeper_roster_id", args.rosterId)
      .maybeSingle(),
    admin
      .from("league_power_rankings_cache")
      .select("generated_at")
      .eq("league_id", args.leagueRowId)
      .eq("format_config_id", args.formatConfigId)
      .eq("source", args.source)
      .order("generated_at", { ascending: false })
      .limit(1),
    admin
      .from("league_power_pulse_cache")
      .select("generated_at, through_week")
      .eq("league_id", args.leagueRowId)
      .eq("season", seasonNum)
      .order("generated_at", { ascending: false })
      .limit(1),
    admin
      .from("league_positional_war_cache")
      .select("generated_at")
      .eq("league_id", args.leagueRowId)
      .eq("season", seasonNum)
      .order("generated_at", { ascending: false })
      .limit(1),
    admin
      .from("league_manager_ledger_cache")
      .select("generated_at")
      .eq("league_id", args.leagueRowId)
      .eq("season", seasonNum)
      .order("generated_at", { ascending: false })
      .limit(1),
    latestSignalComputedAt(admin, args.formatConfigId, args.source),
  ]);
  const p = first(pulse.data);
  return {
    playerIds: asIds(roster.data?.player_ids),
    powerRankingsAt: first(rankings.data)?.generated_at ?? null,
    pulseAt: p?.generated_at ?? null,
    warAt: first(war.data)?.generated_at ?? null,
    ledgerAt: first(ledger.data)?.generated_at ?? null,
    signalsAt,
    throughWeek: p?.through_week ?? null,
    settingsVersion: args.settingsVersion,
    modelVersion: BLUEPRINT_MODEL_VERSION,
  };
}

export async function readCachedBlueprint(
  admin: Client,
  args: { leagueRowId: string; rosterId: number; season: string; source: string },
): Promise<CachedBlueprint | null> {
  const { data, error } = await admin
    .from("league_blueprint_cache")
    .select("view, fingerprint, model_version, generated_at")
    .eq("league_id", args.leagueRowId)
    .eq("roster_id", args.rosterId)
    .eq("season", args.season)
    .eq("source", args.source)
    .maybeSingle();
  if (error || !data) return null;
  return {
    view: data.view as unknown as BlueprintView,
    fingerprint: data.fingerprint,
    modelVersion: data.model_version,
    generatedAt: data.generated_at,
  };
}

export async function writeCachedBlueprint(
  admin: Client,
  args: {
    leagueRowId: string;
    rosterId: number;
    season: string;
    formatConfigId: string;
    source: string;
    view: BlueprintView;
    fingerprint: string;
  },
): Promise<void> {
  const { error } = await admin.from("league_blueprint_cache").upsert(
    {
      league_id: args.leagueRowId,
      roster_id: args.rosterId,
      season: args.season,
      format_config_id: args.formatConfigId,
      source: args.source,
      view: args.view as unknown as Json,
      fingerprint: args.fingerprint,
      model_version: BLUEPRINT_MODEL_VERSION,
      generated_at: args.view.generatedAt,
    },
    { onConflict: "league_id,roster_id,season,source" },
  );
  if (error) throw new Error(`league_blueprint_cache write failed: ${error.message}`);
}

/**
 * Pure: what a failed rebuild renders. The old row stays in place and is
 * shown with its "as of" line; with no old row there is nothing to show.
 */
export function staleOrFailed<C>(
  cached: CachedBlueprint | null,
  context: C,
  message: string,
):
  | { kind: "stale"; view: BlueprintView; context: C; reason: "failed" }
  | { kind: "failed"; context: C; message: string } {
  return cached
    ? { kind: "stale", view: cached.view, context, reason: "failed" }
    : { kind: "failed", context, message };
}
