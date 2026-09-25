/**
 * The non-IDP invariant and the IDP league report (plan IDP-316).
 *
 * Runs the three League Pulse engines that the IDP switch reaches (Power
 * Pulse, Positional WAR and the Manager Ledger) twice per league, once with
 * the switch off and once with it on, and compares the outputs.
 *
 *   - A league that starts no defensive slot must come out IDENTICAL, apart
 *     from version strings. Any difference is a failure and the script exits 1.
 *   - A league that does start one gets its before and after figures printed
 *     (weekly projected points, expected wins, playoff odds, lineup efficiency
 *     and the Positional WAR curves) for the owner to read.
 *
 * READ ONLY. The engine INPUTS are built through the same loaders the
 * orchestrators use and the pure engines are then called directly. Nothing
 * here calls calculateLeague*, refresh*, pulseLeague or syncLeagueMatchups,
 * because every one of those writes. Two consequences worth knowing:
 *
 *   - Power Pulse reads the head-to-head slate as it is STORED, where the
 *     orchestrator refreshes it from Sleeper first. The comparison is between
 *     two runs over the same stored slate, so that cannot cause a difference.
 *   - The only Sleeper request is one getNflState for the current week.
 *
 * Run:
 *   npm run verify:idp-invariant
 *   npm run verify:idp-invariant -- --sample 20 --out report.txt
 *
 * Plan: docs/idp/idp-guide-and-data-plan.md, section 8, task IDP-316.
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { getServiceClient } from "./_supabase";
import { fetchAllRows } from "../lib/supabase/fetch-all";
import { getNflState } from "../lib/sleeper";
import { resolveCurrentWeek } from "../lib/league-matchups";
import { closestScoringBase } from "../lib/league-scoring";
import { isDraftPending } from "../lib/league-readiness";
import { choppedWeeks, resolveFinalWeek } from "../lib/chopped/league";
import { defenseSeasonsFor } from "../lib/projections/defense-seasons";
import { resolveProjectionSourceForWindow } from "../lib/projections/source";
import { loadPowerPulseSettings, type PowerPulseSettings } from "../lib/power-pulse/settings";
import { idpReadsFor, leagueStartsDefenders, scoringKeysArg } from "../lib/power-pulse/idp-reads";
import { startingSlots } from "../lib/power-pulse/lineup";
import { computePowerPulse, type PowerPulseTeamResult } from "../lib/power-pulse/engine";
import {
  loadAccuracy,
  loadAliveRosterIds,
  loadCompletedResults,
  loadDefenseSplits,
  loadLeague,
  loadPlayers,
  loadProjections,
  loadRosters,
  loadSchedule,
} from "../lib/power-pulse/load";
import { buildWarPlayers, loadWarUniverse, type WarUniverse } from "../lib/positional-war/load";
import { computeCurves } from "../lib/positional-war/engine";
import type { PositionCurve } from "../lib/positional-war/types";
import { computeLedger, isLedgerSkip } from "../lib/manager-ledger/engine";
import {
  buildIneligibleIds,
  loadLedgerDraftPicks,
  loadLedgerLeague,
  loadLedgerPlayers,
  loadLedgerTransactions,
  loadRosters as loadLedgerRosters,
  loadSettledWeeks,
} from "../lib/manager-ledger/load";
import type { LedgerResult } from "../lib/manager-ledger/types";

type ServiceClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Pure parts (tested in verify-idp-invariant.test.ts)
// ---------------------------------------------------------------------------

/** Keys that name a model or cache version. They are allowed to differ. */
export function isVersionKey(key: string): boolean {
  return /version/i.test(key);
}

/**
 * A plain, comparable copy: Maps become sorted entry arrays, Sets sorted
 * arrays, and every version-named key is dropped at any depth.
 */
export function comparable(value: unknown): unknown {
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([k, v]) => [k, comparable(v)] as const)
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  }
  if (value instanceof Set) return [...value].map(comparable).sort();
  if (Array.isArray(value)) return value.map(comparable);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (isVersionKey(key)) continue;
      out[key] = comparable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Every path at which two values differ, up to `limit`. Exact comparison: the
 * engines are deterministic (the simulation is seeded), so "close" is not the
 * same and would hide a real change.
 */
