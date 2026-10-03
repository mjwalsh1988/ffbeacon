/**
 * The season leaders board: every player's season to date, ranked at his
 * position. Pure, clock-free, no database.
 *
 * THE RANK IS THE ONE THE PLAYER PROFILE SHOWS. A positional rank here is the
 * rank within a position by total fantasy points across the regular season to
 * date, with ties sharing a rank and the next rank skipped. That is the
 * `rank()` in rebuild_positional_finishes (migration 0298), which fills
 * player_positional_finishes, the table a profile reads. Two pages naming two
 * different ranks for one player with nothing to say which is right is the
 * thing this comment exists to prevent; board.test.ts holds the rule.
 *
 * It is computed here rather than read from that table for two reasons. The
 * table knows three scoring bases and no tight end premium, and a premium
 * reorders tight ends. And every other figure on the board (per game, the week
 * by week grid, starter weeks) needs the weekly rows anyway, so reading one
 * source for all of it means the total, the rank and the weeks can never
 * disagree with each other.
 *
 * A NULL WEEK IS NOT A ZERO. A week a player did not play is null in `weeks`,
 * is not counted in `games`, and never lowers a per-game figure.
 *
 * THE LIVE WEEK COUNTS TOWARD POINTS AND NOT TOWARD FINISHES. Points scored in
 * a week still being played are real and are in the totals. A positional
 * finish for that week does not exist until every game is in, so `weekRanks`
 * is null for it and it can never be a starter week.
 */

import { scoreWithFallback, type FormatScoringInput, type ScoringSettings } from "@/lib/league-scoring";
import { OFFENSE_POSITIONS } from "@/lib/site";
import type {
  BoardPlayer,
  PlayerRef,
  SeasonBoard,
  SeasonPosition,
  SeasonScoring,
  StatKey,
  StatTotals,
  WeekStatRow,
} from "./types";

/**
 * How deep the starting range runs at each position: one starter a team at
 * quarterback, tight end, kicker and defense in a twelve-team league, two at
 * running back and wide receiver. A week inside it is a week a manager was
 * glad to have started him.
 */
export const STARTER_RANGE: Record<SeasonPosition, number> = {
  QB: 12,
  RB: 24,
  WR: 24,
  TE: 12,
  K: 12,
  DEF: 12,
};

/**
 * A player is ranked per game only after playing at least this share of the
 * completed weeks. Without it one long touchdown in a single appearance tops
 * the per-game list in October.
 */
export const PER_GAME_MIN_SHARE = 0.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

const SCORING_LABEL: Record<SeasonScoring["base"], string> = {
  pts_ppr: "PPR",
  pts_half_ppr: "Half PPR",
  pts_std: "Standard",
};

/** The scoring half of a format row: which stored column, and the TE premium. */
export function scoringFor(format: FormatScoringInput): SeasonScoring {
  const base: SeasonScoring["base"] =
    format.scoring_type === "ppr" ? "pts_ppr" : format.scoring_type === "half_ppr" ? "pts_half_ppr" : "pts_std";
  const tePremium = format.te_premium_bonus && format.te_premium_bonus > 0 ? Number(format.te_premium_bonus) : 0;
  return {
    base,
    tePremium,
    label: tePremium > 0 ? `${SCORING_LABEL[base]} with TE premium` : SCORING_LABEL[base],
    key: `${base}|${tePremium}`,
  };
}

/** The same scoring as a settings map, for the shared scorer and the projection read. */
export function scoringSettingsOf(scoring: SeasonScoring): ScoringSettings {
  const rec = scoring.base === "pts_ppr" ? 1 : scoring.base === "pts_half_ppr" ? 0.5 : 0;
  const settings: ScoringSettings = { rec };
  if (scoring.tePremium > 0) settings.bonus_rec_te = scoring.tePremium;
  return settings;
}

/**
 * A row's fantasy points in the reader's scoring, through the one shared
 * scorer so a tight end premium is applied here exactly as it is everywhere
 * else on the site. Null when the stored column is null.
 */
export function pointsFor(row: WeekStatRow, scoring: SeasonScoring): number | null {
  const { points } = scoreWithFallback(
    { rec: row.stats.rec ?? 0 },
    { ppr: row.ppr, half_ppr: row.half, std: row.std },
    scoringSettingsOf(scoring),
    row.position,
  );
  return points === null ? null : round2(points);
}

/**
 * Rank items by a figure, highest first, ties sharing a rank and the next rank
 * skipped (1, 2, 2, 4). Returns the rank for each item in input order.
 */
export function rankDescending(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const ranks = new Array<number>(values.length);
  let rank = 0;
  let previous: number | null = null;
  order.forEach((entry, position) => {
    if (previous === null || entry.v !== previous) rank = position + 1;
    ranks[entry.i] = rank;
    previous = entry.v;
  });
  return ranks;
}

function addStats(into: StatTotals, from: StatTotals): void {
  for (const [key, value] of Object.entries(from) as [StatKey, number][]) {
    if (!value) continue;
    into[key] = (into[key] ?? 0) + value;
  }
}

export type BuildBoardInput = {
  season: number;
  throughWeek: number;
  lastCompletedWeek: number;
  scoring: SeasonScoring;
  rows: readonly WeekStatRow[];
  players: ReadonlyMap<string, PlayerRef>;
  computedAt: string;
};

