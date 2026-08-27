/**
 * Cross-league Positional WAR compute sharing (E4).
 *
 * Section 6 of docs/league-pulse-positional-war-plan.md establishes that a
 * curve is a pure function of the fingerprint's inputs: no roster, no
 * ownership, nothing league-specific except its settings. Two leagues whose
 * fingerprints match therefore produce byte-identical curves, so the second
 * one can copy six rows out of positional_war_curves instead of reading the
 * whole projectable universe and running W + 1 optimal fills.
 *
 * This module owns the write path only:
 *
 *   hit  in positional_war_curves for this fingerprint?
 *     -> validate inputs_digest against THIS league's own values
 *          -> match:    copy the rows into league_positional_war_cache,
 *                       done. No universe read for this league at all.
 *          -> mismatch: log the collision, delete the colliding rows, fall
 *                       through to a fresh computation as if it were a miss
 *   miss -> run `compute()` (the caller's universe read + engine run)
 *        -> upsert positional_war_curves
 *        -> write league_positional_war_cache
 *
 * league_positional_war_cache keeps its own fingerprint column and its full
 * curve rows, so NO CONSUMER CHANGES: every read path still issues exactly
 * one query against the per-league table (E4-3). This module is reached only
 * from lib/league-positional-war.ts, on the write path.
 *
 * `compute` is a caller-supplied callback rather than something this module
 * knows how to do itself, so the expensive universe read only ever runs when
 * this module has already decided it is actually needed (a miss, or a
 * collision fallthrough) and never on a hit.
 *
 * Concurrency: two leagues rendering with the same fresh fingerprint both
 * compute and both upsert into positional_war_curves. `on conflict do update`
 * makes the second a harmless overwrite of identical data, because the model
 * is deterministic (no RNG, see lib/positional-war/engine.ts). NO LOCK, no
 * coalescing: the work is bounded (one league render) and a lock is a new
 * failure mode for a race that costs nothing to lose. This module keeps no
 * module-level mutable state for exactly that reason: two concurrent calls
 * for two different leagues must never share so much as a variable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { PositionCurve } from "@/lib/positional-war/types";
import { digestsMatch, type WarInputsDigest } from "@/lib/positional-war/fingerprint";

type ServiceClient = SupabaseClient<Database>;

type SharedCurveRow = Database["public"]["Tables"]["positional_war_curves"]["Row"];

export type ResolveSharedCurvesParams = {
  leagueRowId: string;
  season: number;
  fingerprint: string;
  digest: WarInputsDigest;
  fromWeek: number;
  toWeek: number;
  modelVersion: string;
  /**
   * The expensive half: the universe read, the W + 1 merged fills, and the
   * win conversion. Invoked at most once, and only on a miss or a collision
   * fallthrough. Returning an empty array means the caller has nothing worth
   * caching (e.g. no projectable players); this module writes nothing to
   * either table in that case.
   */
  compute: () => Promise<PositionCurve[]>;
};

export type ResolveSharedCurvesResult =
  | { ok: true; curves: PositionCurve[]; shared: boolean; collision: boolean }
  | { ok: false; error: string };

/** Every column this module reads or writes on positional_war_curves. */
const SHARED_COLUMNS =
  "position, structural_demand, replacement_points, avg_seated_points, deficit, shallow_pool, war_rank_1, war_at_demand, cliff_rank, curve, weekly_diagnostics, from_week, through_week, model_version, inputs_digest";

export async function resolveSharedCurves(
  supabase: ServiceClient,
  params: ResolveSharedCurvesParams,
): Promise<ResolveSharedCurvesResult> {
  const { leagueRowId, season, fingerprint, digest, fromWeek, toWeek, modelVersion, compute } = params;

  const { data: existing, error: readErr } = await supabase
    .from("positional_war_curves")
    .select(SHARED_COLUMNS)
    .eq("fingerprint", fingerprint);
  if (readErr) {
    return { ok: false, error: `positional war curves read failed: ${readErr.message}` };
  }

  let collision = false;

  if (existing && existing.length > 0) {
    const storedDigest = existing[0].inputs_digest as unknown as WarInputsDigest;
    const cmp = digestsMatch(digest, storedDigest);
    if (cmp.ok) {
      const curves = rowsToCurves(existing as unknown as SharedCurveRow[]);
      // fromWeek/toWeek/modelVersion are the REQUESTING league's own values,
      // not read back off the stored rows: a fingerprint match guarantees
      // they are identical (both are hashed inputs), and the stored rows
      // carry them too, but passing the caller's own values keeps this call
      // symmetric with the miss-path write below.
      const write = await writeLeagueCache(
        supabase,
        leagueRowId,
        season,
        fingerprint,
        curves,
        fromWeek,
        toWeek,
        modelVersion,
      );
      if (!write.ok) return { ok: false, error: write.error };
      return { ok: true, curves, shared: true, collision: false };
    }

    // A fingerprint collision: two leagues hashed to the same key with
    // different real inputs. The maths was never the risk here, a
    // normalization bug silently serving league A's curve to league B is.
    console.error(
      `[positional-war] fingerprint collision on ${fingerprint.slice(0, 8)}: field "${cmp.field}" differs`,
      { stored: storedDigest, requested: digest, fingerprint },
    );
    collision = true;
    const { error: delErr } = await supabase
      .from("positional_war_curves")
      .delete()
      .eq("fingerprint", fingerprint);
    if (delErr) {
      console.warn(
        `[positional-war] could not delete colliding rows for fingerprint ${fingerprint}: ${delErr.message}`,
      );
    }
  }

  const curves = await compute();
  if (curves.length === 0) {
    return { ok: true, curves: [], shared: false, collision };
  }

  const computedAt = new Date().toISOString();
  const sharedRows: Database["public"]["Tables"]["positional_war_curves"]["Insert"][] = curves.map((c) => ({
    position: c.position,
    structural_demand: c.structuralDemand,
    replacement_points: c.replacementPoints,
    avg_seated_points: c.avgSeatedPoints,
    deficit: c.deficit,
    shallow_pool: c.shallowPool,
    war_rank_1: c.warRank1,
    war_at_demand: c.warAtDemand,
    cliff_rank: c.cliffRank,
    curve: c.curve as unknown as Json,
    weekly_diagnostics: c.weeklyDiagnostics as unknown as Json,
    from_week: fromWeek,
    through_week: toWeek,
    model_version: modelVersion,
    fingerprint,
    inputs_digest: digest as unknown as Json,
    first_league_id: leagueRowId,
    computed_at: computedAt,
  }));

  const { error: upsertErr } = await supabase
    .from("positional_war_curves")
    .upsert(sharedRows, { onConflict: "fingerprint,position" });
  if (upsertErr) {
    return { ok: false, error: `positional war curves upsert failed: ${upsertErr.message}` };
  }

  const write = await writeLeagueCache(supabase, leagueRowId, season, fingerprint, curves, fromWeek, toWeek, modelVersion);
  if (!write.ok) return { ok: false, error: write.error };

  return { ok: true, curves, shared: false, collision };
}

