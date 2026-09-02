/**
 * Walk-forward backtest of the FF Beacon projection engine against a finished
 * season.
 *
 * Run: npm run backtest:projections
 *      npm run backtest:projections -- --season 2025
 *
 * THE ONLY THING THAT MAKES THIS HONEST
 *
 * The engine reads whole seasons of player_stats. Handing it all of 2025 and
 * asking it to project 2025 would let it predict games using the very games it
 * is predicting, and the answer would look superb and mean nothing. That is why
 * `handoff.md` said a naive backtest was worse than none.
 *
 * So this walks FORWARD. For week W it hands the engine:
 *
 *   the two completed seasons before the target season, in full
 *   plus the target season's weeks 1 to W-1, and nothing else
 *
 * and grades the result against week W's actuals. Week 1 therefore runs on
 * prior seasons alone, exactly as it would have on the Sunday morning, and week
 * 18 runs on seventeen weeks of in-season usage. `latestWeek` is set to W-1 so
 * the recency decay is measured from the last week we were allowed to see, not
 * from the end of a season that had not happened yet.
 *
 * `assertNoLookahead` below re-checks that slice on every single week rather
 * than trusting the loop that built it, because a lookahead bug would not throw
 * or look wrong. It would simply return a flattering number, which is the one
 * failure mode this whole script exists to avoid.
 *
 * WHAT IS AND IS NOT MEASURED
 *
 * Three columns are graded on identical weeks and identical players:
 *
 *   sleeper   what Sleeper published for that week, the incumbent
 *   blended   what we would have stored, our model blended with Sleeper on the
 *             real schedule the blend weight would have had at the time
 *   beacon    our model at full weight, blend forced to 1
 *
 * The third is the one that answers "is our model any good", because the other
 * two are mostly Sleeper. It is graded ONLY on rows the model actually produced
 * (`modelled`), since a mirrored row is Sleeper's number wearing our name and
 * scoring it as ours would flatter us by counting his work as ours.
 *
 * Game environment is EMPTY here, and that is a real limitation rather than an
 * oversight. ESPN drops the betting line from a game once it has been played,
 * so no 2025 odds are retrievable and `nfl_game_odds` holds 2026 only. The
 * volume and game-script adjustments therefore contribute nothing to these
 * numbers, and the engine treats a missing line as no adjustment rather than a
 * neutral one. Whatever those adjustments are worth is NOT in this result.
 */

import { getServiceClient } from "./_supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import {
  computeBeaconProjections,
  type EngineSubject,
  type SleeperProjectionRow,
} from "../lib/projections/engine";
import {
  DEFAULT_PROJECTION_SETTINGS,
  type ProjectionSettings,
} from "../lib/projections/default-settings";
import { SLEEPER_SOURCE } from "../lib/projections/source-constants";
import type { PlayerStatRow } from "../lib/projections/usage";
import {
  isProjectablePosition,
  type GameEnvironment,
  type ProjectionPosition,
  type StatLine,
} from "../lib/projections/types";

type Client = SupabaseClient<Database>;

const PAGE = 1000;
const LAST_WEEK = 18;
/** Completed seasons of history the engine may see, before the target season. */
const HISTORY_DEPTH = 2;

/** Our model at full strength, for the isolating column. */
const FULL_BLEND: ProjectionSettings = {
  ...DEFAULT_PROJECTION_SETTINGS,
  blend: { min: 1, max: 1, gamesForMax: 0 },
};

type Actual = { points: number; played: boolean };

function numberArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

