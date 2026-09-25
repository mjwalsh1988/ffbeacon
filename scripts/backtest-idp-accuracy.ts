/**
 * IDP accuracy backtest and opponent-split calibration (plan IDP-402, IDP-403).
 *
 * Two questions, both answered from stored history, 2020 to 2025.
 *
 * 1. IS SLEEPER'S DEFENDER PROJECTION ANY GOOD? For every regular-season week a
 *    DL, LB or DB played, his projected idp123 points against what he scored,
 *    beside a naive forecast: the average of his last four played weeks that
 *    season (at least two). Both forecasts are graded on the SAME weeks, so a
 *    week one of them cannot forecast is dropped for both. Reported per
 *    position: correlation, mean absolute error, bias, and how often each was
 *    closer. A position where the projection loses to the naive average on
 *    both correlation and error is flagged; the plan says such a position ships
 *    with positionReliability 0.
 *
 * 2. DOES A DEFENSE'S IDP MATCHUP NUMBER REPEAT? The existing calibration for
 *    the six offensive positions (lib/power-pulse/default-settings.ts,
 *    PE-T016): for each position, correlate every team's multiplier in one
 *    season with the same team's multiplier the next, raw and opponent
 *    adjusted, over the two most recent season pairs; the mean of those four,
 *    floored at zero and rounded to two places, is the reliability. The
 *    multipliers come from computeSeasonSplits, the same function the nightly
 *    splits calc stores, and the script checks its figures against the stored
 *    rows for the seasons that have them. Older pairs are printed as context.
 *
 * READ ONLY. No write of any kind, and no Sleeper request.
 *
 * Run:
 *   npm run backtest:idp
 *   npm run backtest:idp -- --out docs/idp/idp-accuracy-backtest.txt
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { getServiceClient, withRetry } from "./_supabase";
import { fetchAllRows } from "../lib/supabase/fetch-all";
import { IDP_POSITIONS, isDefender } from "../lib/site";
import { projectedIdp123 } from "../lib/calculate-projection-accuracy";
import {
  computeSeasonSplits,
  loadSeasonStats,
  type StatRow,
} from "../lib/calculate-defense-splits";

type ServiceClient = SupabaseClient<Database>;

const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025] as const;
/** Naive forecast: the average of up to this many prior played weeks. */
export const NAIVE_WINDOW = 4;
/** And at least this many, or the week is not graded. */
export const NAIVE_MIN_WEEKS = 2;
/** "Starter level": either forecast at or above this many idp123 points. */
export const STARTER_THRESHOLD = 6;

// ---------------------------------------------------------------------------
// Pure parts (tested in backtest-idp-accuracy.test.ts)
// ---------------------------------------------------------------------------

/** Pearson correlation, or null with fewer than three pairs or no spread. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

export type PlayedWeek = { week: number; points: number };

/**
 * The naive forecast for each played week: the mean of the player's previous
 * NAIVE_WINDOW played weeks that season, or null with fewer than
 * NAIVE_MIN_WEEKS of them. Input in any order; output keyed by week.
 */
export function naiveForecasts(weeks: readonly PlayedWeek[]): Map<number, number | null> {
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  const out = new Map<number, number | null>();
  for (let i = 0; i < sorted.length; i += 1) {
    const prior = sorted.slice(Math.max(0, i - NAIVE_WINDOW), i);
    out.set(
      sorted[i].week,
      prior.length < NAIVE_MIN_WEEKS ? null : prior.reduce((sum, w) => sum + w.points, 0) / prior.length,
    );
  }
  return out;
}

export type GradedWeek = { actual: number; projected: number; naive: number };

export type ForecastSummary = {
  weeks: number;
  projectedR: number | null;
  naiveR: number | null;
  projectedMae: number;
  naiveMae: number;
  /** mean(actual - forecast); positive means the forecast ran low. */
  projectedBias: number;
  naiveBias: number;
  /** Share of weeks where the projection was strictly closer than the naive average. */
  projectedCloserShare: number;
  /** True when the projection loses on both correlation and error. */
  worseThanNaive: boolean;
};

