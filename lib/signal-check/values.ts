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
import { readSleeperId } from "@/lib/ranking-boards";

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
  sleeperId: string | null;
  value: number | null;
  capturedAt: string | null;
}

export interface BuiltResolver {
  resolver: ValueResolver;
  source: ResolvedSource;
  /**
   * The most valuable player in this format's FF Beacon pool.
   *
   * The consolidation curve needs a yardstick for "how big is this asset in the
   * grand scheme", and the answer has to come from the pool rather than from the
   * trade, or a swap of two backups would grade like a swap of two superstars.
   * Null when the pool is empty, which the curve handles by falling back to the
   * trade's own best asset.
   */
  poolMax: number | null;
}

/** Top current value in one format's FF Beacon pool. One indexed row. */
async function loadPoolMax(
  supabase: Client,
  formatConfigId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("player_value_trends")
    .select("current_value")
    .eq("format_config_id", formatConfigId)
    .eq("source", FFBEACON_SOURCE_SLUG)
    .order("current_value", { ascending: false })
    .limit(1)
    .maybeSingle();
  const value = data?.current_value;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * How far back the pick-price read looks. Only the newest snapshot per pick is
 * ever used; the window exists so the query cannot drag months of diary back
 * with it. Generous enough to ride out a sync outage, and there is a fallback
 * below for one longer than this.
 */
const PICK_VALUE_WINDOW_DAYS = 14;

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
  const poolMax = await loadPoolMax(supabase, format.configId);

  // Player meta.
  for (const ids of chunk(playerIds, 200)) {
    const { data } = await supabase
      .from("players")
      .select("id, full_name, first_name, last_name, position, team, external_ids")
      .in("id", ids);
    for (const row of data ?? []) {
      players.set(row.id, {
        name: playerName(row),
        position: row.position ?? null,
        team: row.team ?? null,
        sleeperId: readSleeperId(row.external_ids as Record<string, unknown> | null),
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
    // Only the seasons and rounds this trade references. The old query pulled
    // every pick row for the format, which on a table carrying months of daily
    // snapshots (237 rows for a single season+round already) ran straight into
    // PostgREST's 1000-row cap, so which snapshots came back was a function of
    // how much history existed rather than of the trade being priced.
    const wantedPicks = [...input.sides.a, ...input.sides.b].filter(
      (a): a is Extract<AnalysisInput["sides"]["a"][number], { kind: "pick" }> => a.kind === "pick",
    );
    const seasons = Array.from(new Set(wantedPicks.map((p) => p.season)));
    const rounds = Array.from(new Set(wantedPicks.map((p) => p.round)));

    // ONLY THE LAST FORTNIGHT OF SNAPSHOTS. draft_pick_values is a diary: the
    // nightly sync ADDS a row per pick per day and never overwrites, so after a
    // few months one season+round carries hundreds of rows and a trade touching
    // several of them was pulling well over a thousand to read about six
    // numbers. Worse, a query with no limit is silently capped at 1000 rows by
    // PostgREST, so how many snapshots came back was a function of how much
    // history existed. The dedupe below still only wants the newest row per
    // pick, and a fortnight is thirteen days more than it needs.
    const windowStart = new Date(Date.now() - PICK_VALUE_WINDOW_DAYS * 86_400_000).toISOString();

    const loadPicks = async (sourceSlug: string, since: string | null) => {
      let query = supabase
        .from("draft_pick_values")
        .select("season, round, pick_position, value, captured_at")
        .eq("format_config_id", format.configId)
        .eq("source", sourceSlug)
        .in("season", seasons)
        .in("round", rounds);
      if (since) query = query.gte("captured_at", since);
      const { data } = await query.order("captured_at", { ascending: false });
      return data ?? [];
    };

    // A window that comes back empty means the sync has not run inside it, not
    // that the pick has no price. Falling back to the unwindowed query keeps a
    // multi-day outage from silently stripping every pick out of a trade.
    const loadPicksWithFallback = async (sourceSlug: string) => {
      const recent = await loadPicks(sourceSlug, windowStart);
      return recent.length > 0 ? recent : loadPicks(sourceSlug, null);
    };

    let rows = await loadPicksWithFallback(FFBEACON_SOURCE_SLUG);
    if (rows.length === 0) {
      rows = await loadPicksWithFallback(PICK_FALLBACK_SOURCE_SLUG);
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
    }

    // The slot-agnostic value averages TODAY's early/mid/late and nothing else.
    // Building it from every returned row instead averaged months of history
    // into one number: a 2027 1st priced at 5,062 against a true 4,960, drifting
    // further every night as more snapshots landed. That number is what the
    // Sleeper import uses for every pick, because Sleeper never tells us the
    // slot, so the drift landed on exactly the path that cannot check it.
    for (const [key, hit] of pickByKey) {
      const [season, round] = key.split("|");
      const gkey = `${season}|${round}`;
      const g = genericByRound.get(gkey);
      if (g) {
        g.sum += hit.value;
        g.count += 1;
        g.capturedAt = later(g.capturedAt, hit.capturedAt);
      } else {
        genericByRound.set(gkey, { sum: hit.value, count: 1, capturedAt: hit.capturedAt });
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
        sleeperId: entry.sleeperId,
        value: entry.value,
        capturedAt: entry.capturedAt,
      };
    },
    pick(season: number, round: number, pos: PickPosition | "unknown"): ResolvedPickValue {
      if (pos !== "unknown") {
        const hit = pickByKey.get(`${season}|${round}|${pos}`);
        if (hit) return { value: hit.value, capturedAt: hit.capturedAt, blended: false };
      }
      // Unknown bucket (or specific bucket missing): use the generic
      // season+round average across available buckets. `blended` travels with
      // it so the surfaces can say so; an early 1st and a late 1st are far
      // enough apart that the blend can decide a verdict on its own.
      const g = genericByRound.get(`${season}|${round}`);
      if (g && g.count > 0) {
        return { value: g.sum / g.count, capturedAt: g.capturedAt, blended: true };
      }
      return { value: null, capturedAt: null, blended: false };
    },
  };

  const source: ResolvedSource = {
    slug: FFBEACON_SOURCE_SLUG,
    display: FFBEACON_SOURCE_DISPLAY,
    pickSlug,
    pickDisplay,
  };

  return { resolver, source, poolMax };
}
