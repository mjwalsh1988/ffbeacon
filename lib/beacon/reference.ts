/**
 * Persisted calibration references: load, build, validate, activate, roll back,
 * and preview drift. The DB half of lib/beacon/calibrate.ts (migration 0160).
 *
 * THE ONE RULE THAT MATTERS
 * A normal calculation LOADS the stored reference and nothing else. If the load
 * fails for any reason (query error, missing rows, row count disagreeing with
 * the version header, a value outside [0,1]) it throws ReferenceLoadError and
 * the run dies before writing a single row. It does NOT rebuild, fall back to a
 * freshly derived scale, or borrow another format's reference.
 *
 * Silently rebuilding on a load failure would be worse than the bug this whole
 * method exists to fix: it would convert the stable engine into the unstable one
 * at exactly the moment nobody is watching, and the logs would look like a
 * normal night. So the only path that creates a reference is the deliberate
 * bootstrap/rebuild workflow below, and it says so loudly when it runs.
 *
 * A true cold start (a clean query that returns no active version) is a distinct
 * state from a load failure, and is reported as such so the caller can offer the
 * bootstrap rather than pretending the reference was corrupt.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import { withRetry, chunkUpsert } from "../supabase/retry";
import { gatherSourceValues, type ExternalSource } from "./signals/source-value";
import {
  buildSyntheticReference,
  calibrateSlice,
  CALIBRATION_GRID_POINTS,
  type SyntheticReference,
} from "./calibrate";
import type { SourcePlayerValue } from "./normalize";
import { isDerivedFormat } from "./derived-formats";
import { loadBeaconSettings, loadSignalWeights, type BeaconSettings } from "./settings";

const SOURCE_SLUG = "ffbeacon";
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const PAGE = 1000;
/** The reference is a pure 0..1 scale, so drift is measured on this fixed band. */
const DRIFT_BAND = { floor: 0, ceiling: 10000 };

/** Thrown when a stored reference could not be loaded or failed validation. */
export class ReferenceLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceLoadError";
  }
}

/** Thrown when a rebuild is refused because its preconditions were not met. */
export class ReferenceBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceBuildError";
  }
}

export interface ActiveReference {
  versionId: string;
  version: number;
  formatConfigId: string;
  generatedAt: string;
  activatedAt: string | null;
  sharedPlayerCount: number;
  expectedSources: string[];
  diagnostics: Json;
  /** playerId -> reference_scaled in [0,1]. */
  values: Map<string, number>;
}

/** Age of a reference in whole days, for the cadence and alert thresholds. */
export function referenceAgeDays(generatedAt: string, nowMs: number): number {
  const then = new Date(generatedAt).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (nowMs - then) / 86_400_000;
}

/**
 * Load the ACTIVE reference for each requested format, in one snapshot.
 *
 * Called once per run, before any format is processed, so a rebuild that
 * activates a new version mid-run cannot leave one run reading two different
 * scales for two different formats.
 *
 * A format with no active version maps to null (a clean cold start). Anything
 * else throws.
 */
export async function loadActiveReferences(
  supabase: SupabaseClient<Database>,
  formatConfigIds: string[],
): Promise<Map<string, ActiveReference | null>> {
  const out = new Map<string, ActiveReference | null>();
  for (const id of formatConfigIds) out.set(id, null);
  if (formatConfigIds.length === 0) return out;

  let versions;
  try {
    const { data, error } = await supabase
      .from("beacon_reference_versions")
      .select(
        "id, format_config_id, version, generated_at, activated_at, shared_player_count, expected_sources, diagnostics",
      )
      .eq("status", "active")
      .in("format_config_id", formatConfigIds);
    if (error) throw error;
    versions = data ?? [];
  } catch (err) {
    throw new ReferenceLoadError(
      `Could not read active calibration references: ${errMsg(err)}`,
    );
  }

  for (const v of versions) {
    const values = await loadReferenceRows(supabase, v.id);

    // Validation. Every one of these is a hard failure, never a rebuild trigger.
    if (values.size !== v.shared_player_count) {
      throw new ReferenceLoadError(
        `Calibration reference ${v.id} (format ${v.format_config_id}, version ${v.version}) is incomplete: ${values.size} rows loaded, ${v.shared_player_count} declared. Refusing to run on a partial reference.`,
      );
    }
    if (values.size === 0) {
      throw new ReferenceLoadError(
        `Calibration reference ${v.id} (format ${v.format_config_id}) is active but empty.`,
      );
    }
    for (const [playerId, scaled] of values) {
      if (!Number.isFinite(scaled) || scaled < 0 || scaled > 1) {
        throw new ReferenceLoadError(
          `Calibration reference ${v.id} holds an out-of-range value for player ${playerId}: ${scaled}.`,
        );
      }
    }

    out.set(v.format_config_id, {
      versionId: v.id,
      version: v.version,
      formatConfigId: v.format_config_id,
      generatedAt: v.generated_at,
      activatedAt: v.activated_at,
      sharedPlayerCount: v.shared_player_count,
      expectedSources: v.expected_sources ?? [],
      diagnostics: (v.diagnostics ?? {}) as Json,
      values,
    });
  }

  return out;
}