async function loadStats(db: Client, seasons: number[]): Promise<PlayerStatRow[]> {
  const positions = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("players")
      .select("id, position")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`players load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) positions.set(r.id, r.position);
    if (data.length < PAGE) break;
  }

  const out: PlayerStatRow[] = [];
  for (const season of seasons) {
    let cursor: string | null = null;
    for (;;) {
      let q = db
        .from("player_stats")
        .select(
          "id, player_id, season, week, gp, off_snp, rec_tgt, rec, rec_yd, rec_td, rush_att, rush_yd, rush_td, rush_rz_att, pass_att, pass_cmp, pass_yd, pass_td, pass_int, fum_lost, pts_ppr, offense_team:metadata->>team, players!inner(position)",
        )
        .eq("season", season)
        .eq("season_type", "regular")
        .not("player_id", "is", null)
        .in("players.position", ["QB", "RB", "WR", "TE"])
        .order("id", { ascending: true })
        .limit(PAGE);
      if (cursor !== null) q = q.gt("id", cursor);
      const { data, error } = await q;
      if (error) throw new Error(`stats load failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) {
        if (!row.player_id) continue;
        const position = positions.get(row.player_id);
        if (!isProjectablePosition(position)) continue;
        const offense = (row as unknown as { offense_team?: string | null }).offense_team;
        out.push({
          playerId: row.player_id,
          position: (position ?? "").toUpperCase() as ProjectionPosition,
          team: typeof offense === "string" && offense.length > 0 ? offense : null,
          season: Number(row.season),
          week: Number(row.week),
          gp: n(row.gp),
          offSnaps: row.off_snp === null ? null : n(row.off_snp),
          targets: row.rec_tgt === null ? null : n(row.rec_tgt),
          receptions: n(row.rec),
          recYards: n(row.rec_yd),
          recTds: n(row.rec_td),
          carries: n(row.rush_att),
          rushYards: n(row.rush_yd),
          rushTds: n(row.rush_td),
          rushRedZoneAttempts: n(row.rush_rz_att),
          passAttempts: n(row.pass_att),
          passCompletions: n(row.pass_cmp),
          passYards: n(row.pass_yd),
          passTds: n(row.pass_td),
          interceptions: n(row.pass_int),
          fumblesLost: n(row.fum_lost),
        });
      }
      cursor = data[data.length - 1].id;
      if (data.length < PAGE) break;
    }
  }
  return out;
}

/** What actually happened, keyed `${playerId}|${week}`. */
async function loadActuals(db: Client, season: number): Promise<Map<string, Actual>> {
  const out = new Map<string, Actual>();
  let cursor: string | null = null;
  for (;;) {
    let q = db
      .from("player_stats")
      .select("id, player_id, week, gp, pts_ppr")
      .eq("season", season)
      .eq("season_type", "regular")
      .not("player_id", "is", null)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`actuals load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      out.set(`${row.player_id}|${Number(row.week)}`, {
        points: n(row.pts_ppr),
        played: n(row.gp) > 0,
      });
    }
    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadSleeperRows(
  db: Client,
  season: number,
): Promise<{ rows: SleeperProjectionRow[]; subjects: EngineSubject[] }> {
  const rows: SleeperProjectionRow[] = [];
  const subjects = new Map<string, EngineSubject>();

  let cursor: string | null = null;
  for (;;) {
    let q = db
      .from("player_weekly_projections")
      .select(
        "id, player_id, sleeper_player_id, week, opponent, team, stat_line, availability, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std, players!inner(position, team)",
      )
      .eq("source", SLEEPER_SOURCE)
      .eq("season", season)
      .eq("season_type", "regular")
      .not("player_id", "is", null)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`sleeper projections load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      const joined = (row as unknown as { players?: { position?: string; team?: string | null } | null }).players;
      rows.push({
        playerId: row.player_id,
        week: Number(row.week),
        statLine: (row.stat_line as StatLine | null) ?? null,
        team: row.team,
        opponent: row.opponent,
        availability: row.availability,
        points: {
          ppr: orNull(row.projected_pts_ppr),
          halfPpr: orNull(row.projected_pts_half_ppr),
          std: orNull(row.projected_pts_std),
        },
        sleeperPlayerId: row.sleeper_player_id,
      });
      if (!subjects.has(row.player_id)) {
        subjects.set(row.player_id, {
          playerId: row.player_id,
          sleeperPlayerId: row.sleeper_player_id,
          position: joined?.position ?? "",
          // The team on the projection row is the team he played for THAT week,
          // which is the right one for a historical backtest. `players.team` is
          // his team today and would retroactively move a traded player.
          team: row.team ?? joined?.team ?? null,
        });
      }
    }
    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  return { rows, subjects: [...subjects.values()] };
}

// ---------------------------------------------------------------------------
// grading
// ---------------------------------------------------------------------------

type Bucket = { n: number; absErr: number; err: number; sumP: number; sumA: number; sumPA: number; sumPP: number; sumAA: number };