export function buildSeasonBoard(input: BuildBoardInput): SeasonBoard {
  const { throughWeek, scoring } = input;
  const weekCount = Math.max(0, throughWeek);

  type Working = {
    ref: PlayerRef;
    weeks: (number | null)[];
    weekRanks: (number | null)[];
    stats: StatTotals;
    snapSum: number;
    snapWeeks: number;
    targets: number;
    teamTargets: number;
    lastTeam: string | null;
    lastTeamWeek: number;
  };

  // Team targets per week, for a target share the stored column does not carry.
  const teamTargets = new Map<string, number>();
  for (const row of input.rows) {
    const targets = row.stats.rec_tgt ?? 0;
    if (!row.team || targets <= 0) continue;
    const key = `${row.week}|${row.team}`;
    teamTargets.set(key, (teamTargets.get(key) ?? 0) + targets);
  }

  const working = new Map<string, Working>();
  // Per week, per position: who scored what, for the weekly finish.
  const weekScores = new Map<string, { playerId: string; points: number }[]>();

  for (const row of input.rows) {
    if (row.week < 1 || row.week > weekCount) continue;
    const ref = input.players.get(row.playerId);
    if (!ref) continue;
    const points = pointsFor(row, scoring);
    if (points === null) continue;

    let entry = working.get(row.playerId);
    if (!entry) {
      entry = {
        ref,
        weeks: new Array<number | null>(weekCount).fill(null),
        weekRanks: new Array<number | null>(weekCount).fill(null),
        stats: {},
        snapSum: 0,
        snapWeeks: 0,
        targets: 0,
        teamTargets: 0,
        lastTeam: null,
        lastTeamWeek: 0,
      };
      working.set(row.playerId, entry);
    }
    entry.weeks[row.week - 1] = points;
    addStats(entry.stats, row.stats);
    if (row.snapPct !== null) {
      entry.snapSum += row.snapPct;
      entry.snapWeeks += 1;
    }
    const total = row.team ? teamTargets.get(`${row.week}|${row.team}`) : undefined;
    if (total && total > 0) {
      entry.targets += row.stats.rec_tgt ?? 0;
      entry.teamTargets += total;
    }
    if (row.team && row.week >= entry.lastTeamWeek) {
      entry.lastTeam = row.team;
      entry.lastTeamWeek = row.week;
    }

    const key = `${row.week}|${ref.position}`;
    const list = weekScores.get(key) ?? [];
    list.push({ playerId: row.playerId, points });
    weekScores.set(key, list);
  }

  for (const [key, list] of weekScores) {
    const week = Number(key.split("|")[0]);
    // A week still being played has no finishes yet. Ranking Thursday's two
    // teams against nobody would make every running back in that game a top
    // 24 finisher and hand each of them a starter week.
    if (week > input.lastCompletedWeek) continue;
    const ranks = rankDescending(list.map((e) => e.points));
    list.forEach((e, i) => {
      const entry = working.get(e.playerId);
      if (entry) entry.weekRanks[week - 1] = ranks[i];
    });
  }

  const minGames = Math.max(1, Math.ceil(Math.max(1, input.lastCompletedWeek) * PER_GAME_MIN_SHARE));
  const rankedByPosition = Object.fromEntries(OFFENSE_POSITIONS.map((p) => [p, 0])) as Record<SeasonPosition, number>;
  const players: BoardPlayer[] = [];

  for (const position of OFFENSE_POSITIONS) {
    const group = [...working.values()].filter((w) => w.ref.position === position);
    const totals = group.map((w) => round2(w.weeks.reduce<number>((sum, p) => sum + (p ?? 0), 0)));
    const ranks = rankDescending(totals);

    const built = group.map((w, i): BoardPlayer => {
      const played = w.weeks.filter((p): p is number => p !== null);
      const games = played.length;
      const starterRange = STARTER_RANGE[position];
      return {
        ...w.ref,
        // The team he most recently played for, which is the right logo for a
        // season line; today's team is the fallback for a row with no team.
        team: w.lastTeam ?? w.ref.team,
        weeks: w.weeks,
        weekRanks: w.weekRanks,
        total: totals[i],
        games,
        perGame: games > 0 ? round2(totals[i] / games) : null,
        rank: ranks[i],
        perGameRank: null,
        starterWeeks: w.weekRanks.filter((r) => r !== null && r <= starterRange).length,
        best: games > 0 ? Math.max(...played) : null,
        worst: games > 0 ? Math.min(...played) : null,
        stats: w.stats,
        snapPct: w.snapWeeks > 0 ? round2((w.snapSum / w.snapWeeks) * 100) : null,
        targetShare: w.teamTargets > 0 ? round2((w.targets / w.teamTargets) * 100) : null,
      };
    });

    const qualified = built.filter((p) => p.games >= minGames && p.perGame !== null);
    const perGameRanks = rankDescending(qualified.map((p) => p.perGame as number));
    qualified.forEach((p, i) => {
      p.perGameRank = perGameRanks[i];
    });

    built.sort((a, b) => a.rank - b.rank || b.games - a.games || a.name.localeCompare(b.name));
    rankedByPosition[position] = built.length;
    players.push(...built);
  }

  return {
    season: input.season,
    throughWeek: input.throughWeek,
    lastCompletedWeek: input.lastCompletedWeek,
    scoring,
    players,
    rankedByPosition,
    computedAt: input.computedAt,
  };
}

/**
 * The first N players at each position, for a page that does not ship the
 * whole board to the browser.
 */
export function trimBoard(board: SeasonBoard, perPosition: Record<SeasonPosition, number>): SeasonBoard {
  const seen = Object.fromEntries(OFFENSE_POSITIONS.map((p) => [p, 0])) as Record<SeasonPosition, number>;
  const players = board.players.filter((p) => {
    seen[p.position] += 1;
    return seen[p.position] <= perPosition[p.position];
  });
  return { ...board, players };
}
