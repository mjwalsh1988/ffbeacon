/**
 * Read layer for Positional WAR surfaces.
 *
 * Positional WAR is player-independent and reads no roster (see
 * lib/positional-war/types.ts). This module is the READ side only: it shapes
 * league_positional_war_cache into what the chart panel and the rail summary
 * render, and it resolves whose team a viewer is looking at so the chart can
 * mark their players. It never computes a curve and never writes to any
 * table. The writer lives at lib/league-positional-war.ts, owned separately,
 * and is not imported here.
 *
 * loadPositionalWarView, loadViewerCandidates, loadViewerOverlay and
 * resolveUnmatchedOwnerInfo are all wrapped in React cache() so the rail
 * summary card and the chart panel, both of which call all four on the same
 * render, share ONE query per function instead of racing to make two. This
 * mirrors getPulseData in app/leagues/[league_id]/power-pulse/page.tsx.
 *
 * React's cache() keys strictly on argument identity (===, not deep
 * equality). The dedup above only works because both call sites are already
 * handed the SAME supabase client reference, threaded down from the page
 * that mounted them. Constructing a fresh client inside either component (or
 * inside a helper one of them calls) would give each call a distinct cache
 * key and silently turn every shared read back into two.
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
import type { PlottableCurve, PulsePosition, WarCurvePoint } from "@/lib/positional-war/types";
import type { ViewerCandidate } from "@/lib/league-viewer";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Mirrors POSITIONAL_WAR_TTL_MS on lib/league-positional-war.ts (the writer,
 * owned separately). Duplicated rather than imported: this module must never
 * import the writer, and the reader only needs the number to decide whether a
 * cached row reads as stale, never to decide whether to recompute.
 */
const POSITIONAL_WAR_TTL_MS = 12 * 60 * 60 * 1000;

export type PositionalWarStatus = "pending" | "ok" | "skipped" | "settled" | "error";

/**
 * A curve as the READ path carries it. This is `PlottableCurve`: every field
 * of the stored `PositionCurve` except `weeklyDiagnostics`.
 *
 * That field is the engine's per-week working (seated counts, replacement,
 * muRef, sigmaRef) and nothing on any surface renders it. It is about 6.5kB of
 * jsonb per league, so selecting it meant fetching, transferring and parsing it
 * on every league page view in order to throw it away. Left out of the TYPE
 * rather than filled with an empty array, because an empty array would say the
 * engine produced no diagnostics and it produced one per week. They are still
 * written and still stored; only the read path declines to fetch them.
 */
export type WarViewCurve = PlottableCurve;

export type WarView = {
  /** Decoded from the jsonb, sorted by PULSE_POSITIONS order (QB, RB, WR, TE, K, DEF). */
  curves: WarViewCurve[];
  generatedAt: string | null;
  modelVersion: string | null;
  fromWeek: number | null;
  throughWeek: number | null;
  status: PositionalWarStatus | null;
  /** generated_at older than the TTL AND the last attempt did not succeed. */
  isStale: boolean;
  shallowPositions: PulsePosition[];
};

export type ViewerOverlay = {
  sleeperRosterId: number;
  ownedSleeperIds: Set<string>;
};

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function decodeCurvePoints(json: Json): WarCurvePoint[] {
  if (!Array.isArray(json)) return [];
  return json as unknown as WarCurvePoint[];
}

function isPulsePosition(value: string): value is PulsePosition {
  return (PULSE_POSITIONS as string[]).includes(value);
}

type WarCacheRow = Database["public"]["Tables"]["league_positional_war_cache"]["Row"];

/** The columns the read path uses. See WarViewCurve for what is left out. */
const CURVE_COLUMNS =
  "position, structural_demand, replacement_points, avg_seated_points, deficit, shallow_pool, war_rank_1, war_at_demand, cliff_rank, curve, generated_at, model_version, from_week, through_week";

type WarCacheReadRow = Pick<
  WarCacheRow,
  | "position"
  | "structural_demand"
  | "replacement_points"
  | "avg_seated_points"
  | "deficit"
  | "shallow_pool"
  | "war_rank_1"
  | "war_at_demand"
  | "cliff_rank"
  | "curve"
  | "generated_at"
  | "model_version"
  | "from_week"
  | "through_week"
>;

