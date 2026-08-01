import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type ServiceClient = SupabaseClient<Database>;

export type PowerRankingsResult =
  | { ok: true; combosWritten: number; rostersConsidered: number }
  | { ok: false; error: string };

// The roster_positions array from Sleeper uses these slot tokens for the
// starting lineup. Everything else (BN, IR, TAXI, K, DEF, etc.) is excluded
// from starter value because we don't currently value those positions.
const STARTING_SLOT_HANDLERS: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WR_TE: ["WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  Q_FLEX: ["QB", "RB", "WR", "TE"],
};

const VALUED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

type PlayerLite = {
  player_id: string;
  sleeper_id: string;
  position: string;
};

type ValueMap = Map<string, number>; // player_id -> current_value

type PickValueLookup = {
  // key: `${season}|${round}|${pick_position}`
  values: Map<string, number>;
};

type Combo = {
  format_config_id: string;
  source: string;
};

/**
 * Calculate power rankings for a single league across every available
 * (format, source) combo and upsert into league_power_rankings_cache.
 * Idempotent, re-running replaces the rows for that league.
 *
 * Why iterate all combos: users toggle format/source on the deep view and
 * the cache row for the displayed combo must exist. Combos with no value
 * data (e.g. FantasyCalc + Redraft TEP) are silently skipped.
 */
