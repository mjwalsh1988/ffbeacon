/**
 * One week's performances, and the season's projection report. Pure.
 *
 * SPOTLIGHTS ARE FOUR DIFFERENT QUESTIONS, and the thresholds exist so each
 * list answers its own:
 *   best       who scored the most, full stop
 *   beats      who beat a REAL expectation by the most. A player projected for
 *              two points who scored nine did not beat anything worth naming.
 *   surprises  a big week from somebody nobody was starting: projected for
 *              little or not projected at all
 *   letdowns   a small week from somebody everybody was starting. Only a
 *              player who took the field: a late scratch is an availability
 *              story, and this list is about performance.
 *
 * A GRADED WEEK is one where the engine published a projection above zero AND
 * the player played, the same population lib/projection-scoreboard.ts grades.
 * A week he missed is not a miss by the projection.
 *
 * The projection graded is the engine's own published number (rawPoints from
 * lib/projections/read.ts), not our adjusted opinion of it, for the reason the
 * player profile gives: a beat or a miss is a statement about that number.
 */

import { OFFENSE_POSITIONS } from "@/lib/site";
import { pointsFor, rankDescending } from "./board";
import type {
  GradedWeek,
  PlayerRef,
  PositionGrade,
  ProjectionReport,
  ReliabilityRow,
  SeasonPosition,
  SeasonScoring,
  StatTotals,
  WeekPerformance,
  WeekSpotlights,
  WeekStatRow,
} from "./types";

/** The positions a spotlight names. Kickers and defenses score, but are not who a reader came to see. */
export const SPOTLIGHT_POSITIONS: readonly SeasonPosition[] = ["QB", "RB", "WR", "TE"];

export const SPOTLIGHT_SIZE = 6;
/** A "beat" is only a beat of a projection at least this large. */
export const BEAT_MIN_PROJECTION = 8;
/** A "surprise" was projected below this, or not at all. */
export const SURPRISE_MAX_PROJECTION = 6;
/** And scored at least this. */
export const SURPRISE_MIN_POINTS = 12;
/** A "letdown" was projected for at least this. */
export const LETDOWN_MIN_PROJECTION = 12;
/** Top scorers listed per position. */
export const TOP_PER_POSITION = 5;

/** Season reliability lists need this many graded weeks per player. */
export const RELIABILITY_MIN_GRADED = 2;
/** Beating a two-point projection every week is not reliability. */
export const RELIABLE_MIN_AVG_PROJECTION = 6;
/** The other list is only among players a manager was actually starting. */
export const UNRELIABLE_MIN_AVG_PROJECTION = 8;
export const RELIABILITY_SIZE = 8;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A box score as a sentence a screen reader can say: "24 of 33, 281 passing
 * yards, 3 TD, 1 INT; 5 carries, 32 rushing yards".
 */
export function statLine(position: SeasonPosition, stats: StatTotals): string {
  const s = (key: keyof StatTotals) => stats[key] ?? 0;
  const parts: string[] = [];

  const passing = () => {
    if (s("pass_att") <= 0) return;
    const bits = [`${s("pass_cmp")} of ${s("pass_att")}`, `${s("pass_yd")} passing yards`];
    if (s("pass_td")) bits.push(`${s("pass_td")} TD`);
    if (s("pass_int")) bits.push(`${s("pass_int")} INT`);
    parts.push(bits.join(", "));
  };
  const rushing = () => {
    if (s("rush_att") <= 0) return;
    const bits = [plural(s("rush_att"), "carry", "carries"), `${s("rush_yd")} rushing yards`];
    if (s("rush_td")) bits.push(`${s("rush_td")} TD`);
    parts.push(bits.join(", "));
  };
  const receiving = () => {
    if (s("rec_tgt") <= 0 && s("rec") <= 0 && s("rec_yd") === 0 && s("rec_td") === 0) return;
    const catches = plural(s("rec"), "catch", "catches");
    const bits = [
      s("rec_tgt") > 0 ? `${catches} on ${plural(s("rec_tgt"), "target", "targets")}` : catches,
      `${s("rec_yd")} receiving yards`,
    ];
    if (s("rec_td")) bits.push(`${s("rec_td")} TD`);
    parts.push(bits.join(", "));
  };

  if (position === "K") {
    const bits = [`${s("fgm")} of ${s("fga")} field goals`];
    if (s("xpm")) bits.push(plural(s("xpm"), "extra point", "extra points"));
    return bits.join(", ");
  }
  if (position === "DEF") {
    const bits = [`${s("pts_allow")} points allowed`];
    if (s("sack")) bits.push(plural(s("sack"), "sack", "sacks"));
    if (s("interceptions")) bits.push(plural(s("interceptions"), "interception", "interceptions"));
    if (s("def_td")) bits.push(`${s("def_td")} TD`);
    return bits.join(", ");
  }
  // Every phase a player touched, the one his position is known for first. A
  // receiver who threw a touchdown on a trick play has that pass in his line.
  const order =
    position === "QB"
      ? [passing, rushing, receiving]
      : position === "RB"
        ? [rushing, receiving, passing]
        : [receiving, rushing, passing];
  for (const phase of order) phase();
  if (s("fum_lost")) parts.push(plural(s("fum_lost"), "fumble lost", "fumbles lost"));
  return parts.join("; ") || "No counting stats recorded";
}