export function diffPaths(a: unknown, b: unknown, limit = 20): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (out.length >= limit) return;
    if (Object.is(x, y)) return;
    const bothObjects = x !== null && y !== null && typeof x === "object" && typeof y === "object";
    if (!bothObjects || Array.isArray(x) !== Array.isArray(y)) {
      out.push(`${path || "(root)"}: ${short(x)} -> ${short(y)}`);
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) out.push(`${path}.length: ${x.length} -> ${y.length}`);
      for (let i = 0; i < Math.min(x.length, y.length); i += 1) walk(x[i], y[i], `${path}[${i}]`);
      return;
    }
    const xo = x as Record<string, unknown>;
    const yo = y as Record<string, unknown>;
    for (const key of new Set([...Object.keys(xo), ...Object.keys(yo)])) {
      walk(xo[key], yo[key], path ? `${path}.${key}` : key);
    }
  };
  walk(comparable(a), comparable(b), "");
  return out;
}

function short(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * A league name as a manager typed it, with typographic quotes and dashes
 * turned into their plain forms, so the report stays plain ASCII punctuation.
 */
export function plainName(name: string | null): string {
  if (!name) return "(unnamed)";
  return name
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

/** `n` items spread evenly across a list, first included; the whole list when it is short. */
export function sampleEvenly<T>(items: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return [...items];
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) out.push(items[Math.floor(i * step)]);
  return out;
}

function fixed(value: number | null | undefined, places = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "none" : value.toFixed(places);
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "none" : `${(value * 100).toFixed(1)}%`;
}

/** One line per team: projected points a week, expected wins and playoff odds, before and after. */
export function pulseReportLines(
  off: readonly PowerPulseTeamResult[],
  on: readonly PowerPulseTeamResult[],
): string[] {
  const onById = new Map(on.map((t) => [t.sleeperRosterId, t]));
  return [...off]
    .sort((a, b) => a.sleeperRosterId - b.sleeperRosterId)
    .map((before) => {
      const after = onById.get(before.sleeperRosterId);
      return (
        `  roster ${before.sleeperRosterId}: points a week ${fixed(before.expectedPointsPerWeek)} to ${fixed(after?.expectedPointsPerWeek)}, ` +
        `expected wins ${fixed(before.expectedWins, 2)} to ${fixed(after?.expectedWins, 2)}, ` +
        `playoff odds ${percent(before.playoffOdds)} to ${percent(after?.playoffOdds)}, ` +
        `Pulse ${before.powerPulse} to ${after?.powerPulse ?? "none"}`
      );
    });
}

/** One line per position: demand and the Positional WAR of rank 1 and at demand, before and after. */
export function curveReportLines(
  off: readonly PositionCurve[],
  on: readonly PositionCurve[],
): string[] {
  const positions = [...new Set([...off, ...on].map((c) => c.position))];
  return positions.map((position) => {
    const a = off.find((c) => c.position === position);
    const b = on.find((c) => c.position === position);
    const side = (c: PositionCurve | undefined) =>
      c
        ? `demand ${c.structuralDemand}, rank 1 ${fixed(c.warRank1, 2)}, at demand ${fixed(c.warAtDemand, 2)}`
        : "no curve";
    return `  ${position}: ${side(a)} | ${side(b)}`;
  });
}

/** One line per team: lineup efficiency and points left on the bench, before and after. */
export function ledgerReportLines(off: LedgerResult, on: LedgerResult): string[] {
  const onById = new Map(on.teams.map((t) => [t.sleeperRosterId, t]));
  const head = `  gradable slots ${off.gradableSlots.length} to ${on.gradableSlots.length}, ungradable ${off.ungradableSlots.length} to ${on.ungradableSlots.length}`;
  const rows = [...off.teams]
    .sort((a, b) => a.sleeperRosterId - b.sleeperRosterId)
    .map((before) => {
      const after = onById.get(before.sleeperRosterId);
      return (
        `  roster ${before.sleeperRosterId}: efficiency ${percent(before.lineup.efficiency)} to ${percent(after?.lineup.efficiency)}, ` +
        `points left ${fixed(before.lineup.pointsLeft)} to ${fixed(after?.lineup.pointsLeft)}`
      );
    });
  return [head, ...rows];
}

// ---------------------------------------------------------------------------
// Engine runs (reads only)
// ---------------------------------------------------------------------------

type Outcome<T> = { ok: true; value: T } | { ok: false; skipped: string };

function withSwitch(settings: PowerPulseSettings, enabled: boolean): PowerPulseSettings {
  return { ...settings, idp: { ...settings.idp, enabled } };
}

async function runPowerPulse(
  supabase: ServiceClient,
  leagueRowId: string,
  settings: PowerPulseSettings,
  nflState: Awaited<ReturnType<typeof getNflState>>,
  idpEnabled: boolean,
): Promise<Outcome<PowerPulseTeamResult[]>> {
  const league = await loadLeague(supabase, leagueRowId);
  if (!league) return { ok: false, skipped: "league row not found" };
  const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);

  const rosters = await loadRosters(supabase, leagueRowId);
  if (rosters.length === 0) return { ok: false, skipped: "no rosters" };
  if (isDraftPending(league.status) && !rosters.some((r) => r.playerSleeperIds.length > 0)) {
    return { ok: false, skipped: "draft pending with empty rosters" };
  }

  const scoringBase = closestScoringBase(league.scoringSettings);
  const idpReads = idpReadsFor(idpEnabled, league.rosterPositions, scoringBase);
  const sleeperIds = Array.from(new Set(rosters.flatMap((r) => r.playerSleeperIds)));
  const players = await loadPlayers(supabase, sleeperIds, { positions: idpReads.candidatePositions });
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));
  const defenseSeasons = defenseSeasonsFor(league.season);
  const projectionSource = await resolveProjectionSourceForWindow({
    supabase,
    season: league.season,
    fromWeek: currentWeek,
    settings: settings.beaconProjections,
  });

  const [projections, accuracy, defense, schedule, results] = await Promise.all([
    loadProjections(supabase, playerIds, league.season, currentWeek, undefined, projectionSource),
    loadAccuracy(supabase, playerIds, scoringKeysArg(idpReads), projectionSource),
    loadDefenseSplits(supabase, scoringKeysArg(idpReads), defenseSeasons),
    loadSchedule(supabase, leagueRowId, league.season),
    loadCompletedResults(supabase, leagueRowId, league.season),
  ]);
  if (projections.length === 0) return { ok: false, skipped: "no weekly projections stored" };

  const aliveRosterIds = league.chopped ? await loadAliveRosterIds(supabase, leagueRowId) : null;
  const aliveCount = aliveRosterIds?.length ?? rosters.length;
  const remaining = league.chopped
    ? choppedWeeks(currentWeek, resolveFinalWeek(currentWeek, aliveCount, league.choppedPerWeek ?? 1).finalWeek)
        .length
    : schedule.weeks.filter((w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart).length;
  if (remaining === 0) return { ok: false, skipped: "no games left to project" };

  // Only read when the realism correction is on, as the orchestrator does.
  let lineupEfficiency: Map<number, { efficiency: number; weeksGraded: number }> | undefined;
  if (settings.lineupRealism?.enabled) {
    lineupEfficiency = new Map();
    const { data } = await supabase
      .from("league_manager_ledger_cache")
      .select("sleeper_roster_id, lineup_efficiency, weeks_graded")
      .eq("league_id", leagueRowId)
      .eq("season", league.season);
    for (const row of data ?? []) {
      const efficiency = Number(row.lineup_efficiency);
      if (Number.isFinite(efficiency)) {
        lineupEfficiency.set(Number(row.sleeper_roster_id), {
          efficiency,
          weeksGraded: Number(row.weeks_graded ?? 0),
        });
      }
    }
  }

  const teams = computePowerPulse({
    league,
    rosters,
    players,
    projections,
    accuracy,
    defense,
    defenseSeasons,
    schedule: schedule.weeks,
    setLineups: schedule.setLineups,
    results,
    lineupEfficiency,
    aliveRosterIds,
    currentWeek,
    settings: withSwitch(settings, idpEnabled),
    idpEnabled: idpReads.idpEnabled,
  });
  return teams.length === 0 ? { ok: false, skipped: "no teams scored" } : { ok: true, value: teams };
}