export function summarize(rows: readonly GradedWeek[]): ForecastSummary | null {
  if (rows.length === 0) return null;
  const actual = rows.map((r) => r.actual);
  const projected = rows.map((r) => r.projected);
  const naive = rows.map((r) => r.naive);
  let pErr = 0;
  let nErr = 0;
  let pBias = 0;
  let nBias = 0;
  let closer = 0;
  for (const r of rows) {
    const pe = Math.abs(r.actual - r.projected);
    const ne = Math.abs(r.actual - r.naive);
    pErr += pe;
    nErr += ne;
    pBias += r.actual - r.projected;
    nBias += r.actual - r.naive;
    if (pe < ne) closer += 1;
  }
  const n = rows.length;
  const projectedR = pearson(projected, actual);
  const naiveR = pearson(naive, actual);
  const projectedMae = pErr / n;
  const naiveMae = nErr / n;
  return {
    weeks: n,
    projectedR,
    naiveR,
    projectedMae,
    naiveMae,
    projectedBias: pBias / n,
    naiveBias: nBias / n,
    projectedCloserShare: closer / n,
    worseThanNaive:
      projectedMae > naiveMae && (projectedR ?? -Infinity) < (naiveR ?? -Infinity),
  };
}

/**
 * The plan's reliability figure from its four year-over-year correlations:
 * the mean of those present, floored at zero, rounded to two places. Null when
 * none could be measured.
 */
export function reliabilityFrom(correlations: ReadonlyArray<number | null>): number | null {
  const present = correlations.filter((c): c is number => c !== null && Number.isFinite(c));
  if (present.length === 0) return null;
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  return Math.round(Math.max(0, mean) * 100) / 100;
}