export type WeekReportInput = {
  week: number;
  scoring: SeasonScoring;
  /** Every row of that one week. */
  rows: readonly WeekStatRow[];
  players: ReadonlyMap<string, PlayerRef>;
  /** The published projection per player for that week. Absent means none. */
  projected: ReadonlyMap<string, number>;
};

/** Every performance of the week, ranked within its position. */
export function buildWeekPerformances(input: WeekReportInput): WeekPerformance[] {
  const scored: { row: WeekStatRow; ref: PlayerRef; points: number }[] = [];
  for (const row of input.rows) {
    if (row.week !== input.week) continue;
    const ref = input.players.get(row.playerId);
    if (!ref) continue;
    const points = pointsFor(row, input.scoring);
    if (points === null) continue;
    scored.push({ row, ref, points });
  }

  const out: WeekPerformance[] = [];
  for (const position of OFFENSE_POSITIONS) {
    const group = scored.filter((e) => e.ref.position === position);
    const ranks = rankDescending(group.map((e) => e.points));
    group.forEach((e, i) => {
      const projection = input.projected.get(e.row.playerId);
      const projected = projection !== undefined && projection > 0 ? round1(projection) : null;
      out.push({
        ...e.ref,
        week: input.week,
        gameTeam: e.row.team,
        opponent: e.row.opponent,
        points: e.points,
        weekRank: ranks[i],
        projected,
        diff: projected === null ? null : round1(e.points - projected),
        line: statLine(position, e.row.stats),
      });
    });
  }
  return out;
}

export function buildWeekSpotlights(week: number, performances: readonly WeekPerformance[]): WeekSpotlights {
  const skill = performances.filter((p) => SPOTLIGHT_POSITIONS.includes(p.position));
  const byPoints = (a: WeekPerformance, b: WeekPerformance) => b.points - a.points || a.name.localeCompare(b.name);

  const best = [...skill].sort(byPoints).slice(0, SPOTLIGHT_SIZE);

  const beats = skill
    .filter((p) => p.projected !== null && p.projected >= BEAT_MIN_PROJECTION && (p.diff ?? 0) > 0)
    .sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0) || byPoints(a, b))
    .slice(0, SPOTLIGHT_SIZE);

  const surprises = skill
    .filter(
      (p) => (p.projected === null || p.projected < SURPRISE_MAX_PROJECTION) && p.points >= SURPRISE_MIN_POINTS,
    )
    .sort(byPoints)
    .slice(0, SPOTLIGHT_SIZE);

  const letdowns = skill
    .filter((p) => p.projected !== null && p.projected >= LETDOWN_MIN_PROJECTION && (p.diff ?? 0) < 0)
    .sort((a, b) => (a.diff ?? 0) - (b.diff ?? 0) || byPoints(a, b))
    .slice(0, SPOTLIGHT_SIZE);

  const byPosition = Object.fromEntries(
    OFFENSE_POSITIONS.map((position) => [
      position,
      performances
        .filter((p) => p.position === position)
        .sort(byPoints)
        .slice(0, TOP_PER_POSITION),
    ]),
  ) as WeekSpotlights["byPosition"];

  return { week, best, beats, surprises, letdowns, byPosition };
}