/** The full-universe read is the expensive one and is shared across leagues, so it is memoised here. */
const universeMemo = new Map<string, Promise<WarUniverse>>();

async function runPositionalWar(
  supabase: ServiceClient,
  leagueRowId: string,
  settings: PowerPulseSettings,
  nflState: Awaited<ReturnType<typeof getNflState>>,
  idpEnabled: boolean,
): Promise<Outcome<PositionCurve[]>> {
  const league = await loadLeague(supabase, leagueRowId);
  if (!league) return { ok: false, skipped: "league row not found" };
  const fromWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);
  const toWeek = league.playoffWeekStart - 1;
  if (toWeek < fromWeek) return { ok: false, skipped: "no regular season weeks remaining" };

  const { data: leagueRow } = await supabase.from("leagues").select("total_rosters").eq("id", leagueRowId).maybeSingle();
  let teamCount = typeof leagueRow?.total_rosters === "number" && leagueRow.total_rosters > 0 ? leagueRow.total_rosters : null;
  if (teamCount === null) {
    const { count } = await supabase.from("rosters").select("id", { count: "exact", head: true }).eq("league_id", leagueRowId);
    teamCount = count && count > 0 ? count : null;
  }
  if (teamCount === null) return { ok: false, skipped: "unknown team count" };

  const projectionSource = await resolveProjectionSourceForWindow({
    supabase,
    season: league.season,
    fromWeek,
    toWeek,
    settings: settings.beaconProjections,
  });
  const scoringBase = closestScoringBase(league.scoringSettings);
  const idpReads = idpReadsFor(idpEnabled, league.rosterPositions, scoringBase);
  const slots = startingSlots(league.rosterPositions, idpReads.slotMap);
  const weeks: number[] = [];
  for (let w = fromWeek; w <= toWeek; w += 1) weeks.push(w);

  const params = {
    season: league.season,
    fromWeek,
    toWeek,
    scoringBase,
    source: projectionSource,
    includeDefenders: idpReads.loadsDefenders,
  };
  const key = JSON.stringify(params);
  if (!universeMemo.has(key)) universeMemo.set(key, loadWarUniverse(params));
  const universe = await universeMemo.get(key)!;

  const effective = withSwitch(settings, idpEnabled);
  const players = buildWarPlayers({
    universe,
    scoringSettings: league.scoringSettings,
    settings: effective,
    weeks,
    currentWeek: fromWeek,
  });
  const result = computeCurves({
    league: { season: league.season, slots, teamCount, fromWeek, toWeek, idpEnabled: idpReads.idpEnabled },
    players,
    settings: {
      displayDepthMultiple: effective.war.displayDepthMultiple,
      minDisplayDepth: effective.war.minDisplayDepth,
      cliffThreshold: effective.war.cliffThreshold,
      clampBelowReplacement: effective.war.clampBelowReplacement,
    },
  });
  return result.curves.length === 0 ? { ok: false, skipped: "no curves" } : { ok: true, value: result.curves };
}