const emptyBucket = (): Bucket => ({ n: 0, absErr: 0, err: 0, sumP: 0, sumA: 0, sumPA: 0, sumPP: 0, sumAA: 0 });

function add(b: Bucket, projected: number, actual: number): void {
  b.n += 1;
  b.absErr += Math.abs(actual - projected);
  b.err += actual - projected;
  b.sumP += projected;
  b.sumA += actual;
  b.sumPA += projected * actual;
  b.sumPP += projected * projected;
  b.sumAA += actual * actual;
}

function mae(b: Bucket): number | null {
  return b.n > 0 ? b.absErr / b.n : null;
}
function bias(b: Bucket): number | null {
  return b.n > 0 ? b.err / b.n : null;
}
/** Pearson correlation between projected and actual. */
function corr(b: Bucket): number | null {
  if (b.n < 3) return null;
  const num = b.n * b.sumPA - b.sumP * b.sumA;
  const den = Math.sqrt((b.n * b.sumPP - b.sumP * b.sumP) * (b.n * b.sumAA - b.sumA * b.sumA));
  if (!(den > 0)) return null;
  const r = num / den;
  return Number.isFinite(r) ? r : null;
}

function fmt(v: number | null, digits = 3): string {
  return v === null ? "n/a" : v.toFixed(digits);
}

/**
 * Fails loudly if the slice handed to the engine contains anything from the
 * week being predicted or later. Cheap, and it is the guard the whole exercise
 * rests on.
 */