function decodeCurve(row: WarCacheReadRow): WarViewCurve | null {
  if (!isPulsePosition(row.position)) return null;
  return {
    position: row.position,
    structuralDemand: Number(row.structural_demand),
    replacementPoints: numOrNull(row.replacement_points),
    avgSeatedPoints: numOrNull(row.avg_seated_points),
    deficit: numOrNull(row.deficit),
    shallowPool: Boolean(row.shallow_pool),
    warRank1: numOrNull(row.war_rank_1),
    warAtDemand: numOrNull(row.war_at_demand),
    cliffRank: row.cliff_rank === null ? null : Number(row.cliff_rank),
    curve: decodeCurvePoints(row.curve),
  };
}

function isRecognizedStatus(value: string | null): value is PositionalWarStatus {
  return value === "pending" || value === "ok" || value === "skipped" || value === "settled" || value === "error";
}

/**
 * The status columns alone, for the panel's empty state when
 * loadPositionalWarView returned null (no cached rows exist at all).
 * Deliberately a separate, tiny query rather than folded into
 * loadPositionalWarView's null branch, because that function's contract is
 * "null means nothing to render", and the empty-state copy is the panel's own
 * concern, read only on the empty-state path rather than on every render.
 */
export async function loadPositionalWarStatus(
  supabase: AnySupabase,
  leagueRowId: string,
): Promise<{ status: PositionalWarStatus | null; detail: string | null }> {
  const { data } = await supabase
    .from("leagues")
    .select("positional_war_status, positional_war_detail")
    .eq("id", leagueRowId)
    .maybeSingle();
  const rawStatus = data?.positional_war_status ?? null;
  return {
    status: isRecognizedStatus(rawStatus) ? rawStatus : null,
    detail: data?.positional_war_detail ?? null,
  };
}

/**
 * Loads every cached position curve for one league season, plus the
 * league-level status columns that decide whether the result reads as
 * current or stale. Returns null when there are no cached rows, so the panel
 * can render its status-aware empty state instead of an empty chart.
 *
 * Wrapped in React cache(): the rail summary card and the chart panel both
 * call this on the same render and get one shared query (acceptance
 * criterion E6-1), not two racing to populate the same cache row.
 */
export const loadPositionalWarView = cache(async function loadPositionalWarView(
  supabase: AnySupabase,
  leagueRowId: string,
  season: number,
): Promise<WarView | null> {
  const [cacheRes, leagueRes] = await Promise.all([
    supabase
      .from("league_positional_war_cache")
      .select(CURVE_COLUMNS)
      .eq("league_id", leagueRowId)
      .eq("season", season),
    supabase
      .from("leagues")
      .select(
        "positional_war_status, positional_war_detail, positional_war_attempted_at, positional_war_succeeded_at",
      )
      .eq("id", leagueRowId)
      .maybeSingle(),
  ]);

  const rows = (cacheRes.data ?? []) as unknown as WarCacheReadRow[];
  if (rows.length === 0) return null;

  const curves = rows
    .map(decodeCurve)
    .filter((c): c is WarViewCurve => c !== null)
    .sort((a, b) => PULSE_POSITIONS.indexOf(a.position) - PULSE_POSITIONS.indexOf(b.position));

  const first = rows[0];
  const generatedAt = first.generated_at ?? null;

  const rawStatus = leagueRes.data?.positional_war_status ?? null;
  const status = isRecognizedStatus(rawStatus) ? rawStatus : null;

  const staleAge = generatedAt ? Date.now() - new Date(generatedAt).getTime() : null;
  const isStale = staleAge !== null && staleAge > POSITIONAL_WAR_TTL_MS && status !== "ok";

  return {
    curves,
    generatedAt,
    modelVersion: first.model_version ?? null,
    fromWeek: first.from_week ?? null,
    throughWeek: first.through_week ?? null,
    status,
    isStale,
    shallowPositions: curves.filter((c) => c.shallowPool).map((c) => c.position),
  };
});

/** Sleeper writes "0" into an empty roster slot. It is not a player. */
function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * The viewer's whole roster, for the curve overlay (E1a). Deliberately reads
 * player_ids, reserve_ids, AND taxi_ids and unions them: a player on IR or
 * the taxi squad still gets a real rank on a player-independent curve, and a
 * reader who owns an injured RB1 wants to see exactly that, not have him
 * filtered out.
 *
 * Returns null when the roster row does not exist, so the caller can render
 * with no overlay rather than an empty one.
 *
 * Wrapped in cache() for the same reason loadPositionalWarView is: both the
 * chart panel and the rail summary resolve the same viewer roster on the
 * same render.
 */