/** Page every reference row for one version. Supabase truncates at 1000. */
async function loadReferenceRows(
  supabase: SupabaseClient<Database>,
  versionId: string,
): Promise<Map<string, number>> {
  const values = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    let page;
    try {
      page = await withRetry(
        async () => {
          const { data, error } = await supabase
            .from("beacon_value_references")
            .select("player_id, reference_scaled")
            .eq("version_id", versionId)
            .order("player_id", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          return data ?? [];
        },
        { label: `beacon_value_references ${versionId} page ${from}` },
      );
    } catch (err) {
      throw new ReferenceLoadError(
        `Could not read calibration reference ${versionId}: ${errMsg(err)}`,
      );
    }
    for (const r of page) values.set(r.player_id, Number(r.reference_scaled));
    if (page.length < PAGE) break;
  }
  return values;
}

/**
 * The sources a format is EXPECTED to have. Derived from the registry, not
 * hardcoded: a source that does not declare support for this format is not
 * expected for it, so redraft never waits on DynastyProcess.
 */
export function expectedSourcesFor(
  formatSlug: string,
  sources: Array<{ slug: string; supportedFormatSlugs: string[] | null }>,
): string[] {
  return sources
    .filter((s) => s.slug !== SOURCE_SLUG)
    .filter((s) => s.supportedFormatSlugs === null || s.supportedFormatSlugs.includes(formatSlug))
    .map((s) => s.slug)
    .sort();
}

export interface SourceCompleteness {
  ok: boolean;
  expected: string[];
  present: string[];
  missing: string[];
}

/**
 * Is every expected source present with usable values? gatherSourceValues has
 * already applied the cadence-aware staleness gate, so a stale source simply is
 * not in the map: absent and stale are the same failure here, and both refuse
 * the build. A reference built while a source was down would bake a partial
 * consensus into the scale every later run is measured against.
 */
export function assessSourceCompleteness(
  expected: string[],
  bySource: Map<string, SourcePlayerValue[]>,
): SourceCompleteness {
  const present = expected.filter((s) => (bySource.get(s)?.length ?? 0) > 0).sort();
  const missing = expected.filter((s) => !present.includes(s)).sort();
  return { ok: missing.length === 0 && expected.length > 0, expected, present, missing };
}

export interface CandidateReference {
  formatConfigId: string;
  formatSlug: string;
  reference: SyntheticReference;
  completeness: SourceCompleteness;
}

export interface BuildContext {
  formatConfigId: string;
  formatSlug: string;
  /** Skill-position values per source, already staleness-gated. */
  bySource: Map<string, SourcePlayerValue[]>;
  expected: string[];
  minShared: number;
}

/**
 * Build a candidate reference in memory. Persists nothing.
 *
 * Refuses (throws) when a source is missing or the shared set is too small. Both
 * refusals leave the current active reference untouched, which is the correct
 * outcome: an old good scale beats a new bad one.
 */
