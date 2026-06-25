/**
 * DB-backed ValueResolver for Signal Check.
 *
 * Batches the player meta + value lookups and the pick value lookup for one
 * analysis, then exposes them through the pure ValueResolver interface the
 * value engine consumes. Player and pick values come from FF Beacon ("ffbeacon")
 * for the resolved format; if FF Beacon has no pick rows for a dynasty format,
 * pick values fall back to KTC and the resolved pick source reflects that.
 *
 * Player ids are uuids validated upstream by Zod, and PostgREST .in() is
 * parameterized, so there is no string interpolation of identifiers here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { AnalysisInput, PickPosition, ResolvedFormat, ResolvedSource } from "./types";
import type {
  ResolvedPickValue,
  ResolvedPlayerValue,
  ValueResolver,
} from "./value-engine";
import {
  FFBEACON_SOURCE_SLUG,
  FFBEACON_SOURCE_DISPLAY,
  PICK_FALLBACK_SOURCE_SLUG,
  PICK_FALLBACK_SOURCE_DISPLAY,
} from "./format";

type Client = SupabaseClient<Database>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function playerName(row: {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  if (row.full_name && row.full_name.trim()) return row.full_name;
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown player";
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

interface PlayerEntry {
  name: string;
  position: string | null;
  team: string | null;
  value: number | null;
  capturedAt: string | null;
}

export interface BuiltResolver {
  resolver: ValueResolver;
  source: ResolvedSource;
}

export async function buildValueResolver(
  supabase: Client,
  format: ResolvedFormat,
  input: AnalysisInput,
): Promise<BuiltResolver> {
  const playerIds = Array.from(
    new Set(
      [...input.sides.a, ...input.sides.b]
        .filter((a): a is { kind: "player"; playerId: string } => a.kind === "player")
        .map((a) => a.playerId),
    ),
  );

  const players = new Map<string, PlayerEntry>();

  // Player meta.
  for (const ids of chunk(playerIds, 200)) {
    const { data } = await supabase
      .from("players")
      .select("id, full_name, first_name, last_name, position, team")
      .in("id", ids);
    for (const row of data ?? []) {
      players.set(row.id, {
        name: playerName(row),
        position: row.position ?? null,
        team: row.team ?? null,
        value: null,
        capturedAt: null,
      });
    }
  }

  // Player values (FF Beacon, this format).
  for (const ids of chunk(playerIds, 300)) {
    const { data } = await supabase
      .from("player_value_trends")
      .select("player_id, current_value, updated_at")
      .eq("format_config_id", format.configId)
      .eq("source", FFBEACON_SOURCE_SLUG)
      .in("player_id", ids);
    for (const row of data ?? []) {
      const entry = players.get(row.player_id);
      if (entry) {
        entry.value = typeof row.current_value === "number" ? row.current_value : null;
        entry.capturedAt = row.updated_at ?? null;
      }
    }
  }

  // Picks (dynasty only).
  const hasPicks = [...input.sides.a, ...input.sides.b].some((a) => a.kind === "pick");
  const pickByKey = new Map<string, { value: number; capturedAt: string | null }>();
  const genericByRound = new Map<string, { sum: number; count: number; capturedAt: string | null }>();
  let pickSlug = FFBEACON_SOURCE_SLUG;
  let pickDisplay = FFBEACON_SOURCE_DISPLAY;

  if (hasPicks && format.allowsPicks) {
    const loadPicks = async (sourceSlug: string) => {
      const { data } = await supabase
        .from("draft_pick_values")
        .select("season, round, pick_position, value, captured_at")
        .eq("format_config_id", format.configId)
        .eq("source", sourceSlug)
        .order("captured_at", { ascending: false });
      return data ?? [];
    };

    let rows = await loadPicks(FFBEACON_SOURCE_SLUG);
    if (rows.length === 0) {
      rows = await loadPicks(PICK_FALLBACK_SOURCE_SLUG);
      if (rows.length > 0) {
        pickSlug = PICK_FALLBACK_SOURCE_SLUG;
        pickDisplay = PICK_FALLBACK_SOURCE_DISPLAY;
      }
    }

    for (const row of rows) {
      if (typeof row.value !== "number") continue;
      const key = `${row.season}|${row.round}|${row.pick_position}`;
      // captured_at desc, so the first row per key is the latest.
      if (!pickByKey.has(key)) {
        pickByKey.set(key, { value: row.value, capturedAt: row.captured_at ?? null });
      }
      const gkey = `${row.season}|${row.round}`;
      const g = genericByRound.get(gkey);
      if (g) {
        g.sum += row.value;
        g.count += 1;
        g.capturedAt = later(g.capturedAt, row.captured_at ?? null);
      } else {
        genericByRound.set(gkey, { sum: row.value, count: 1, capturedAt: row.captured_at ?? null });
      }
    }
  }

  const resolver: ValueResolver = {
    player(playerId: string): ResolvedPlayerValue | null {
      const entry = players.get(playerId);
      if (!entry) return null;
      return {
        name: entry.name,
        position: entry.position,
        team: entry.team,
        value: entry.value,
        capturedAt: entry.capturedAt,
      };
    },
    pick(season: number, round: number, pos: PickPosition | "unknown"): ResolvedPickValue {
      if (pos !== "unknown") {
        const hit = pickByKey.get(`${season}|${round}|${pos}`);
        if (hit) return { value: hit.value, capturedAt: hit.capturedAt };
      }
      // Unknown bucket (or specific bucket missing): use the generic
      // season+round average across available buckets.
      const g = genericByRound.get(`${season}|${round}`);
      if (g && g.count > 0) {
        return { value: g.sum / g.count, capturedAt: g.capturedAt };
      }
      return { value: null, capturedAt: null };
    },
  };

  const source: ResolvedSource = {
    slug: FFBEACON_SOURCE_SLUG,
    display: FFBEACON_SOURCE_DISPLAY,
    pickSlug,
    pickDisplay,
  };

  return { resolver, source };
}
