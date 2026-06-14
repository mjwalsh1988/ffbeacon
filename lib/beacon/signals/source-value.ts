/**
 * source_value producer: gather the latest FRESH external snapshot per
 * (player, format, source), excluding FF Beacon's own output. Plan v3.1, 3a/3c.
 *
 * Two self-reference guards: the source iteration set excludes 'ffbeacon', and
 * every query also carries .neq('source','ffbeacon'). The cadence-aware
 * staleness gate (.gte captured_at cutoff) drops a broken-but-active source from
 * the blend exactly as if it were inactive, and the freshness report makes a
 * quiet outage visible.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { withRetry } from "../../supabase/retry";
import { staleCutoffMs, staleDaysFor, type StaleDays } from "../freshness";
import type { SourcePlayerValue } from "../normalize";

export interface ExternalSource {
  slug: string;
  cadence: string;
  supportedFormatSlugs: string[] | null;
}

export interface FreshnessEntry {
  source: string;
  cadence: string;
  cutoffDays: number;
  newestCapturedAt: string | null;
  fresh: number;
  droppedForStaleness: boolean;
}

export interface SourceValueGather {
  /** formatConfigId -> (sourceSlug -> latest fresh values). */
  byFormat: Map<string, Map<string, SourcePlayerValue[]>>;
  positionByPlayer: Map<string, string>;
  freshness: FreshnessEntry[];
}

export async function loadPositionByPlayer(
  supabase: SupabaseClient<Database>,
): Promise<Map<string, string>> {
  const byPlayer = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, position")
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `players page ${from}` },
    );
    for (const p of page) byPlayer.set(p.id, p.position);
    if (page.length < PAGE) break;
  }
  return byPlayer;
}

/** Latest fresh value per player for one (source, format) within the cutoff. */
async function latestFresh(
  supabase: SupabaseClient<Database>,
  source: string,
  formatId: string,
  cutoffIso: string,
): Promise<SourcePlayerValue[]> {
  const rows = await withRetry(
    async () => {
      const { data, error } = await supabase
        .from("player_value_history")
        .select("player_id, value, captured_at")
        .eq("format_config_id", formatId)
        .eq("source", source)
        .neq("source", "ffbeacon") // self-reference guard (belt-and-suspenders)
        .gte("captured_at", cutoffIso) // staleness gate
        .order("captured_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    { label: `source_value ${source}/${formatId}` },
  );
  const latest = new Map<string, number>();
  for (const r of rows) {
    if (latest.has(r.player_id)) continue;
    latest.set(r.player_id, Number(r.value));
  }
  return [...latest.entries()].map(([playerId, value]) => ({ playerId, value }));
}

async function newestCapturedAt(
  supabase: SupabaseClient<Database>,
  source: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("player_value_history")
    .select("captured_at")
    .eq("source", source)
    .order("captured_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? data[0].captured_at : null;
}

export async function gatherSourceValues(
  supabase: SupabaseClient<Database>,
  opts: {
    sources: ExternalSource[];
    ffbeaconFormats: Array<{ slug: string; id: string }>;
    staleDays: StaleDays;
    nowMs: number;
  },
): Promise<SourceValueGather> {
  const { sources, ffbeaconFormats, staleDays, nowMs } = opts;
  const formatIdBySlug = new Map(ffbeaconFormats.map((f) => [f.slug, f.id]));

  const byFormat = new Map<string, Map<string, SourcePlayerValue[]>>();
  for (const f of ffbeaconFormats) byFormat.set(f.id, new Map());

  const freshness: FreshnessEntry[] = [];

  for (const src of sources) {
    if (src.slug === "ffbeacon") continue; // self-reference guard (iteration set)
    const cutoffDays = staleDaysFor(src.cadence, staleDays);
    const cutoffIso = new Date(staleCutoffMs(src.cadence, nowMs, staleDays)).toISOString();
    const newest = await newestCapturedAt(supabase, src.slug);
    const droppedForStaleness =
      newest !== null && new Date(newest).getTime() < new Date(cutoffIso).getTime();

    // Only the formats this source supports AND ffbeacon supports.
    const supported = src.supportedFormatSlugs;
    const formatSlugs = ffbeaconFormats
      .map((f) => f.slug)
      .filter((slug) => supported === null || supported.includes(slug));

    let fresh = 0;
    for (const slug of formatSlugs) {
      const formatId = formatIdBySlug.get(slug);
      if (!formatId) continue;
      const values = await latestFresh(supabase, src.slug, formatId, cutoffIso);
      if (values.length === 0) continue;
      byFormat.get(formatId)!.set(src.slug, values);
      fresh += values.length;
    }

    freshness.push({
      source: src.slug,
      cadence: src.cadence,
      cutoffDays,
      newestCapturedAt: newest,
      fresh,
      droppedForStaleness: droppedForStaleness || fresh === 0,
    });
  }

  const positionByPlayer = await loadPositionByPlayer(supabase);
  return { byFormat, positionByPlayer, freshness };
}