export async function calculateLeaguePowerRankings(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<PowerRankingsResult> {
  const { data: league, error: leagueErr } = await supabase
    .from("leagues")
    .select("id, roster_positions, format_config_id")
    .eq("id", leagueRowId)
    .maybeSingle();
  if (leagueErr) return { ok: false, error: leagueErr.message };
  if (!league) return { ok: false, error: "league row not found" };

  const { data: rosters, error: rosterErr } = await supabase
    .from("rosters")
    .select("id, sleeper_roster_id, player_ids, starter_ids, draft_pick_assets")
    .eq("league_id", leagueRowId);
  if (rosterErr) return { ok: false, error: rosterErr.message };
  if (!rosters || rosters.length === 0) {
    return { ok: true, combosWritten: 0, rostersConsidered: 0 };
  }

  // Collect every sleeper_id appearing on any roster, then resolve to FF
  // Beacon player_id + position in a single query.
  const allSleeperIds = new Set<string>();
  for (const r of rosters) {
    for (const id of asStringArray(r.player_ids)) allSleeperIds.add(id);
  }
  const players = await resolvePlayers(supabase, Array.from(allSleeperIds));

  // Active combos: every (active source, active format) pair where the
  // source supports the format. Picks are valued from draft_pick_values,
  // player values from player_value_trends.
  const combos = await loadActiveCombos(supabase);

  const startingSlots = parseStartingSlots(asStringArray(league.roster_positions));

  let combosWritten = 0;
  for (const combo of combos) {
    const valueMap = await loadPlayerValueMap(supabase, combo);
    if (valueMap.size === 0) continue;

    const pickLookup = await loadPickLookup(supabase, combo);

    type RosterCalc = {
      rosterRowId: string;
      starter_value: number;
      bench_value: number;
      picks_value: number;
      total_value: number;
      positional_breakdowns: Json;
    };

    const calcs: RosterCalc[] = [];
    for (const roster of rosters) {
      const rosterPlayers = asStringArray(roster.player_ids)
        .map((sid) => players.get(sid))
        .filter((p): p is PlayerLite => Boolean(p))
        .map((p) => ({
          ...p,
          value: valueMap.get(p.player_id) ?? 0,
        }))
        .filter((p) => VALUED_POSITIONS.has(p.position));

      const { starterValue, benchValue, breakdowns } = assignStarters(
        rosterPlayers,
        startingSlots,
      );

      const picks = asUnknownArray(roster.draft_pick_assets);
      const picksValue = sumPickValues(picks, pickLookup);

      const total = starterValue + benchValue + picksValue;

      calcs.push({
        rosterRowId: roster.id,
        starter_value: round2(starterValue),
        bench_value: round2(benchValue),
        picks_value: round2(picksValue),
        total_value: round2(total),
        positional_breakdowns: {
          ...breakdowns,
          PICKS: {
            value: round2(picksValue),
            picks: picks.map((p) => describePick(p)),
          },
        } as unknown as Json,
      });
    }

    // Rank by total_value desc, then starter_value desc for tiebreak.
    const byOverall = [...calcs].sort(
      (a, b) => b.total_value - a.total_value || b.starter_value - a.starter_value,
    );
    const overallRankByRoster = new Map<string, number>();
    byOverall.forEach((c, i) => overallRankByRoster.set(c.rosterRowId, i + 1));

    const byStarter = [...calcs].sort((a, b) => b.starter_value - a.starter_value);
    const starterRankByRoster = new Map<string, number>();
    byStarter.forEach((c, i) => starterRankByRoster.set(c.rosterRowId, i + 1));

    const generatedAt = new Date().toISOString();
    const upsertRows = calcs.map((c) => ({
      league_id: leagueRowId,
      roster_id: c.rosterRowId,
      format_config_id: combo.format_config_id,
      source: combo.source,
      starter_value: c.starter_value,
      bench_value: c.bench_value,
      picks_value: c.picks_value,
      total_value: c.total_value,
      overall_rank: overallRankByRoster.get(c.rosterRowId) ?? null,
      starter_rank: starterRankByRoster.get(c.rosterRowId) ?? null,
      positional_breakdowns: c.positional_breakdowns,
      generated_at: generatedAt,
    }));

    const { error: upsertErr } = await supabase
      .from("league_power_rankings_cache")
      .upsert(upsertRows, { onConflict: "league_id,roster_id,format_config_id,source" });
    if (upsertErr) {
      return { ok: false, error: `power rankings upsert failed: ${upsertErr.message}` };
    }
    combosWritten++;
  }

  return { ok: true, combosWritten, rostersConsidered: rosters.length };
}

// ---------- helpers ----------

function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asUnknownArray(value: Json | null | undefined): unknown[] {
  if (!Array.isArray(value)) return [];
  return value as unknown[];
}

async function resolvePlayers(
  supabase: ServiceClient,
  sleeperIds: string[],
): Promise<Map<string, PlayerLite>> {
  const map = new Map<string, PlayerLite>();
  if (sleeperIds.length === 0) return map;

  // Primary: match by external_ids.sleeper.
  // Fallback: match by slug tail "-<sleeperId>". sync-sleeper-players embeds
  // the sleeper id in the slug, so even rows where external_ids.sleeper was
  // somehow stripped still resolve. Mirrors the sync-fantasycalc.ts pattern.
  const CHUNK = 200;
  for (let i = 0; i < sleeperIds.length; i += CHUNK) {
    const chunk = sleeperIds.slice(i, i + CHUNK);
    const ors = chunk
      .flatMap((id) => [
        `external_ids->>sleeper.eq.${id}`,
        `slug.like.*-${id}`,
      ])
      .join(",");
    const { data, error } = await supabase
      .from("players")
      .select("id, slug, position, external_ids")
      .or(ors);
    if (error) throw new Error(`player resolve failed: ${error.message}`);
    for (const p of data ?? []) {
      const ext = (p.external_ids as Record<string, unknown>) ?? {};
      const fromExternal = typeof ext.sleeper === "string" ? ext.sleeper : null;
      const tail = (p.slug as string).match(/-(\d+)$/)?.[1] ?? null;
      const sid = fromExternal ?? tail;
      if (!sid || !chunk.includes(sid)) continue;
      if (!map.has(sid)) {
        map.set(sid, { player_id: p.id, sleeper_id: sid, position: p.position });
      }
    }
  }
  return map;
}

async function loadActiveCombos(supabase: ServiceClient): Promise<Combo[]> {
  const [{ data: sources }, { data: formats }] = await Promise.all([
    supabase
      .from("source_registry")
      .select("slug, supported_format_slugs")
      .eq("is_active", true),
    supabase.from("format_configs").select("id, slug").eq("is_active", true),
  ]);
  if (!sources || !formats) return [];

  const combos: Combo[] = [];
  for (const source of sources) {
    const supported = source.supported_format_slugs;
    for (const format of formats) {
      const supports = supported === null || supported.includes(format.slug);
      if (!supports) continue;
      combos.push({ format_config_id: format.id, source: source.slug });
    }
  }
  return combos;
}

async function loadPlayerValueMap(
  supabase: ServiceClient,
  combo: Combo,
): Promise<ValueMap> {
  const map: ValueMap = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_value_trends")
      .select("player_id, current_value")
      .eq("format_config_id", combo.format_config_id)
      .eq("source", combo.source)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load player_value_trends failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) map.set(row.player_id, Number(row.current_value));
    if (data.length < PAGE) break;
  }
  return map;
}

