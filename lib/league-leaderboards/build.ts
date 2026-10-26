/**
 * Every Leaderboards list, from plain data. Pure.
 *
 * The rules this module carries are stated once, in ./types.ts. In short:
 * every player who played a settled week is on the board, his owner each week
 * is read off that week's matchup rows (no roster means a free agent), a
 * rostered week uses the points Sleeper credited and a free agent week is
 * scored from his stat line under the league's own settings.
 *
 * ONE PASS, THEN SORTS. Each (player, week) is decided once into a cell, and
 * every list below is a sum or a sort over those cells. Nothing is scored
 * twice and no list can disagree with another about the same player-week.
 */

import { isUsableScoring, scoreActualLine, type ScoringSettings } from "@/lib/league-scoring";
import type {
  GameResult,
  LeaderboardPlayer,
  LeaderboardPosition,
  LeaderboardTeam,
  LeaderboardsView,
  OwnershipWeek,
  PlayerLeader,
  PlayerWeekLeader,
  TeamTotal,
  TeamWeekScore,
  TopTierCutoff,
  TopTierRow,
} from "./types";

/** How long each list runs. The page shows fewer; the rest is one tap away. */
export const BOARD_DEPTH = 25;
export const UNOWNED_DEPTH = 15;
export const WEEK_LIST_DEPTH = 10;
export const TEAM_LIST_DEPTH = 5;

/** One roster in one settled week, as lib/manager-ledger/load.ts reads it. */
export type SettledRosterWeek = {
  week: number;
  sleeperRosterId: number;
  officialPoints: number;
  /** Points for every player on the roster that week, bench included. */
  playerPoints: Map<string, number>;
  /** Players in a starting slot that week. */
  startedIds: Set<string>;
  opponentRosterId: number | null;
  /** On injured reserve or the taxi squad: could not have been started. */
  ineligibleIds?: ReadonlySet<string>;
};

/** One player's actual line for one week. */
export type WeekStatLine = {
  sleeperId: string;
  stats: Record<string, number>;
};

export type LeaderboardInput = {
  season: number;
  weeks: SettledRosterWeek[];
  /** Stat lines for every player who played, keyed by week. */
  statLines: Map<number, WeekStatLine[]>;
  /** Every player either list mentions, keyed by Sleeper id. */
  players: Map<string, LeaderboardPlayer>;
  teams: LeaderboardTeam[];
  /** Who holds each player today, Sleeper id to roster. */
  currentRosters: Map<string, number>;
  scoring: ScoringSettings;
  /** Positions this league starts, in display order. */
  positions: LeaderboardPosition[];
  /** Starting slots that take ONE position only, per position. Flex slots are not in here. */
  dedicatedSlots: Partial<Record<LeaderboardPosition, number>>;
  /** First playoff week, or null when the league runs no bracket. */
  playoffWeekStart: number | null;
  bestBall: boolean;
  /** One week, or null for the whole season. */
  week: number | null;
};

const round = (n: number) => Math.round(n * 100) / 100;

/** A player in one week: what he scored, and for whom. */
type Cell = {
  points: number;
  played: boolean;
  rosterId: number | null;
  started: boolean;
  /** Sat on the bench and could have started (not on IR or the taxi squad). */
  benchable: boolean;
};

/** Rank a sorted list, ties sharing a rank (1, 2, 2, 4). */
function withRanks<T>(sorted: T[], value: (item: T) => number): { item: T; rank: number }[] {
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((item, index) => {
    const v = round(value(item));
    if (previous === null || v !== previous) rank = index + 1;
    previous = v;
    return { item, rank };
  });
}