export function buildReferenceCandidate(ctx: BuildContext): CandidateReference {
  const completeness = assessSourceCompleteness(ctx.expected, ctx.bySource);
  if (!completeness.ok) {
    throw new ReferenceBuildError(
      completeness.expected.length === 0
        ? `No sources are expected for ${ctx.formatSlug}; cannot build a reference.`
        : `Refusing to build a reference for ${ctx.formatSlug}: ${completeness.missing.join(", ")} ${completeness.missing.length === 1 ? "is" : "are"} missing or stale. Expected ${completeness.expected.join(", ")}.`,
    );
  }

  const expectedOnly = new Map<string, SourcePlayerValue[]>();
  for (const slug of completeness.expected) {
    const v = ctx.bySource.get(slug);
    if (v) expectedOnly.set(slug, v);
  }

  const reference = buildSyntheticReference({
    bySource: expectedOnly,
    minShared: ctx.minShared,
  });
  if (!reference) {
    throw new ReferenceBuildError(
      `Refusing to build a reference for ${ctx.formatSlug}: the sources share fewer than ${ctx.minShared} players.`,
    );
  }

  return {
    formatConfigId: ctx.formatConfigId,
    formatSlug: ctx.formatSlug,
    reference,
    completeness,
  };
}

export interface PersistResult {
  versionId: string;
  version: number;
  players: number;
}

/**
 * Write a candidate and activate it. Two phases on purpose:
 *   1. version header as 'candidate', then every player row;
 *   2. activate_beacon_reference(), which re-counts the persisted rows in the
 *      database and refuses to promote a version whose count disagrees with the
 *      header.
 * A crash anywhere in phase 1 leaves an inert candidate no calculation can load.
 * A failure in either phase marks the candidate 'failed' (best effort) and
 * rethrows, so the previous active version stays live and is still rollback-able.
 */
export async function persistReference(
  supabase: SupabaseClient<Database>,
  candidate: CandidateReference,
  opts: { minShared: number; actorId?: string | null; notes?: string | null },
): Promise<PersistResult> {
  const ids = candidate.reference.sharedPlayers;

  const { data: prior, error: priorErr } = await supabase
    .from("beacon_reference_versions")
    .select("version")
    .eq("format_config_id", candidate.formatConfigId)
    .order("version", { ascending: false })
    .limit(1);
  if (priorErr) throw new ReferenceBuildError(`Could not read prior versions: ${priorErr.message}`);
  const version = (prior?.[0]?.version ?? 0) + 1;

  const { data: header, error: headerErr } = await supabase
    .from("beacon_reference_versions")
    .insert({
      format_config_id: candidate.formatConfigId,
      version,
      status: "candidate",
      shared_player_count: ids.length,
      expected_sources: candidate.completeness.expected,
      diagnostics: {
        format_slug: candidate.formatSlug,
        grid_points: CALIBRATION_GRID_POINTS,
        min_shared_players: opts.minShared,
        sources: candidate.reference.diagnostics as unknown as Json,
        present_sources: candidate.completeness.present,
      } as unknown as Json,
      notes: opts.notes ?? null,
      created_by: opts.actorId ?? null,
    })
    .select("id")
    .single();
  if (headerErr || !header) {
    throw new ReferenceBuildError(
      `Could not create the reference version row: ${headerErr?.message ?? "no row returned"}`,
    );
  }
  const versionId = header.id;

  try {
    const rows = ids.map((playerId) => ({
      version_id: versionId,
      player_id: playerId,
      reference_scaled: candidate.reference.values.get(playerId) ?? 0,
    }));
    await chunkUpsert(rows, 500, async (chunk) => {
      await withRetry(
        async () => {
          const { error } = await supabase.from("beacon_value_references").insert(chunk);
          if (error) throw error;
        },
        { label: "beacon_value_references insert" },
      );
    });

    const { error: actErr } = await supabase.rpc("activate_beacon_reference", {
      p_version_id: versionId,
      p_min_shared: opts.minShared,
    });
    if (actErr) throw actErr;
  } catch (err) {
    await supabase
      .from("beacon_reference_versions")
      .update({ status: "failed", notes: `Failed during write: ${errMsg(err)}` })
      .eq("id", versionId);
    throw new ReferenceBuildError(
      `Reference version ${version} for ${candidate.formatSlug} was not activated: ${errMsg(err)}`,
    );
  }

  return { versionId, version, players: ids.length };
}

