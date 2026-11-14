import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { resolveSleeperPlayers } from "@/lib/sleeper-player-lookup";
import { loadLatestPickSnapshot } from "@/lib/draft-pick-snapshot";
import { mapWithConcurrency } from "@/lib/supabase/fetch-all";
import { categorizeLeague } from "@/lib/league-category";
import {
  buildPickPositionResolver,
  isPickSeasonSpent,
  NO_PICK_POSITIONS,
  positionFromDraftSlot,
  type PickPositionResolver,
} from "@/lib/league-pick-position";
import type { PickPosition } from "@/lib/signal-check/types";
import type { SleeperLeague } from "@/lib/sleeper";

type ServiceClient = SupabaseClient<Database>;

/** Combos whose pick snapshot is read at once. */
const PICK_SNAPSHOT_CONCURRENCY = 6;

/**
 * The version of the ranking math, stamped into every row at
 * positional_breakdowns.PICKS.model_version. lib/league-pulse.ts treats a row
 * carrying any other version as stale and rebuilds it on the next view, so a
 * change to how rosters or picks are priced reaches every stored ranking
 * without a backfill. Bump it whenever the math changes.
 *
 * 2: spent seasons dropped, picks priced by slot or projected finish (else the
 * round's blend, never a blanket mid), FantasyCalc and DynastyProcess picks
 * priced from the pick source, no pick value in redraft, keeper or chopped
 * leagues, stable rank tiebreak.
 */
export const POWER_RANKINGS_MODEL_VERSION = "2";

const EMPTY_PICK_LOOKUP: PickValueLookup = { values: new Map<string, number>() };

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

export type PickValueLookup = {
  // key: `${season}|${round}|${pick_position}`
  values: Map<string, number>;
};

export type Combo = {
  format_config_id: string;
  source: string;
  /** The source whose draft_pick_values price this combo's picks; null when no
   * active source publishes pick values. */
  pickSource: string | null;
};

/**
 * Calculate power rankings for a single league across every available
 * (format, source) combo and upsert into league_power_rankings_cache.
 * Idempotent, re-running replaces the rows for that league.
 *
 * Why iterate all combos: users toggle format/source on the deep view and
 * the cache row for the displayed combo must exist. Combos with no value
 * data (e.g. FantasyCalc + Redraft TEP) are silently skipped.
 *
 * The values and pick prices for every combo are loaded in one pass up front
 * rather than per combo. There are two dozen active combos and the loop used to
 * spend three database round trips on each of them, roughly seventy sequential
 * queries in front of a page render, to produce data that all comes from two
 * tables. The math per combo is unchanged.
 */