type LedgerInputs = Omit<Parameters<typeof computeLedger>[0], "idpEnabled">;

async function loadLedgerInputs(supabase: ServiceClient, leagueRowId: string): Promise<LedgerInputs | null> {
  const league = await loadLedgerLeague(supabase, leagueRowId);
  if (!league) return null;
  const rosters = await loadLedgerRosters(supabase, leagueRowId);
  const [weeks, transactions, picks] = await Promise.all([
    loadSettledWeeks(supabase, leagueRowId, league.season, buildIneligibleIds(rosters)),
    loadLedgerTransactions(supabase, leagueRowId, league.season),
    loadLedgerDraftPicks(supabase, league.sleeperLeagueId, league.season),
  ]);
  const players = await loadLedgerPlayers(supabase, weeks, transactions, picks);
  return {
    season: league.season,
    rosterPositions: league.rosterPositions,
    rosters: rosters.map((r) => ({
      sleeperRosterId: r.sleeperRosterId,
      teamName: r.teamName,
      ownerHandle: r.ownerHandle,
    })),
    weeks,
    transactions,
    draftPicks: picks,
    players,
    leagueHasFaab: league.hasFaab,
  };
}

function runLedger(inputs: LedgerInputs, idpEnabled: boolean): Outcome<LedgerResult> {
  const result = computeLedger({ ...inputs, idpEnabled });
  return isLedgerSkip(result) ? { ok: false, skipped: result.skipped } : { ok: true, value: result };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type LeagueRow = { id: string; name: string | null; sleeper_league_id: string; slots: string[] };

/** roster_positions is stored as jsonb; anything that is not a list of strings reads as no slots. */
export function rosterPositionsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : [];
}

function compareOutcomes<T>(off: Outcome<T>, on: Outcome<T>): string[] {
  if (!off.ok || !on.ok) {
    const a = off.ok ? "ran" : `skipped (${off.skipped})`;
    const b = on.ok ? "ran" : `skipped (${on.skipped})`;
    return a === b ? [] : [`outcome: ${a} -> ${b}`];
  }
  return diffPaths(off.value, on.value);
}