export interface FormatSourceSlice {
  formatConfigId: string;
  formatSlug: string;
  bySource: Map<string, SourcePlayerValue[]>;
  expected: string[];
}

/**
 * Gather the skill-position source values for each requested format, exactly the
 * way runCalculateBeaconValues gathers them, so a reference is always built from
 * the same inputs the engine will later be fitted against.
 */
export async function gatherReferenceInputs(
  supabase: SupabaseClient<Database>,
  opts: { formatSlugs?: string[]; nowMs: number; settings: BeaconSettings },
): Promise<FormatSourceSlice[]> {
  const { data: ffRow, error: ffErr } = await supabase
    .from("source_registry")
    .select("supported_format_slugs")
    .eq("slug", SOURCE_SLUG)
    .single();
  if (ffErr) throw ffErr;
  const ffSlugs = ffRow.supported_format_slugs ?? [];

  const { data: formats, error: fErr } = await supabase
    .from("format_configs")
    .select("id, slug");
  if (fErr) throw fErr;
  const ffbeaconFormats = (formats ?? [])
    .filter((f) => ffSlugs.includes(f.slug))
    // Derived boards (every TE-premium format, the best-ball presets) are built
    // from a baseline board's finished rows and never normalize, so they never
    // consult a reference. Building one for them would be dead data, and for the
    // best-ball presets (which no external source covers) it would also mean the
    // rebuild job reporting a refusal every night for boards that are working
    // perfectly. Skip them here, exactly as the engine skips them.
    .filter((f) => !isDerivedFormat(f.slug))
    .filter((f) => !opts.formatSlugs || opts.formatSlugs.includes(f.slug))
    .map((f) => ({ slug: f.slug, id: f.id }));

  const { data: srcRows, error: sErr } = await supabase
    .from("source_registry")
    .select("slug, update_cadence, supported_format_slugs, data_type")
    .eq("is_active", true)
    .order("priority");
  if (sErr) throw sErr;
  const sources: ExternalSource[] = (srcRows ?? [])
    .filter(
      (s) =>
        s.slug !== SOURCE_SLUG &&
        Array.isArray(s.data_type) &&
        s.data_type.includes("player_value_history"),
    )
    .map((s) => ({
      slug: s.slug,
      cadence: s.update_cadence,
      supportedFormatSlugs: s.supported_format_slugs,
    }));

  const weights = await loadSignalWeights(supabase);
  const enabled = new Set(
    weights
      .filter((w) => w.signalType === "source_value" && w.isEnabled && w.sourceSlug)
      .map((w) => w.sourceSlug as string),
  );

  const gather = await gatherSourceValues(supabase, {
    sources,
    ffbeaconFormats,
    staleDays: opts.settings.staleDays,
    nowMs: opts.nowMs,
  });

  return ffbeaconFormats.map((f) => {
    const bySourceAll = gather.byFormat.get(f.id) ?? new Map<string, SourcePlayerValue[]>();
    const bySource = new Map<string, SourcePlayerValue[]>();
    for (const [slug, values] of bySourceAll) {
      if (!enabled.has(slug)) continue;
      const skill = values.filter((v) =>
        SKILL_POSITIONS.has(gather.positionByPlayer.get(v.playerId) ?? ""),
      );
      if (skill.length > 0) bySource.set(slug, skill);
    }
    return {
      formatConfigId: f.id,
      formatSlug: f.slug,
      bySource,
      // Expected = declares support AND its source_value weight is enabled. A
      // source the owner has switched off is not owed a seat in the consensus.
      expected: expectedSourcesFor(
        f.slug,
        sources.filter((s) => enabled.has(s.slug)),
      ),
    };
  });
}

export interface RebuildOutcome {
  formatSlug: string;
  formatConfigId: string;
  status: "rebuilt" | "skipped" | "refused";
  reason?: string;
  versionId?: string;
  version?: number;
  players?: number;
  previousVersionId?: string | null;
  ageDays?: number | null;
}