/** Correlate one season's team multipliers with the next season's, by team. */
export function yearOverYear(
  earlier: ReadonlyMap<string, number>,
  later: ReadonlyMap<string, number>,
): { teams: number; r: number | null } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [team, value] of earlier) {
    const next = later.get(team);
    if (next === undefined) continue;
    xs.push(value);
    ys.push(next);
  }
  return { teams: xs.length, r: pearson(xs, ys) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type ProjectionRow = { playerId: string; week: number; points: number | null };

async function loadDefenderProjections(
  supabase: ServiceClient,
  season: number,
  defenderIds: ReadonlySet<string>,
): Promise<ProjectionRow[]> {
  const out: ProjectionRow[] = [];
  // Keyset paging on id: a deep offset over a 30,000-row season with a jsonb
  // column is what times out.
  for (let lastId = ""; ; ) {
    const { data, error } = await withRetry(
      async () =>
        await supabase
          .from("player_weekly_projections")
          .select("id, player_id, week, stat_line")
          .eq("source", "sleeper")
          .eq("season", season)
          .eq("season_type", "regular")
          .gt("id", lastId || "00000000-0000-0000-0000-000000000000")
          .order("id", { ascending: true })
          .limit(1000),
      { label: `projections ${season} after ${lastId}` },
    );
    if (error) throw new Error(`projections ${season}: ${error.message}`);
    if (!data || data.length === 0) break;
    lastId = data[data.length - 1].id;
    for (const row of data) {
      if (!row.player_id || !defenderIds.has(row.player_id)) continue;
      out.push({ playerId: row.player_id, week: Number(row.week), points: projectedIdp123(row.stat_line) });
    }
    if (data.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const fmt = (value: number | null, digits = 3): string => (value === null ? "n/a" : value.toFixed(digits));

function summaryLines(label: string, s: ForecastSummary | null): string[] {
  if (!s) return [`  ${label}: no graded weeks`];
  return [
    `  ${label}: ${s.weeks} weeks`,
    `    correlation   projection ${fmt(s.projectedR)}   naive ${fmt(s.naiveR)}`,
    `    mean error    projection ${fmt(s.projectedMae, 2)}   naive ${fmt(s.naiveMae, 2)} points`,
    `    bias          projection ${fmt(s.projectedBias, 2)}   naive ${fmt(s.naiveBias, 2)} points (actual minus forecast)`,
    `    projection closer in ${(s.projectedCloserShare * 100).toFixed(1)} percent of weeks`,
    `    verdict: ${s.worseThanNaive ? "WORSE THAN NAIVE on both correlation and error" : "not worse than naive"}`,
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

  const supabase = getServiceClient();
  const lines: string[] = [];
  const say = (line = "") => {
    lines.push(line);
    console.log(line);
  };

  const players = await fetchAllRows("defender players", (from, to) =>
    supabase
      .from("players")
      .select("id, position")
      .in("position", [...IDP_POSITIONS])
      .order("id", { ascending: true })
      .range(from, to),
  );
  const positionOf = new Map(players.map((p) => [p.id, p.position as string]));
  const defenderIds = new Set(positionOf.keys());

  say("IDP accuracy backtest and opponent-split calibration (IDP-402, IDP-403)");
  say(`Run ${new Date().toISOString()}. Seasons ${SEASONS[0]} to ${SEASONS[SEASONS.length - 1]}, regular season, Sleeper projections, idp123.`);
  say(`Defenders by today's primary position: ${defenderIds.size}.`);
  say(
    `Naive forecast: average of the previous ${NAIVE_WINDOW} played weeks that season, at least ${NAIVE_MIN_WEEKS}. Starter level: either forecast at least ${STARTER_THRESHOLD} points.`,
  );
  say();

  const graded = new Map<string, GradedWeek[]>(); // `${position}|${season}`
  const splitsBySeason = new Map<number, Map<string, { raw: Map<string, number>; adj: Map<string, number> }>>();

  for (const season of SEASONS) {
    const [stats, projections] = await Promise.all([
      loadSeasonStats(supabase, season),
      loadDefenderProjections(supabase, season, defenderIds),
    ]);

    // Calibration: the stored function over every row of the season.
    const byPosition = new Map<string, { raw: Map<string, number>; adj: Map<string, number> }>();
    for (const split of computeSeasonSplits(stats, "idp123")) {
      const entry = byPosition.get(split.position) ?? { raw: new Map(), adj: new Map() };
      entry.raw.set(split.team, split.multiplier);
      entry.adj.set(split.team, split.adjustedMultiplier);
      byPosition.set(split.position, entry);
    }
    splitsBySeason.set(season, byPosition);

    // Accuracy: played defender weeks, by player.
    const playedByPlayer = new Map<string, PlayedWeek[]>();
    for (const row of stats as StatRow[]) {
      if (!row.player_id || !defenderIds.has(row.player_id)) continue;
      if (!row.gp || row.gp <= 0) continue;
      const list = playedByPlayer.get(row.player_id) ?? [];
      list.push({ week: row.week, points: row.idp123 ?? 0 });
      playedByPlayer.set(row.player_id, list);
    }
    const projectedByKey = new Map<string, number>();
    for (const p of projections) {
      if (p.points !== null) projectedByKey.set(`${p.playerId}|${p.week}`, p.points);
    }
    let seasonGraded = 0;
    for (const [playerId, weeks] of playedByPlayer) {
      const position = positionOf.get(playerId);
      if (!position || !isDefender(position)) continue;
      const naive = naiveForecasts(weeks);
      for (const w of weeks) {
        const projected = projectedByKey.get(`${playerId}|${w.week}`);
        const naiveValue = naive.get(w.week);
        if (projected === undefined || naiveValue === null || naiveValue === undefined) continue;
        const key = `${position}|${season}`;
        const list = graded.get(key) ?? [];
        list.push({ actual: w.points, projected, naive: naiveValue });
        graded.set(key, list);
        seasonGraded += 1;
      }
    }
    console.log(`  ${season}: ${stats.length} stat rows, ${projections.length} defender projections, ${seasonGraded} graded weeks`);
  }

  // ---- Part 1: accuracy ---------------------------------------------------
  say("PART 1. PROJECTION AGAINST A NAIVE LAST-FOUR-WEEKS AVERAGE");
  say();
  const verdicts = new Map<string, boolean>();
  for (const position of IDP_POSITIONS) {
    const all: GradedWeek[] = [];
    for (const season of SEASONS) all.push(...(graded.get(`${position}|${season}`) ?? []));
    const starters = all.filter((g) => g.projected >= STARTER_THRESHOLD || g.naive >= STARTER_THRESHOLD);
    const allSummary = summarize(all);
    const starterSummary = summarize(starters);
    verdicts.set(position, starterSummary?.worseThanNaive ?? true);
    say(`${position}, 2020 to 2025 pooled`);
    for (const line of summaryLines("every graded week", allSummary)) say(line);
    for (const line of summaryLines("starter level", starterSummary)) say(line);
    say("  by season, starter level (weeks, correlation projection / naive, error projection / naive):");
    for (const season of SEASONS) {
      const s = summarize(
        (graded.get(`${position}|${season}`) ?? []).filter(
          (g) => g.projected >= STARTER_THRESHOLD || g.naive >= STARTER_THRESHOLD,
        ),
      );
      say(
        s
          ? `    ${season}: ${s.weeks}, ${fmt(s.projectedR)} / ${fmt(s.naiveR)}, ${fmt(s.projectedMae, 2)} / ${fmt(s.naiveMae, 2)}${s.worseThanNaive ? "  WORSE" : ""}`
          : `    ${season}: no graded weeks`,
      );
    }
    say();
  }

  // ---- Part 2: calibration ------------------------------------------------
  say("PART 2. DOES A DEFENSE'S IDP MATCHUP NUMBER REPEAT NEXT SEASON");
  say("Year-over-year correlation of each team's multiplier, raw and opponent adjusted.");
  say();

  // Sanity: our figures against the stored rows, where they exist.
  const { data: stored, error: storedError } = await supabase
    .from("nfl_defense_vs_position")
    .select("team, season, position, multiplier, adjusted_multiplier")
    .eq("scoring", "idp123")
    .in("position", [...IDP_POSITIONS]);
  if (storedError) throw new Error(`stored splits: ${storedError.message}`);
  let compared = 0;
  let maxDiff = 0;
  for (const row of stored ?? []) {
    const ours = splitsBySeason.get(row.season)?.get(row.position);
    const raw = ours?.raw.get(row.team);
    const adj = ours?.adj.get(row.team);
    if (raw === undefined || adj === undefined) continue;
    compared += 1;
    maxDiff = Math.max(
      maxDiff,
      Math.abs(raw - Number(row.multiplier)),
      Math.abs(adj - Number(row.adjusted_multiplier)),
    );
  }
  say(
    `Check against the stored table: ${compared} of ${stored?.length ?? 0} stored defender rows matched, largest difference ${maxDiff.toFixed(4)} (the table rounds to four places, and a later stats correction since the nightly run can move a figure).`,
  );
  say();

  const recommended: Record<string, number | null> = {};
  for (const position of IDP_POSITIONS) {
    say(`${position}`);
    const pairCorrelations: Array<number | null> = [];
    for (let i = SEASONS.length - 1; i >= 1; i -= 1) {
      const later = SEASONS[i];
      const earlier = SEASONS[i - 1];
      const a = splitsBySeason.get(earlier)?.get(position);
      const b = splitsBySeason.get(later)?.get(position);
      if (!a || !b) {
        say(`  ${later}/${earlier}: not measurable`);
        continue;
      }
      const raw = yearOverYear(a.raw, b.raw);
      const adj = yearOverYear(a.adj, b.adj);
      const recent = i >= SEASONS.length - 2;
      if (recent) pairCorrelations.push(raw.r, adj.r);
      say(
        `  ${later}/${earlier}: raw ${fmt(raw.r)}, adjusted ${fmt(adj.r)} over ${raw.teams} teams${recent ? "  (counts toward the figure)" : "  (context)"}`,
      );
    }
    const reliability = reliabilityFrom(pairCorrelations);
    recommended[position] = verdicts.get(position) ? 0 : reliability;
    say(
      `  measured reliability (mean of the four recent figures, floored at zero): ${fmt(reliability, 2)}`,
    );
    if (verdicts.get(position)) {
      say("  projection is worse than naive at starter level, so the plan ships this position at 0.");
    }
    say();
  }

  say("RECOMMENDED positionReliability (IDP-403), not saved by this script:");
  for (const position of IDP_POSITIONS) say(`  ${position}: ${fmt(recommended[position], 2)}`);
  say("With 32 teams the standard error on any one correlation is about 0.18, as the offensive calibration notes.");

  if (outPath) {
    writeFileSync(outPath, `${lines.join("\n")}\n`);
    console.log(`\nWritten to ${outPath}`);
  }
}

const isRunDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isRunDirectly) {
  main().catch((err) => {
    console.error("[backtest-idp-accuracy] unexpected error:", err);
    process.exit(1);
  });
}