export async function calculateLeaguePowerRankings(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<PowerRankingsResult> {
  const { data: league, error: leagueErr } = await supabase
    .from("leagues")
    .select("id, roster_positions, format_config_id, season, status, total_rosters, metadata")
    .eq("id", leagueRowId)
    .maybeSingle();
  if (leagueErr) return { ok: false, error: leagueErr.message };
  if (!league) return { ok: false, error: "league row not found" };

  const { data: rosters, error: rosterErr } = await supabase
    .from("rosters")
    .select("id, sleeper_roster_id, player_ids, starter_ids, draft_pick_assets")
    .eq("league_id", leagueRowId)
    .order("sleeper_roster_id", { ascending: true });
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
  let combos: Combo[];
  try {
    combos = await loadActiveCombos(supabase);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const startingSlots = parseStartingSlots(asStringArray(league.roster_positions));

  // Only a league that keeps players year to year trades in draft capital worth
  // pricing. Redraft, keeper and chopped rooms carry no pick value at all.
  const carriesPicks = leagueCarriesPickValue(league.metadata);
  const leagueGate = { season: league.season, status: league.status };
  const teamCount =
    typeof league.total_rosters === "number" && league.total_rosters > 0
      ? league.total_rosters
      : rosters.length;
  const anyPicks =
    carriesPicks &&
    rosters.some((r) =>
      asUnknownArray(r.draft_pick_assets).some((p) => !isPickSeasonSpent(pickSeasonOf(p), leagueGate)),
    );

  // Values and pick prices for every combo, in two passes instead of two per
  // combo. Values are scoped to the players actually on these rosters, which is
  // both smaller and the only part any of this reads. The pick ordering (real
  // slots, else projected standings) is read once and only when there are
  // picks to place; it throws on a failed read so a roster is never cached
  // priced on the blend because of a hiccup.
  let valuesByCombo: Map<string, ValueMap>;
  let picksByCombo: Map<string, PickValueLookup>;
  let positions: PickPositionResolver;
  try {
    [valuesByCombo, picksByCombo, positions] = await Promise.all([
      loadPlayerValueMaps(
        supabase,
        Array.from(new Set([...players.values()].map((p) => p.player_id))),
      ),
      anyPicks ? loadPickLookups(supabase, combos) : Promise.resolve(new Map<string, PickValueLookup>()),
      anyPicks
        ? buildPickPositionResolver(supabase, leagueRowId, { throwOnError: true })
        : Promise.resolve(NO_PICK_POSITIONS),
    ]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const upsertRows: Database["public"]["Tables"]["league_power_rankings_cache"]["Insert"][] = [];
  const generatedAt = new Date().toISOString();

  let combosWritten = 0;
  for (const combo of combos) {
    const key = comboKey(combo);
    // No values for anyone on these rosters. Writing the combo anyway would
    // cache a table of zeroes that reads like a real ranking.
    const valueMap = valuesByCombo.get(key);
    if (!valueMap || valueMap.size === 0) continue;

    const pickLookup =
      (combo.pickSource ? picksByCombo.get(pickKey(combo.format_config_id, combo.pickSource)) : null) ??
      EMPTY_PICK_LOOKUP;

    type RosterCalc = {
      rosterRowId: string;
      sleeperRosterId: number;
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

      const picks = carriesPicks
        ? asUnknownArray(roster.draft_pick_assets).filter(
            (p) => !isPickSeasonSpent(pickSeasonOf(p), leagueGate),
          )
        : [];
      const pricedPicks = picks.map((p) =>
        priceDraftPick(p, pickLookup, { teamCount, positions }),
      );
      const picksValue = pricedPicks.reduce((sum, p) => sum + (p.value ?? 0), 0);

      const total = starterValue + benchValue + picksValue;

      calcs.push({
        rosterRowId: roster.id,
        sleeperRosterId: roster.sleeper_roster_id,
        starter_value: round2(starterValue),
        bench_value: round2(benchValue),
        picks_value: round2(picksValue),
        total_value: round2(total),
        positional_breakdowns: {
          ...breakdowns,
          PICKS: {
            value: round2(picksValue),
            source: combo.pickSource,
            model_version: POWER_RANKINGS_MODEL_VERSION,
            picks: picks.map((p, i) => ({
              ...describePick(p),
              priced_position: pricedPicks[i].position,
              priced_basis: pricedPicks[i].basis,
              value: pricedPicks[i].value === null ? null : round2(pricedPicks[i].value as number),
            })),
          },
        } as unknown as Json,
      });
    }

    // Rank by total_value desc, then starter_value desc, then the Sleeper
    // roster id, so two identical rosters always rank the same way round.
    const byOverall = [...calcs].sort(
      (a, b) =>
        b.total_value - a.total_value ||
        b.starter_value - a.starter_value ||
        a.sleeperRosterId - b.sleeperRosterId,
    );
    const overallRankByRoster = new Map<string, number>();
    byOverall.forEach((c, i) => overallRankByRoster.set(c.rosterRowId, i + 1));

    const byStarter = [...calcs].sort(
      (a, b) =>
        b.starter_value - a.starter_value ||
        b.total_value - a.total_value ||
        a.sleeperRosterId - b.sleeperRosterId,
    );
    const starterRankByRoster = new Map<string, number>();
    byStarter.forEach((c, i) => starterRankByRoster.set(c.rosterRowId, i + 1));

    for (const c of calcs) {
      upsertRows.push({
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
      });
    }
    combosWritten++;
  }

  const CHUNK = 500;
  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    const { error: upsertErr } = await supabase
      .from("league_power_rankings_cache")
      .upsert(upsertRows.slice(i, i + CHUNK), {
        onConflict: "league_id,roster_id,format_config_id,source",
      });
    if (upsertErr) {
      return { ok: false, error: `power rankings upsert failed: ${upsertErr.message}` };
    }
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

/**
 * A thin adapter over `resolveSleeperPlayers`.
 *
 * This was its own copy of the lookup, and the copy put the indexed
 * `external_ids->>sleeper` predicate and an unindexable `slug.like.*-<id>` in
 * the same `or()`, which makes the whole filter unindexable and scans
 * `players` end to end (site-speed-audit-and-plan.md, 4.1). The helper runs the
 * indexed pass first and the slug-tail pass only for what is left.
 */
async function resolvePlayers(
  supabase: ServiceClient,
  sleeperIds: string[],
): Promise<Map<string, PlayerLite>> {
  const map = new Map<string, PlayerLite>();
  if (sleeperIds.length === 0) return map;

  // throwOnError, because this result is written to a cache. A silently short
  // lookup here stores a roster priced as though half of it did not exist.
  const lookup = await resolveSleeperPlayers(supabase, sleeperIds, {
    throwOnError: true,
  });
  for (const [sid, p] of Object.entries(lookup)) {
    map.set(sid, { player_id: p.id, sleeper_id: sid, position: p.position });
  }
  return map;
}

/**
 * Every active (format, source) pair, each carrying the source its pick prices
 * come from. Throws on a failed read: an empty registry from a failed read would
 * write nothing and report success.
 */
async function loadActiveCombos(supabase: ServiceClient): Promise<Combo[]> {
  const [sourcesRes, formatsRes] = await Promise.all([
    supabase
      .from("source_registry")
      .select("slug, supported_format_slugs, data_type, priority")
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .order("slug", { ascending: true }),
    supabase.from("format_configs").select("id, slug").eq("is_active", true),
  ]);
  if (sourcesRes.error) throw new Error(`source_registry read failed: ${sourcesRes.error.message}`);
  if (formatsRes.error) throw new Error(`format_configs read failed: ${formatsRes.error.message}`);
  return buildCombos(sourcesRes.data ?? [], formatsRes.data ?? []);
}

/**
 * Pure half of loadActiveCombos, exported for its test.
 *
 * Pick prices follow the league view's own rule (lib/league-format-resolution.ts
 * pickSourceForDraftPicks): a source that publishes pick values prices its own
 * picks; one that does not (FantasyCalc, DynastyProcess) borrows the
 * highest-priority source that does. Before this every FantasyCalc and
 * DynastyProcess row carried a pick value of zero, because their own pick
 * snapshot does not exist.
 *
 * `sources` must arrive in priority order.
 */
export function buildCombos(
  sources: Array<{ slug: string; supported_format_slugs: string[] | null; data_type: string[] | null }>,
  formats: Array<{ id: string; slug: string }>,
): Combo[] {
  const publishesPicks = (s: { data_type: string[] | null }) =>
    (s.data_type ?? []).includes("draft_pick_values");
  const fallbackPickSource = sources.find(publishesPicks)?.slug ?? null;

  const combos: Combo[] = [];
  for (const source of sources) {
    const supported = source.supported_format_slugs;
    const pickSource = publishesPicks(source) ? source.slug : fallbackPickSource;
    for (const format of formats) {
      const supports = supported === null || supported.includes(format.slug);
      if (!supports) continue;
      combos.push({ format_config_id: format.id, source: source.slug, pickSource });
    }
  }
  return combos;
}

function comboKey(combo: Combo): string {
  return `${combo.format_config_id}|${combo.source}`;
}

function pickKey(formatConfigId: string, pickSource: string): string {
  return `${formatConfigId}|${pickSource}`;
}

/**
 * Current value for every (format, source) at once, restricted to the players
 * on this league's rosters. Returns one map per combo.
 *
 * Scoping to the league's own players is what makes a single pass affordable:
 * the whole trends table across every combo is far larger than the few hundred
 * players any one league can roster.
 *
 * Paging is keyset on the primary key, not offset. A few hundred rostered
 * players carry a few thousand trend rows across two dozen combos, so this
 * always spans several pages, and an offset page walk over an unsorted query
 * is not stable: Postgres is free to return a different row order per request,
 * which silently skips some rows and repeats others. A skipped row reads as a
 * player worth zero, which is indistinguishable from a real zero by the time
 * it reaches the ranking. That is how Bijan Robinson once counted for nothing
 * in a league that rostered him. `id` is unique, so ordering by it makes the
 * page boundaries exact.
 */
export async function loadPlayerValueMaps(
  supabase: ServiceClient,
  playerIds: string[],
): Promise<Map<string, ValueMap>> {
  const out = new Map<string, ValueMap>();
  if (playerIds.length === 0) return out;

  const PAGE = 1000;
  const CHUNK = 200;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);

    // What the table says this chunk holds, so a short read is caught rather
    // than quietly ranking the missing players at zero.
    const { count: expected, error: countErr } = await supabase
      .from("player_value_trends")
      .select("id", { count: "exact", head: true })
      .in("player_id", chunk);
    if (countErr) throw new Error(`count player_value_trends failed: ${countErr.message}`);

    let loaded = 0;
    let cursor: string | null = null;
    for (;;) {
      let q = supabase
        .from("player_value_trends")
        .select("id, player_id, current_value, format_config_id, source")
        .in("player_id", chunk)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (cursor !== null) q = q.gt("id", cursor);
      const { data, error } = await q;
      if (error) throw new Error(`load player_value_trends failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) {
        if (!row.format_config_id || !row.source) continue;
        const key = `${row.format_config_id}|${row.source}`;
        const map = out.get(key) ?? new Map<string, number>();
        map.set(row.player_id, Number(row.current_value));
        out.set(key, map);
      }
      loaded += data.length;
      cursor = data[data.length - 1].id;
      if (data.length < PAGE) break;
    }

    if (expected != null && loaded < expected) {
      throw new Error(
        `load player_value_trends incomplete: read ${loaded} of ${expected} rows for ${chunk.length} players`,
      );
    }
  }
  return out;
}

/**
 * Pick prices for every combo: the newest capture of each (format, source),
 * read whole. See lib/draft-pick-snapshot.ts for why the newest capture is the
 * full current price list.
 *
 * This used to page through every capture ever taken for every combo (about
 * 35,000 rows) and keep the newest row per slot in memory. Two small reads per
 * combo replace it, a few combos at a time.
 */
async function loadPickLookups(
  supabase: ServiceClient,
  combos: Combo[],
): Promise<Map<string, PickValueLookup>> {
  const out = new Map<string, PickValueLookup>();
  if (combos.length === 0) return out;

  // One read per distinct (format, pick source). Several player-value sources
  // share one pick source, so this is fewer reads than combos.
  const unique = new Map<string, { format_config_id: string; pickSource: string }>();
  for (const c of combos) {
    if (!c.pickSource) continue;
    unique.set(pickKey(c.format_config_id, c.pickSource), {
      format_config_id: c.format_config_id,
      pickSource: c.pickSource,
    });
  }
  const targets = Array.from(unique.values());

  const snapshots = await mapWithConcurrency(targets, PICK_SNAPSHOT_CONCURRENCY, (t) =>
    loadLatestPickSnapshot(supabase, t.format_config_id, t.pickSource),
  );

  targets.forEach((t, i) => {
    const rows = snapshots[i].rows;
    if (rows.length === 0) return;
    const lookup: PickValueLookup = { values: new Map<string, number>() };
    for (const row of rows) {
      lookup.values.set(`${row.season}|${row.round}|${row.pick_position}`, row.value);
    }
    out.set(pickKey(t.format_config_id, t.pickSource), lookup);
  });
  return out;
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

/**
 * True when the league's kind trades in draft capital worth pricing: dynasty and
 * best ball dynasty. Redraft, keeper and chopped (guillotine) rooms get no pick
 * value, so a stray pick row Sleeper keeps on one of their rosters never moves a
 * ranking. The kind comes from lib/league-category.ts off the stored Sleeper
 * league object, the same classification every league list uses.
 */
export function leagueCarriesPickValue(metadata: Json | null | undefined): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const kind = categorizeLeague(metadata as unknown as SleeperLeague);
  return kind === "dynasty" || kind === "best-ball-dynasty";
}

function pickSeasonOf(pick: unknown): number | string | null {
  if (!pick || typeof pick !== "object") return null;
  const season = (pick as Record<string, unknown>).season;
  return typeof season === "number" || typeof season === "string" ? season : null;
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

const PICK_POSITIONS: readonly PickPosition[] = ["early", "mid", "late"];

export type PricedPick = {
  /** Null when no price exists for this season and round at all. */
  value: number | null;
  /** The bucket the price came from; null when it is the round's blend. */
  position: PickPosition | null;
  /**
   * slot: the pick's real draft slot. projected: the original team's projected
   * finish (lib/league-pick-position.ts). blend: neither was known, so the
   * average of the round's early, mid and late prices.
   */
  basis: "slot" | "projected" | "blend" | null;
};

/**
 * Price one pick against a snapshot of pick values.
 *
 * Best evidence first:
 *   1. The real slot the pick carries (the sync writes it once the draft order
 *      is published), bucketed early, mid or late by lib/league-pick-position.ts.
 *   2. An early, mid or late bucket already on the row.
 *   3. The resolver: the season's published draft order, else the original
 *      team's projected finish.
 *   4. Otherwise the average of the round's published buckets. Never a blanket
 *      "mid": that silently priced every unknown pick as a middle pick.
 *
 * A pick whose bucket is missing from the snapshot also falls to the blend, so a
 * source that publishes only some buckets still prices the pick.
 */
export function priceDraftPick(
  pick: unknown,
  lookup: PickValueLookup,
  ctx: { teamCount: number; positions: PickPositionResolver },
): PricedPick {
  const none: PricedPick = { value: null, position: null, basis: null };
  if (!pick || typeof pick !== "object") return none;
  const p = pick as Record<string, unknown>;
  const season = toInteger(p.season);
  const round = toInteger(p.round);
  if (season === null || round === null) return none;

  let position: PickPosition | null = null;
  let basis: PricedPick["basis"] = null;

  const slot = toInteger(p.slot);
  if (slot !== null) {
    position = positionFromDraftSlot(slot, ctx.teamCount);
    if (position) basis = "slot";
  }
  if (!position && typeof p.pick_position === "string") {
    const stored = p.pick_position as PickPosition;
    if (PICK_POSITIONS.includes(stored)) {
      position = stored;
      basis = "slot";
    }
  }
  if (!position) {
    const original = toInteger(p.original_roster_id);
    const resolved = original !== null ? ctx.positions.resolve(original, season) : null;
    if (resolved) {
      position = resolved.position;
      basis = resolved.estimated ? "projected" : "slot";
    }
  }

  if (position) {
    const value = lookup.values.get(`${season}|${round}|${position}`);
    if (typeof value === "number") return { value, position, basis };
  }

  const bucketValues = PICK_POSITIONS.map((pos) => lookup.values.get(`${season}|${round}|${pos}`)).filter(
    (v): v is number => typeof v === "number",
  );
  if (bucketValues.length === 0) return none;
  const blend = bucketValues.reduce((a, b) => a + b, 0) / bucketValues.length;
  return { value: blend, position: null, basis: "blend" };
}

function describePick(pick: unknown): Record<string, unknown> {
  if (!pick || typeof pick !== "object") return {};
  return pick as Record<string, unknown>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