/**
 * The deliberate rebuild workflow. Never called from a calculation.
 *
 * Without `force`, a format whose active reference is younger than the cadence
 * is skipped, so the scheduled job is safe to run daily. A refusal (missing
 * source, thin shared set) is reported, not thrown, so one bad format cannot
 * stop the others; the caller decides whether that is an error.
 */
export async function rebuildReferences(
  supabase: SupabaseClient<Database>,
  opts: {
    formatSlugs?: string[];
    force?: boolean;
    nowMs: number;
    actorId?: string | null;
    notes?: string | null;
  },
): Promise<RebuildOutcome[]> {
  const settings = await loadBeaconSettings(supabase);
  const slices = await gatherReferenceInputs(supabase, {
    formatSlugs: opts.formatSlugs,
    nowMs: opts.nowMs,
    settings,
  });
  const active = await loadActiveReferences(
    supabase,
    slices.map((s) => s.formatConfigId),
  );

  const outcomes: RebuildOutcome[] = [];
  for (const slice of slices) {
    const current = active.get(slice.formatConfigId) ?? null;
    const ageDays = current ? referenceAgeDays(current.generatedAt, opts.nowMs) : null;

    if (!opts.force && current && ageDays !== null && ageDays < settings.calibrationRebuildDays) {
      outcomes.push({
        formatSlug: slice.formatSlug,
        formatConfigId: slice.formatConfigId,
        status: "skipped",
        reason: `Active reference is ${ageDays.toFixed(1)} days old; the cadence is ${settings.calibrationRebuildDays}.`,
        previousVersionId: current.versionId,
        ageDays,
      });
      continue;
    }

    try {
      const candidate = buildReferenceCandidate({
        formatConfigId: slice.formatConfigId,
        formatSlug: slice.formatSlug,
        bySource: slice.bySource,
        expected: slice.expected,
        minShared: settings.calibrationMinSharedPlayers,
      });
      const persisted = await persistReference(supabase, candidate, {
        minShared: settings.calibrationMinSharedPlayers,
        actorId: opts.actorId ?? null,
        notes: opts.notes ?? null,
      });
      console.warn(
        `[beacon/reference] ${current ? "REBUILT" : "BOOTSTRAPPED"} ${slice.formatSlug}: version ${persisted.version}, ${persisted.players} players, sources ${candidate.completeness.expected.join(", ")}.`,
      );
      outcomes.push({
        formatSlug: slice.formatSlug,
        formatConfigId: slice.formatConfigId,
        status: "rebuilt",
        versionId: persisted.versionId,
        version: persisted.version,
        players: persisted.players,
        previousVersionId: current?.versionId ?? null,
        ageDays,
      });
    } catch (err) {
      outcomes.push({
        formatSlug: slice.formatSlug,
        formatConfigId: slice.formatConfigId,
        status: "refused",
        reason: errMsg(err),
        previousVersionId: current?.versionId ?? null,
        ageDays,
      });
    }
  }
  return outcomes;
}

/** Promote a stored version (candidate or superseded) back to active. */
export async function activateReferenceVersion(
  supabase: SupabaseClient<Database>,
  versionId: string,
  minShared: number,
): Promise<void> {
  const { error } = await supabase.rpc("activate_beacon_reference", {
    p_version_id: versionId,
    p_min_shared: minShared,
  });
  if (error) throw new ReferenceBuildError(error.message);
}

export interface DriftMetrics {
  players: number;
  meanAbs: number;
  maxMove: number;
  over250: number;
  over500: number;
  pctOver250: number;
  spearman: number;
}

export interface DriftPreview {
  formatSlug: string;
  formatConfigId: string;
  status: "compared" | "no_active_reference" | "candidate_refused";
  reason?: string;
  activeVersion?: number;
  activeVersionId?: string;
  ageDays?: number;
  activeSharedPlayers?: number;
  candidateSharedPlayers?: number;
  metrics?: DriftMetrics;
  alerts: string[];
}

/**
 * Compare the board the active reference produces against the board a freshly
 * built reference would produce, on today's source data. Builds the candidate in
 * memory and NEVER persists or activates it.
 *
 * The comparison is on the band-scaled normalization output rather than the
 * final published value. Adjustment factors, manual overrides, and rounding are
 * reference-independent and identical on both sides, so they would cancel; this
 * isolates exactly the thing the reference controls.
 */