export const loadViewerOverlay = cache(async function loadViewerOverlay(
  supabase: AnySupabase,
  leagueRowId: string,
  sleeperRosterId: number,
): Promise<ViewerOverlay | null> {
  const { data, error } = await supabase
    .from("rosters")
    .select("player_ids, reserve_ids, taxi_ids")
    .eq("league_id", leagueRowId)
    .eq("sleeper_roster_id", sleeperRosterId)
    .maybeSingle();
  if (error || !data) return null;

  const owned = new Set<string>();
  for (const id of asStringArray(data.player_ids)) if (validPlayerId(id)) owned.add(id);
  for (const id of asStringArray(data.reserve_ids)) if (validPlayerId(id)) owned.add(id);
  for (const id of asStringArray(data.taxi_ids)) if (validPlayerId(id)) owned.add(id);

  return { sleeperRosterId, ownedSleeperIds: owned };
});

/**
 * The candidate list matchViewerRoster() needs: every team's Sleeper roster
 * id and owner username. Deliberately light (two small selects, no values, no
 * picks) because the panel and the rail card only need enough to resolve
 * whose team it is, unlike the full team-card load the Overview and Teams
 * tabs use.
 *
 * Wrapped in cache() for the same reason loadPositionalWarView is: both the
 * chart panel and the rail summary call this on the same render.
 */
export const loadViewerCandidates = cache(async function loadViewerCandidates(
  supabase: AnySupabase,
  leagueRowId: string,
): Promise<ViewerCandidate[]> {
  const [rostersRes, usersRes] = await Promise.all([
    supabase
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", leagueRowId),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name")
      .eq("league_id", leagueRowId),
  ]);

  const usernameByUserId = new Map(
    (usersRes.data ?? []).map((u) => [u.sleeper_user_id, u.display_name as string | null]),
  );

  return (rostersRes.data ?? []).map((r) => ({
    sleeperRosterId: r.sleeper_roster_id,
    ownerSleeperUsername: r.owner_user_id ? (usernameByUserId.get(r.owner_user_id) ?? null) : null,
  }));
});

export type UnmatchedOwnerInfo = { name: string; position: string | null };

/**
 * Resolves name and position for a small set of owned Sleeper ids that
 * matched no curve entry, so the panel can decide (in
 * components/league-war/overlay.ts) whether each one is a rostered player who
 * simply ranks past the chart's display depth (named in the trailing line) or
 * a player with no projection at all (counted only). Typically 0-3 ids per
 * roster, so one small query rather than the chunked pattern the full
 * universe read uses.
 *
 * Wrapped in cache() for the same reason loadPositionalWarView is: the chart
 * panel and the rail summary can both resolve the same unmatched owner set
 * on the same render.
 */
export const resolveUnmatchedOwnerInfo = cache(async function resolveUnmatchedOwnerInfo(
  supabase: AnySupabase,
  sleeperIds: string[],
): Promise<Map<string, UnmatchedOwnerInfo>> {
  const map = new Map<string, UnmatchedOwnerInfo>();
  if (sleeperIds.length === 0) return map;

  // PostgREST's .or() takes a comma-separated filter STRING, so an id carrying
  // a comma or a parenthesis would rewrite the filter rather than be matched by
  // it. Real Sleeper ids are numeric strings for players and team codes like
  // "BUF" for defenses, so anything outside that alphabet is dropped before it
  // reaches the query. Same guard, and the same reasoning, as
  // lib/power-pulse/load.ts loadPlayers, which is the other place in this
  // codebase that builds an .or() this way.
  //
  // These ids reach here from rosters.player_ids, written by the Sleeper sync
  // under a service-role client, so today nothing request-controlled gets this
  // far. The guard is here anyway because this is an exported function with no
  // input-shape contract in its own signature, and the next caller may not be
  // this careful about where its ids came from.
  const safeIds = sleeperIds.filter((id) => /^[A-Za-z0-9]{1,32}$/.test(id));
  if (safeIds.length === 0) return map;

  const ors = safeIds.map((id) => `external_ids->>sleeper.eq.${id}`).join(",");
  const { data, error } = await supabase
    .from("players")
    .select("full_name, first_name, last_name, position, external_ids")
    .or(ors);
  if (error || !data) return map;

  for (const p of data) {
    const ext = (p.external_ids as Record<string, unknown>) ?? {};
    const sid = typeof ext.sleeper === "string" ? ext.sleeper : null;
    if (!sid || !sleeperIds.includes(sid)) continue;
    const name = p.full_name || `${p.first_name} ${p.last_name}`.trim();
    map.set(sid, { name, position: p.position ?? null });
  }
  return map;
});