/** Every graded week across the season: a projection above zero and a game played. */
export function gradeWeeks(
  rows: readonly WeekStatRow[],
  scoring: SeasonScoring,
  players: ReadonlyMap<string, PlayerRef>,
  /** Published projection keyed `${playerId}|${week}`. */
  projected: ReadonlyMap<string, number>,
  throughWeek: number,
): GradedWeek[] {
  const out: GradedWeek[] = [];
  for (const row of rows) {
    if (row.week < 1 || row.week > throughWeek) continue;
    const ref = players.get(row.playerId);
    if (!ref) continue;
    const projection = projected.get(`${row.playerId}|${row.week}`);
    if (projection === undefined || projection <= 0) continue;
    const actual = pointsFor(row, scoring);
    if (actual === null) continue;
    out.push({ playerId: row.playerId, week: row.week, position: ref.position, projected: projection, actual });
  }
  return out;
}

function grade(position: PositionGrade["position"], weeks: readonly GradedWeek[]): PositionGrade {
  if (weeks.length === 0) return { position, graded: 0, beatRate: null, averageMiss: null, lean: null };
  let beats = 0;
  let miss = 0;
  let lean = 0;
  for (const w of weeks) {
    if (w.actual >= w.projected) beats += 1;
    miss += Math.abs(w.actual - w.projected);
    lean += w.actual - w.projected;
  }
  return {
    position,
    graded: weeks.length,
    beatRate: round2(beats / weeks.length),
    averageMiss: round2(miss / weeks.length),
    lean: round2(lean / weeks.length),
  };
}

export function buildProjectionReport(
  graded: readonly GradedWeek[],
  players: ReadonlyMap<string, PlayerRef>,
  sourceName: string,
): ProjectionReport {
  const season: PositionGrade[] = [
    grade("ALL", graded),
    ...OFFENSE_POSITIONS.map((position) =>
      grade(
        position,
        graded.filter((w) => w.position === position),
      ),
    ),
  ];

  const weeks = [...new Set(graded.map((w) => w.week))].sort((a, b) => a - b);
  const byWeek = weeks.map((week) => {
    const g = grade(
      "ALL",
      graded.filter((w) => w.week === week),
    );
    return { week, graded: g.graded, beatRate: g.beatRate };
  });

  const byPlayer = new Map<string, GradedWeek[]>();
  for (const w of graded) {
    if (!SPOTLIGHT_POSITIONS.includes(w.position)) continue;
    byPlayer.set(w.playerId, [...(byPlayer.get(w.playerId) ?? []), w]);
  }
  const rows: ReliabilityRow[] = [];
  for (const [playerId, list] of byPlayer) {
    const ref = players.get(playerId);
    if (!ref || list.length < RELIABILITY_MIN_GRADED) continue;
    const projectedSum = list.reduce((sum, w) => sum + w.projected, 0);
    const diffSum = list.reduce((sum, w) => sum + (w.actual - w.projected), 0);
    rows.push({
      ...ref,
      graded: list.length,
      beats: list.filter((w) => w.actual >= w.projected).length,
      averageProjected: round1(projectedSum / list.length),
      averageDiff: round1(diffSum / list.length),
    });
  }
  const rate = (r: ReliabilityRow) => r.beats / r.graded;

  const mostReliable = rows
    .filter((r) => r.averageProjected >= RELIABLE_MIN_AVG_PROJECTION)
    .sort((a, b) => rate(b) - rate(a) || b.averageDiff - a.averageDiff || b.graded - a.graded)
    .slice(0, RELIABILITY_SIZE);
  const leastReliable = rows
    .filter((r) => r.averageProjected >= UNRELIABLE_MIN_AVG_PROJECTION)
    .sort((a, b) => rate(a) - rate(b) || a.averageDiff - b.averageDiff || b.graded - a.graded)
    .slice(0, RELIABILITY_SIZE);

  return { sourceName, season, byWeek, mostReliable, leastReliable };
}