/**
 * Copy the shared, or freshly computed, curve into this league's own
 * denormalized cache. This is the only write any read path ever queries
 * against: league_positional_war_cache stays at six rows per league, one
 * query, regardless of whether this run hit, missed, or fell through a
 * collision.
 *
 * A failure here is an error verdict. On a hit, the shared row in
 * positional_war_curves is left untouched, so the next view retries the copy
 * without recomputing anything.
 *
 * from_week/through_week/model_version are passed explicitly by the caller on
 * both the hit and the miss path, rather than recovered from the curve
 * itself: PositionCurve carries no such fields (they describe the league's
 * window and the model, not any one position), and on a hit they are the
 * requesting league's own values, guaranteed equal to what is stored because
 * both are hashed into the fingerprint that just matched.
 */
async function writeLeagueCache(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  fingerprint: string,
  curves: PositionCurve[],
  fromWeek: number,
  toWeek: number,
  modelVersion: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const generatedAt = new Date().toISOString();
  const cacheRows: Database["public"]["Tables"]["league_positional_war_cache"]["Insert"][] = curves.map(
    (c) => ({
      league_id: leagueRowId,
      season,
      fingerprint,
      generated_at: generatedAt,
      position: c.position,
      structural_demand: c.structuralDemand,
      replacement_points: c.replacementPoints,
      avg_seated_points: c.avgSeatedPoints,
      deficit: c.deficit,
      shallow_pool: c.shallowPool,
      war_rank_1: c.warRank1,
      war_at_demand: c.warAtDemand,
      cliff_rank: c.cliffRank,
      curve: c.curve as unknown as Json,
      weekly_diagnostics: c.weeklyDiagnostics as unknown as Json,
      from_week: fromWeek,
      through_week: toWeek,
      model_version: modelVersion,
    }),
  );

  const { error } = await supabase
    .from("league_positional_war_cache")
    .upsert(cacheRows, { onConflict: "league_id,season,position" });
  if (error) {
    return { ok: false, error: `league positional war cache upsert failed: ${error.message}` };
  }

  // Drop any position this league no longer starts.
  //
  // An upsert only ever writes the positions the fresh computation produced.
  // A commissioner who removes a slot type mid-season (drops the DEF slot, say)
  // changes startingSlots(), which changes the fingerprint, which forces a
  // recompute that returns one fewer position. Without this delete the old row
  // survives, and loadPositionalWarView reads every row for the league season
  // with no fingerprint filter, so the chart, the rail and the shared card
  // would all keep rendering a series computed under settings that no longer
  // describe the league. That is the same silent-wrong-answer failure the
  // fingerprint and the collision guard exist to prevent, arriving through the
  // one door neither of them watches.
  //
  // Scoped to this league and season, and only to positions absent from the
  // fresh set, so it can never touch a row this run just wrote. A curve array
  // that is empty is handled by the caller, which takes the settled path and
  // clears everything rather than reaching here.
  const keptPositions = curves.map((c) => c.position);
  if (keptPositions.length > 0) {
    const { error: pruneError } = await supabase
      .from("league_positional_war_cache")
      .delete()
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .not("position", "in", `(${keptPositions.join(",")})`);
    if (pruneError) {
      // Non-fatal. The rows this run wrote are correct and already committed;
      // a stale sibling is worth a warning rather than throwing away a good
      // computation. It gets another chance on the next recompute.
      console.warn(
        `[positional-war] could not prune dropped positions for league ${leagueRowId}: ${pruneError.message}`,
      );
    }
  }

  return { ok: true };
}

/** Rebuild PositionCurve[] from stored positional_war_curves rows. */
function rowsToCurves(rows: SharedCurveRow[]): PositionCurve[] {
  return rows
    .slice()
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((r) => ({
      position: r.position as PositionCurve["position"],
      structuralDemand: r.structural_demand,
      replacementPoints: r.replacement_points,
      avgSeatedPoints: r.avg_seated_points,
      deficit: r.deficit,
      shallowPool: r.shallow_pool,
      warRank1: r.war_rank_1,
      warAtDemand: r.war_at_demand,
      cliffRank: r.cliff_rank,
      curve: (r.curve ?? []) as unknown as PositionCurve["curve"],
      weeklyDiagnostics: (r.weekly_diagnostics ?? []) as unknown as PositionCurve["weeklyDiagnostics"],
    }));
}