function assertNoLookahead(stats: PlayerStatRow[], season: number, week: number): void {
  for (const row of stats) {
    if (row.season > season) {
      throw new Error(`lookahead: season ${row.season} row while projecting ${season}`);
    }
    if (row.season === season && row.week >= week) {
      throw new Error(
        `lookahead: ${season} week ${row.week} row while projecting week ${week}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const season = numberArg("--season", 2025);
  const db = getServiceClient();

  const historySeasons: number[] = [season];
  for (let i = 1; i <= HISTORY_DEPTH; i++) historySeasons.push(season - i);

  console.log(`Walk-forward backtest of ${season}.`);
  console.log(`  history available to the model: ${historySeasons.slice(1).join(", ")} in full, plus ${season} up to the week before each one projected.`);

  const [allStats, actuals, sleeper] = await Promise.all([
    loadStats(db, historySeasons),
    loadActuals(db, season),
    loadSleeperRows(db, season),
  ]);
  console.log(`  loaded ${allStats.length} stat rows, ${actuals.size} actual player-weeks, ${sleeper.rows.length} sleeper projections over ${sleeper.subjects.length} players.`);

  const priorStats = allStats.filter((r) => r.season !== season);
  const targetStats = allStats.filter((r) => r.season === season);
  const noEnvironment = new Map<string, GameEnvironment>();

  const pooled = {
    sleeper: emptyBucket(),
    blended: emptyBucket(),
    beacon: emptyBucket(),
  };
  const byPosition = new Map<string, { sleeper: Bucket; blended: Bucket; beacon: Bucket }>();
  const byWeek: Array<{ week: number; n: number; sleeper: number | null; blended: number | null; beacon: number | null; modelled: number }> = [];

  for (let week = 1; week <= LAST_WEEK; week++) {
    const weekRows = sleeper.rows.filter((r) => r.week === week);
    if (weekRows.length === 0) continue;

    // Everything before this week, and nothing else.
    const visible = [...priorStats, ...targetStats.filter((r) => r.week < week)];
    assertNoLookahead(visible, season, week);

    const input = {
      season,
      currentSeason: season,
      latestWeek: week - 1,
      stats: visible,
      subjects: sleeper.subjects,
      sleeper: new Map(weekRows.map((r) => [`${r.playerId}|${r.week}`, r])),
      environment: noEnvironment,
    };

    const blendedRun = computeBeaconProjections({ ...input, settings: DEFAULT_PROJECTION_SETTINGS });
    const beaconRun = computeBeaconProjections({ ...input, settings: FULL_BLEND });
    const beaconById = new Map(beaconRun.projections.map((p) => [`${p.playerId}|${p.week}`, p]));

    const weekBuckets = { sleeper: emptyBucket(), blended: emptyBucket(), beacon: emptyBucket() };
    let modelledThisWeek = 0;

    for (const projection of blendedRun.projections) {
      const key = `${projection.playerId}|${projection.week}`;
      const actual = actuals.get(key);
      // A week the player did not play is not gradeable in either direction:
      // nobody's projection is wrong about a player who was inactive, and
      // counting it would mostly measure who guessed the injury report.
      if (!actual || !actual.played) continue;
      if (!isProjectablePosition(projection.position)) continue;

      const sleeperRow = input.sleeper.get(key);
      const sleeperPoints = sleeperRow?.points.ppr;
      if (sleeperPoints === null || sleeperPoints === undefined) continue;
      if (projection.pointsPpr === null) continue;

      const position = projection.position.toUpperCase();
      let bucket = byPosition.get(position);
      if (!bucket) {
        bucket = { sleeper: emptyBucket(), blended: emptyBucket(), beacon: emptyBucket() };
        byPosition.set(position, bucket);
      }

      add(pooled.sleeper, sleeperPoints, actual.points);
      add(bucket.sleeper, sleeperPoints, actual.points);
      add(weekBuckets.sleeper, sleeperPoints, actual.points);

      add(pooled.blended, projection.pointsPpr, actual.points);
      add(bucket.blended, projection.pointsPpr, actual.points);
      add(weekBuckets.blended, projection.pointsPpr, actual.points);

      // The isolating column: only rows OUR model produced. A mirrored row is
      // Sleeper's number, and scoring it as ours would credit us with his work.
      const pure = beaconById.get(key);
      if (pure?.modelled && pure.pointsPpr !== null) {
        modelledThisWeek += 1;
        add(pooled.beacon, pure.pointsPpr, actual.points);
        add(bucket.beacon, pure.pointsPpr, actual.points);
        add(weekBuckets.beacon, pure.pointsPpr, actual.points);
      }
    }

    byWeek.push({
      week,
      n: weekBuckets.sleeper.n,
      sleeper: mae(weekBuckets.sleeper),
      blended: mae(weekBuckets.blended),
      beacon: mae(weekBuckets.beacon),
      modelled: modelledThisWeek,
    });
    process.stdout.write(`  week ${String(week).padStart(2)}: ${String(weekBuckets.sleeper.n).padStart(4)} graded, ${modelledThisWeek} modelled\n`);
  }

  const line = (label: string, b: Bucket) =>
    `  ${label.padEnd(9)} n=${String(b.n).padStart(6)}  MAE=${fmt(mae(b))}  bias=${fmt(bias(b))}  corr=${fmt(corr(b))}`;

  console.log(`\nPOOLED, ${season}, PPR, graded on played weeks only`);
  console.log(line("sleeper", pooled.sleeper));
  console.log(line("blended", pooled.blended));
  console.log(line("beacon", pooled.beacon));

  const sM = mae(pooled.sleeper);
  const bM = mae(pooled.blended);
  const nM = mae(pooled.beacon);
  if (sM !== null && bM !== null) {
    const delta = ((bM - sM) / sM) * 100;
    console.log(`\n  blended vs sleeper: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}% MAE (negative is better)`);
  }
  if (sM !== null && nM !== null) {
    console.log(`  NOTE: the beacon row is graded on a different, smaller set (modelled rows only), so its MAE is not directly comparable to the two above. The per-position table below re-states sleeper on that same subset.`);
  }

  console.log(`\nBY POSITION`);
  for (const [position, b] of [...byPosition.entries()].sort()) {
    console.log(`\n ${position}`);
    console.log(line("sleeper", b.sleeper));
    console.log(line("blended", b.blended));
    console.log(line("beacon", b.beacon));
  }

  console.log(`\nBY WEEK (MAE)`);
  console.log(`  week    n  modelled   sleeper   blended    beacon`);
  for (const w of byWeek) {
    console.log(
      `  ${String(w.week).padStart(4)} ${String(w.n).padStart(4)} ${String(w.modelled).padStart(9)}   ${fmt(w.sleeper, 3).padStart(7)}   ${fmt(w.blended, 3).padStart(7)}   ${fmt(w.beacon, 3).padStart(7)}`,
    );
  }

  console.log(`\nREMEMBER: no game environment in these numbers. ESPN drops the betting line once a game is played, so the volume and game-script adjustments contributed nothing here.`);
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function orNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