async function main() {
  const args = process.argv.slice(2);
  const sampleIdx = args.indexOf("--sample");
  const outIdx = args.indexOf("--out");
  const sampleSize = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) : 20;
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  const supabase = getServiceClient();
  const [settings, nflState] = await Promise.all([loadPowerPulseSettings(supabase), getNflState()]);
  const season = Number(nflState?.season);
  if (!Number.isFinite(season)) throw new Error("could not resolve the current NFL season from Sleeper");

  // Paged: a plain select() stops at 1000 rows without an error.
  const rows = await fetchAllRows("leagues", (from, to) =>
    supabase
      .from("leagues")
      .select("id, name, sleeper_league_id, roster_positions")
      .eq("season", season)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const leagues: LeagueRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sleeper_league_id: r.sleeper_league_id,
    slots: rosterPositionsOf(r.roster_positions),
  }));
  const idpLeagues = leagues.filter((l) => leagueStartsDefenders(l.slots));
  const ordinary = sampleEvenly(
    leagues.filter((l) => !leagueStartsDefenders(l.slots)),
    sampleSize,
  );

  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    console.log(line);
  };
  log(`IDP invariant, season ${season}, stored switch ${settings.idp?.enabled ? "ON" : "off"}`);
  log(`${leagues.length} leagues this season, ${idpLeagues.length} start a defensive slot; sampling ${ordinary.length} that do not.`);

  let failures = 0;
  log("");
  log("ORDINARY LEAGUES (must be identical)");
  for (const league of ordinary) {
    const label = `${plainName(league.name)} [${league.sleeper_league_id}]`;
    try {
      const pulse = compareOutcomes(
        await runPowerPulse(supabase, league.id, settings, nflState, false),
        await runPowerPulse(supabase, league.id, settings, nflState, true),
      );
      const war = compareOutcomes(
        await runPositionalWar(supabase, league.id, settings, nflState, false),
        await runPositionalWar(supabase, league.id, settings, nflState, true),
      );
      const ledgerInputs = await loadLedgerInputs(supabase, league.id);
      const ledger = ledgerInputs
        ? compareOutcomes(runLedger(ledgerInputs, false), runLedger(ledgerInputs, true))
        : [];
      const diffs = [
        ...pulse.map((d) => `Power Pulse ${d}`),
        ...war.map((d) => `Positional WAR ${d}`),
        ...ledger.map((d) => `Ledger ${d}`),
      ];
      if (diffs.length === 0) {
        log(`  identical: ${label}`);
      } else {
        failures += 1;
        log(`  DIFFERS: ${label}`);
        for (const d of diffs) log(`    ${d}`);
      }
    } catch (err) {
      failures += 1;
      log(`  ERROR: ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("");
  log("IDP LEAGUES (switch off, then on)");
  for (const league of idpLeagues) {
    log("");
    log(`${plainName(league.name)} [${league.sleeper_league_id}]`);
    log(`  slots: ${league.slots.filter((t) => t !== "BN" && t !== "IR" && t !== "TAXI").join(", ")}`);
    try {
      const pulseOff = await runPowerPulse(supabase, league.id, settings, nflState, false);
      const pulseOn = await runPowerPulse(supabase, league.id, settings, nflState, true);
      log("  Power Pulse");
      if (pulseOff.ok && pulseOn.ok) for (const l of pulseReportLines(pulseOff.value, pulseOn.value)) log(l);
      else log(`  ${compareOutcomes(pulseOff, pulseOn)[0] ?? `skipped (${pulseOff.ok ? "" : pulseOff.skipped})`}`);

      const warOff = await runPositionalWar(supabase, league.id, settings, nflState, false);
      const warOn = await runPositionalWar(supabase, league.id, settings, nflState, true);
      log("  Positional WAR (off | on)");
      if (warOff.ok && warOn.ok) for (const l of curveReportLines(warOff.value, warOn.value)) log(l);
      else log(`  ${compareOutcomes(warOff, warOn)[0] ?? `skipped (${warOff.ok ? "" : warOff.skipped})`}`);
      // One side ran and the other did not: still show the curves that exist.
      if (warOff.ok !== warOn.ok) {
        const lines = curveReportLines(warOff.ok ? warOff.value : [], warOn.ok ? warOn.value : []);
        for (const l of lines) log(l);
      }

      const ledgerInputs = await loadLedgerInputs(supabase, league.id);
      log("  Manager Ledger");
      if (!ledgerInputs) {
        log("  league row not found");
      } else {
        const ledgerOff = runLedger(ledgerInputs, false);
        const ledgerOn = runLedger(ledgerInputs, true);
        if (ledgerOff.ok && ledgerOn.ok) for (const l of ledgerReportLines(ledgerOff.value, ledgerOn.value)) log(l);
        else log(`  off: ${ledgerOff.ok ? "graded" : ledgerOff.skipped}; on: ${ledgerOn.ok ? "graded" : ledgerOn.skipped}`);
      }
    } catch (err) {
      log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("");
  log(failures === 0 ? "RESULT: every sampled ordinary league is identical." : `RESULT: ${failures} ordinary league(s) differ or failed.`);
  if (outFile) writeFileSync(outFile, `${lines.join("\n")}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

const isRunDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isRunDirectly) {
  main().catch((err) => {
    console.error("[verify-idp-invariant] unexpected error:", err);
    process.exit(1);
  });
}