async function loadPickLookup(
  supabase: ServiceClient,
  combo: Combo,
): Promise<PickValueLookup> {
  const { data, error } = await supabase
    .from("draft_pick_values")
    .select("season, round, pick_position, value, captured_at")
    .eq("format_config_id", combo.format_config_id)
    .eq("source", combo.source)
    .order("captured_at", { ascending: false });
  if (error) throw new Error(`load draft_pick_values failed: ${error.message}`);
  const values = new Map<string, number>();
  for (const row of data ?? []) {
    const key = `${row.season}|${row.round}|${row.pick_position}`;
    if (!values.has(key)) values.set(key, Number(row.value));
  }
  return { values };
}

type StartingSlotPlan = {
  // For each starting slot, the positions that can fill it (in priority order).
  slots: string[][];
};

function parseStartingSlots(positions: string[]): StartingSlotPlan {
  const slots: string[][] = [];
  for (const pos of positions) {
    if (pos === "BN" || pos === "IR" || pos === "TAXI") continue;
    if (pos === "K" || pos === "DEF" || pos === "DST") continue;
    const handler = STARTING_SLOT_HANDLERS[pos];
    if (!handler) continue;
    slots.push(handler);
  }
  return { slots };
}

type RankedPlayer = PlayerLite & { value: number };

function assignStarters(
  players: RankedPlayer[],
  plan: StartingSlotPlan,
): {
  starterValue: number;
  benchValue: number;
  breakdowns: Record<
    string,
    { value: number; rank: null; players: Array<{ player_id: string; value: number; slot: "starter" | "bench" }> }
  >;
} {
  // Sort each position group by value desc; greedily assign starters slot
  // by slot from most restrictive (single-position) to least (FLEX, then
  // SUPER_FLEX). This isn't strictly optimal but matches how a fantasy
  // manager would set their lineup.
  const sortedByPos = new Map<string, RankedPlayer[]>();
  for (const p of players) {
    const arr = sortedByPos.get(p.position) ?? [];
    arr.push(p);
    sortedByPos.set(p.position, arr);
  }
  for (const arr of sortedByPos.values()) arr.sort((a, b) => b.value - a.value);

  const usedIds = new Set<string>();
  const slotOrder = [...plan.slots].sort((a, b) => a.length - b.length);

  for (const slot of slotOrder) {
    let chosen: RankedPlayer | null = null;
    for (const allowed of slot) {
      const list = sortedByPos.get(allowed);
      if (!list) continue;
      for (const p of list) {
        if (usedIds.has(p.player_id)) continue;
        if (!chosen || p.value > chosen.value) chosen = p;
        break;
      }
    }
    if (chosen) usedIds.add(chosen.player_id);
  }

  let starterValue = 0;
  let benchValue = 0;
  const breakdowns: Record<
    string,
    { value: number; rank: null; players: Array<{ player_id: string; value: number; slot: "starter" | "bench" }> }
  > = {};

  for (const pos of VALUED_POSITIONS) {
    breakdowns[pos] = { value: 0, rank: null, players: [] };
  }

  for (const p of players) {
    const slot: "starter" | "bench" = usedIds.has(p.player_id) ? "starter" : "bench";
    if (slot === "starter") starterValue += p.value;
    else benchValue += p.value;
    const bucket = breakdowns[p.position];
    if (bucket) {
      bucket.value += p.value;
      bucket.players.push({ player_id: p.player_id, value: p.value, slot });
    }
  }
  for (const pos of Object.keys(breakdowns)) {
    breakdowns[pos].value = round2(breakdowns[pos].value);
    breakdowns[pos].players.sort((a, b) => b.value - a.value);
  }

  return { starterValue, benchValue, breakdowns };
}

function sumPickValues(picks: unknown[], lookup: PickValueLookup): number {
  let total = 0;
  for (const pick of picks) {
    if (!pick || typeof pick !== "object") continue;
    const p = pick as Record<string, unknown>;
    const season = typeof p.season === "number" ? p.season : null;
    const round = typeof p.round === "number" ? p.round : null;
    if (season === null || round === null) continue;
    // The Phase 1 sync writes pick_position later via the calc; pick assets
    // don't yet carry a slot. Default to "mid" which is the most common
    // bucket KTC publishes. Phase 3 may refine this using original-owner
    // standings.
    const pickPos = typeof p.pick_position === "string" ? (p.pick_position as string) : "mid";
    const key = `${season}|${round}|${pickPos}`;
    const value = lookup.values.get(key);
    if (typeof value === "number") total += value;
  }
  return total;
}

function describePick(pick: unknown): Record<string, unknown> {
  if (!pick || typeof pick !== "object") return {};
  return pick as Record<string, unknown>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