export function buildLeaderboards(input: LeaderboardInput): LeaderboardsView {
  const settledWeeks = [...new Set(input.weeks.map((w) => w.week))].sort((a, b) => a - b);
  const week = input.week !== null && settledWeeks.includes(input.week) ? input.week : null;
  const scope = week !== null ? [week] : settledWeeks;
  const inScope = new Set(scope);
  const isPlayoff = (w: number) => input.playoffWeekStart !== null && w >= input.playoffWeekStart;
  const allowed = new Set<string>(input.positions);
  // A league whose stored scoring is unusable has no rule to score a free agent
  // under. Its rostered weeks still count, on Sleeper's own figures.
  const scoresFreeAgents = isUsableScoring(input.scoring);

  // Who held whom, and what he scored for them, per week.
  const owned = new Map<
    number,
    Map<string, { rosterId: number; points: number; started: boolean; benchable: boolean }>
  >();
  for (const row of input.weeks) {
    if (!inScope.has(row.week)) continue;
    const byPlayer = owned.get(row.week) ?? new Map();
    owned.set(row.week, byPlayer);
    for (const [sid, points] of row.playerPoints) {
      const started = row.startedIds.has(sid);
      byPlayer.set(sid, {
        rosterId: row.sleeperRosterId,
        points,
        started,
        benchable: !started && !(row.ineligibleIds?.has(sid) ?? false),
      });
    }
  }

  // Every (player, week) in scope, decided once.
  const cells = new Map<string, Map<number, Cell>>();
  const put = (sid: string, w: number, cell: Cell) => {
    const byWeek = cells.get(sid) ?? new Map<number, Cell>();
    cells.set(sid, byWeek);
    byWeek.set(w, cell);
  };
  for (const w of scope) {
    const lines = new Map((input.statLines.get(w) ?? []).map((l) => [l.sleeperId, l]));
    const roster = owned.get(w) ?? new Map();
    const sids = new Set<string>([...roster.keys(), ...lines.keys()]);
    for (const sid of sids) {
      const player = input.players.get(sid);
      if (!player || !allowed.has(player.position)) continue;
      const line = lines.get(sid);
      const own = roster.get(sid);
      if (own) {
        // The figure that counted in this league. A rostered player without a
        // stat line did not play, unless Sleeper credited him something anyway.
        put(sid, w, {
          points: own.points,
          played: line !== undefined || own.points !== 0,
          rosterId: own.rosterId,
          started: own.started,
          benchable: own.benchable,
        });
      } else if (line && scoresFreeAgents) {
        const points = scoreActualLine(line.stats, input.scoring, player.position);
        if (points === null) continue;
        put(sid, w, { points: round(points), played: true, rosterId: null, started: false, benchable: false });
      }
    }
  }

  // Season (or week) totals per player.
  type Agg = { sid: string; points: number; games: number };
  const aggs: Agg[] = [];
  for (const [sid, byWeek] of cells) {
    let points = 0;
    let games = 0;
    for (const cell of byWeek.values()) {
      if (!cell.played) continue;
      points += cell.points;
      games += 1;
    }
    if (games > 0) aggs.push({ sid, points: round(points), games });
  }

  const ownershipOf = (sid: string): OwnershipWeek[] =>
    scope.map((w) => {
      const cell = cells.get(sid)?.get(w);
      return {
        week: w,
        rosterId: cell ? cell.rosterId : (owned.get(w)?.get(sid)?.rosterId ?? null),
        points: cell && cell.played ? cell.points : null,
      };
    });

  const byPoints = (a: Agg, b: Agg) =>
    b.points - a.points ||
    a.games - b.games ||
    (input.players.get(a.sid)?.name ?? "").localeCompare(input.players.get(b.sid)?.name ?? "");

  const toLeaders = (list: Agg[], depth: number): PlayerLeader[] => {
    const sorted = [...list].sort(byPoints).slice(0, depth);
    return withRanks(sorted, (a) => a.points).map(({ item, rank }, index) => ({
      player: input.players.get(item.sid)!,
      points: item.points,
      games: item.games,
      perGame: item.games > 0 ? round(item.points / item.games) : null,
      rank,
      gapAbove: index === 0 ? null : round(sorted[index - 1].points - item.points),
      currentRosterId: input.currentRosters.get(item.sid) ?? null,
      ownership: ownershipOf(item.sid),
    }));
  };

  const boards: LeaderboardsView["boards"] = { all: toLeaders(aggs, BOARD_DEPTH) };
  const byPosition = new Map<LeaderboardPosition, Agg[]>();
  for (const agg of aggs) {
    const position = input.players.get(agg.sid)!.position;
    const list = byPosition.get(position) ?? [];
    list.push(agg);
    byPosition.set(position, list);
  }
  for (const position of input.positions) {
    boards[position] = toLeaders(byPosition.get(position) ?? [], BOARD_DEPTH);
  }

  const unowned = toLeaders(
    aggs.filter((a) => !input.currentRosters.has(a.sid)),
    UNOWNED_DEPTH,
  );

  // Single player-weeks.
  const playerWeeks: PlayerWeekLeader[] = [];
  const benchable = new Set<PlayerWeekLeader>();
  for (const [sid, byWeek] of cells) {
    for (const [w, cell] of byWeek) {
      if (!cell.played) continue;
      const entry: PlayerWeekLeader = {
        player: input.players.get(sid)!,
        week: w,
        points: cell.points,
        rosterId: cell.rosterId,
        started: cell.started,
        playoff: isPlayoff(w),
      };
      playerWeeks.push(entry);
      if (cell.benchable) benchable.add(entry);
    }
  }
  const byWeekPoints = (a: PlayerWeekLeader, b: PlayerWeekLeader) =>
    b.points - a.points || a.week - b.week || a.player.name.localeCompare(b.player.name);
  const bestWeeks = [...playerWeeks].sort(byWeekPoints).slice(0, WEEK_LIST_DEPTH);
  const showsBench = !input.bestBall;
  const benchHeroes = showsBench
    ? playerWeeks
        .filter((p) => benchable.has(p) && p.points > 0)
        .sort(byWeekPoints)
        .slice(0, WEEK_LIST_DEPTH)
    : [];

  // The top X at each position, X = teams times dedicated starting slots.
  // Teams that still hold a roster: a chopped league's eliminated teams have
  // emptied theirs, and counting them would push the cut line past players
  // nobody is left to start.
  const holding = new Set(input.currentRosters.values()).size;
  const teamCount = holding > 0 ? holding : input.teams.length;
  const cutoffs: TopTierCutoff[] = [];
  const tierCounts = new Map<number, Partial<Record<LeaderboardPosition, number>>>();
  for (const position of input.positions) {
    const slots = input.dedicatedSlots[position] ?? 0;
    if (slots <= 0 || teamCount === 0) continue;
    const cutoff = teamCount * slots;
    const top = [...(byPosition.get(position) ?? [])].sort(byPoints).slice(0, cutoff);
    let unownedCount = 0;
    for (const agg of top) {
      const rosterId = input.currentRosters.get(agg.sid);
      if (rosterId === undefined) {
        unownedCount += 1;
        continue;
      }
      const counts = tierCounts.get(rosterId) ?? {};
      counts[position] = (counts[position] ?? 0) + 1;
      tierCounts.set(rosterId, counts);
    }
    cutoffs.push({ position, slots, cutoff, unowned: unownedCount });
  }
  const tierRows = input.teams
    .map((t) => {
      const byPos = tierCounts.get(t.sleeperRosterId) ?? {};
      const total = Object.values(byPos).reduce((sum, n) => sum + (n ?? 0), 0);
      return { rosterId: t.sleeperRosterId, total, byPosition: byPos };
    })
    .sort((a, b) => b.total - a.total || a.rosterId - b.rosterId);
  const topTierRows: TopTierRow[] = withRanks(tierRows, (r) => r.total).map(({ item, rank }) => ({
    ...item,
    rank,
  }));

  // Team scores. A roster that started nobody that week (a chopped team after
  // its elimination, an empty roster) did not play, so its zero is not a low.
  const active = input.weeks.filter((r) => inScope.has(r.week) && r.startedIds.size > 0);
  const scores: TeamWeekScore[] = active.map((r) => ({
    rosterId: r.sleeperRosterId,
    week: r.week,
    points: round(r.officialPoints),
    playoff: isPlayoff(r.week),
  }));
  const teamHighs = [...scores]
    .sort((a, b) => b.points - a.points || a.week - b.week)
    .slice(0, TEAM_LIST_DEPTH);
  const teamLows = [...scores]
    .sort((a, b) => a.points - b.points || a.week - b.week)
    .slice(0, TEAM_LIST_DEPTH);

  const totals = new Map<number, number>();
  for (const s of scores) totals.set(s.rosterId, (totals.get(s.rosterId) ?? 0) + s.points);
  const pointsFor: TeamTotal[] = withRanks(
    [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
    (e) => e[1],
  ).map(({ item, rank }) => ({ rosterId: item[0], value: round(item[1]), rank }));

  let weeklyHighs: TeamTotal[] = [];
  if (week === null) {
    const highs = new Map<number, number>();
    for (const w of scope) {
      const that = scores.filter((s) => s.week === w);
      if (that.length === 0) continue;
      const top = Math.max(...that.map((s) => s.points));
      for (const s of that) if (s.points === top) highs.set(s.rosterId, (highs.get(s.rosterId) ?? 0) + 1);
    }
    weeklyHighs = withRanks(
      [...highs.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
      (e) => e[1],
    ).map(({ item, rank }) => ({ rosterId: item[0], value: item[1], rank }));
  }

  // Head to head games. Each pair once, from the lower roster id's side, and
  // only when somebody on either side actually started.
  const rowByKey = new Map(input.weeks.map((r) => [`${r.week}|${r.sleeperRosterId}`, r]));
  const games: GameResult[] = [];
  for (const r of input.weeks) {
    if (!inScope.has(r.week) || r.opponentRosterId === null) continue;
    if (r.sleeperRosterId > r.opponentRosterId) continue;
    const other = rowByKey.get(`${r.week}|${r.opponentRosterId}`);
    if (!other) continue;
    if (r.startedIds.size === 0 && other.startedIds.size === 0) continue;
    const home = round(r.officialPoints);
    const away = round(other.officialPoints);
    games.push({
      week: r.week,
      playoff: isPlayoff(r.week),
      homeId: r.sleeperRosterId,
      homePoints: home,
      awayId: other.sleeperRosterId,
      awayPoints: away,
      margin: round(Math.abs(home - away)),
      combined: round(home + away),
      winnerId: home === away ? null : home > away ? r.sleeperRosterId : other.sleeperRosterId,
    });
  }

  return {
    season: input.season,
    settledWeeks,
    week,
    playoffWeekStart: input.playoffWeekStart,
    positions: input.positions,
    teams: Object.fromEntries(input.teams.map((t) => [t.sleeperRosterId, t])),
    boards,
    unowned,
    bestWeeks,
    benchHeroes,
    showsBench,
    topTier: { cutoffs, rows: topTierRows },
    teamHighs,
    teamLows,
    pointsFor,
    weeklyHighs,
    games: {
      blowouts: [...games].sort((a, b) => b.margin - a.margin || a.week - b.week).slice(0, TEAM_LIST_DEPTH),
      closest: [...games].sort((a, b) => a.margin - b.margin || a.week - b.week).slice(0, TEAM_LIST_DEPTH),
      shootouts: [...games].sort((a, b) => b.combined - a.combined || a.week - b.week).slice(0, TEAM_LIST_DEPTH),
    },
    scoresFreeAgents,
  };
}