export async function previewReferenceDrift(
  supabase: SupabaseClient<Database>,
  opts: { formatSlugs?: string[]; nowMs: number },
): Promise<DriftPreview[]> {
  const settings = await loadBeaconSettings(supabase);
  const weights = await loadSignalWeights(supabase);
  const blend = new Map<string, number>();
  for (const w of weights) {
    if (w.signalType === "source_value" && w.isEnabled && w.sourceSlug) {
      blend.set(w.sourceSlug, w.weight);
    }
  }

  const slices = await gatherReferenceInputs(supabase, {
    formatSlugs: opts.formatSlugs,
    nowMs: opts.nowMs,
    settings,
  });
  const active = await loadActiveReferences(
    supabase,
    slices.map((s) => s.formatConfigId),
  );

  const previews: DriftPreview[] = [];
  for (const slice of slices) {
    const current = active.get(slice.formatConfigId) ?? null;
    if (!current) {
      previews.push({
        formatSlug: slice.formatSlug,
        formatConfigId: slice.formatConfigId,
        status: "no_active_reference",
        reason: "No active reference for this format yet.",
        alerts: [],
      });
      continue;
    }

    const ageDays = referenceAgeDays(current.generatedAt, opts.nowMs);
    const alerts = evaluateDriftAlerts(
      { ageDays, sharedPlayerCount: current.sharedPlayerCount },
      settings,
    );

    let candidate: CandidateReference;
    try {
      candidate = buildReferenceCandidate({
        formatConfigId: slice.formatConfigId,
        formatSlug: slice.formatSlug,
        bySource: slice.bySource,
        expected: slice.expected,
        minShared: settings.calibrationMinSharedPlayers,
      });
    } catch (err) {
      previews.push({
        formatSlug: slice.formatSlug,
        formatConfigId: slice.formatConfigId,
        status: "candidate_refused",
        reason: errMsg(err),
        activeVersion: current.version,
        activeVersionId: current.versionId,
        ageDays,
        activeSharedPlayers: current.sharedPlayerCount,
        alerts,
      });
      continue;
    }

    const before = calibrateSlice({
      bySource: slice.bySource,
      weights: blend,
      band: DRIFT_BAND,
      minPlayers: settings.minPlayersForQuantile,
      reference: current.values,
      gridPoints: settings.calibrationGridPoints,
    });
    const after = calibrateSlice({
      bySource: slice.bySource,
      weights: blend,
      band: DRIFT_BAND,
      minPlayers: settings.minPlayersForQuantile,
      reference: candidate.reference.values,
      gridPoints: settings.calibrationGridPoints,
    });

    const metrics = compareBoards(before.players, after.players);
    alerts.push(
      ...evaluateDriftAlerts(
        { ageDays, sharedPlayerCount: current.sharedPlayerCount, metrics },
        settings,
        { skipStatic: true },
      ),
    );

    previews.push({
      formatSlug: slice.formatSlug,
      formatConfigId: slice.formatConfigId,
      status: "compared",
      activeVersion: current.version,
      activeVersionId: current.versionId,
      ageDays,
      activeSharedPlayers: current.sharedPlayerCount,
      candidateSharedPlayers: candidate.reference.sharedPlayers.length,
      metrics,
      alerts,
    });
  }

  return previews;
}

export interface DriftAlertInput {
  ageDays: number;
  sharedPlayerCount: number;
  metrics?: DriftMetrics;
}

export type DriftAlertSettings = Pick<
  BeaconSettings,
  | "calibrationMaxAgeDays"
  | "calibrationMinSharedPlayers"
  | "calibrationDriftMeanAbs"
  | "calibrationDriftPlayerMax"
  | "calibrationDriftPct250"
  | "calibrationDriftMinSpearman"
>;

/**
 * Every drift threshold in one pure function, so each one can be tested on its
 * own and the wording stays identical between the email and the admin page.
 *
 * Any single trip is enough to alert. They are deliberately not weighted against
 * each other: an old reference and a large would-be movement are different
 * problems, and either is worth a human look.
 *
 * `skipStatic` omits the two reference-property checks (age, thinness) when the
 * caller has already run them, so the movement checks can be appended after the
 * candidate is built without repeating the first two.
 */
export function evaluateDriftAlerts(
  input: DriftAlertInput,
  settings: DriftAlertSettings,
  opts: { skipStatic?: boolean } = {},
): string[] {
  const alerts: string[] = [];

  if (!opts.skipStatic) {
    if (input.ageDays > settings.calibrationMaxAgeDays) {
      alerts.push(
        `Active reference is ${input.ageDays.toFixed(1)} days old, past the ${settings.calibrationMaxAgeDays}-day limit.`,
      );
    }
    if (input.sharedPlayerCount < settings.calibrationMinSharedPlayers) {
      alerts.push(
        `Active reference covers ${input.sharedPlayerCount} players, below the ${settings.calibrationMinSharedPlayers} minimum.`,
      );
    }
  }

  const m = input.metrics;
  if (!m) return alerts;

  if (m.meanAbs > settings.calibrationDriftMeanAbs) {
    alerts.push(
      `A rebuild would move the average player ${m.meanAbs.toFixed(0)} points, over the ${settings.calibrationDriftMeanAbs} limit.`,
    );
  }
  if (m.maxMove >= settings.calibrationDriftPlayerMax) {
    alerts.push(
      `${m.over500} player${m.over500 === 1 ? "" : "s"} would move ${settings.calibrationDriftPlayerMax} points or more, the largest by ${m.maxMove.toFixed(0)}.`,
    );
  }
  if (m.pctOver250 > settings.calibrationDriftPct250) {
    alerts.push(
      `${(m.pctOver250 * 100).toFixed(1)} percent of the board would move 250 points or more, over the ${(settings.calibrationDriftPct250 * 100).toFixed(1)} percent limit.`,
    );
  }
  if (m.spearman < settings.calibrationDriftMinSpearman) {
    alerts.push(
      `Board order correlation would fall to ${m.spearman.toFixed(4)}, below ${settings.calibrationDriftMinSpearman}.`,
    );
  }
  return alerts;
}

/**
 * Movement metrics between two boards. Threshold counts use the drift-alert
 * fixed points (250 and 500) because those are the numbers the validation was
 * measured in; the configurable settings decide when a count is alarming, not
 * what is counted.
 */
export function compareBoards(
  before: Map<string, { value: number }>,
  after: Map<string, { value: number }>,
): DriftMetrics {
  const ids = [...before.keys()].filter((id) => after.has(id)).sort();
  if (ids.length === 0) {
    return { players: 0, meanAbs: 0, maxMove: 0, over250: 0, over500: 0, pctOver250: 0, spearman: 1 };
  }
  let sum = 0;
  let maxMove = 0;
  let over250 = 0;
  let over500 = 0;
  for (const id of ids) {
    const d = Math.abs((after.get(id)?.value ?? 0) - (before.get(id)?.value ?? 0));
    sum += d;
    if (d > maxMove) maxMove = d;
    if (d >= 250) over250 += 1;
    if (d >= 500) over500 += 1;
  }
  return {
    players: ids.length,
    meanAbs: sum / ids.length,
    maxMove,
    over250,
    over500,
    pctOver250: over250 / ids.length,
    spearman: spearman(
      ids.map((id) => before.get(id)?.value ?? 0),
      ids.map((id) => after.get(id)?.value ?? 0),
    ),
  };
}

/** Spearman rank correlation with average ranks for ties. */
export function spearman(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 1;
  const ra = rankAvg(a.slice(0, n));
  const rb = rankAvg(b.slice(0, n));
  const mean = (n + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = ra[i] - mean;
    const y = rb[i] - mean;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da <= 0 || db <= 0) return 1;
  return num / Math.sqrt(da * db);
}

function rankAvg(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/**
 * PostgREST hands back a plain object, not an Error, so `String(err)` would
 * flatten a perfectly good explanation into "[object Object]". The reason the
 * database refused a reference (which count disagreed with which) is exactly
 * what an operator needs at 2am, so dig the message out.
 */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}
