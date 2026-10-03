/**
 * Game-level builders for Season Pulse: team records from finals, the points
 * allowed grid, and the written preview for a game that has not been played.
 * Pure.
 *
 * THE PREVIEW IS TEMPLATES, NOT A LANGUAGE MODEL. Every sentence cites a figure
 * that is on the same card, and a sentence whose figure is missing is not
 * written. That is the rule the trade verdicts follow (CLAUDE.md, Trade Ideas)
 * and for the same reason: a reader can check each sentence against the
 * numbers beside it, which a generated one would not allow.
 *
 * THE WORDS AVOID THE BETTING WINDOW. A spread is said as who is favoured and
 * by how much, and an implied total as what a team is expected to score, the
 * way lib/nfl-game-environment.ts says it. The reader is setting a lineup.
 */

import { positionNoun } from "@/lib/site";
import type { WeatherRead } from "@/lib/nfl-weather-impact";
import { rankDescending } from "./board";
import type { DefenseVsPositionRow, SeasonPosition, TeamRecord, TeamSide } from "./types";

/** The positions the points allowed grid shows. */
export const MATCHUP_POSITIONS: readonly SeasonPosition[] = ["QB", "RB", "WR", "TE"];

/** A defense is named as a soft matchup inside this rank, a hard one outside the other. */
export const SOFT_MATCHUP_RANK = 5;
export const HARD_MATCHUP_RANK = 28;
/** And only once it has been measured over this many games. */
export const MATCHUP_MIN_GAMES = 2;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "Falcons" from "Atlanta Falcons": the word a listener hears as the team. */
export function teamNickname(name: string): string {
  const words = name.trim().split(/\s+/);
  return words[words.length - 1] || name;
}

/** 1 as "most", 2 as "second most", 4 as "4th most". */
export function ordinalMost(rank: number, word: "most" | "fewest" = "most"): string {
  if (rank === 1) return word;
  if (rank === 2) return `second ${word}`;
  if (rank === 3) return `third ${word}`;
  return `${rank}th ${word}`;
}

export type FinalInput = {
  week: number;
  team: string;
  opponent: string;
  pointsFor: number;
  pointsAgainst: number;
};

/** Every team's record and scoring from the finals of the weeks played. */
export function buildTeamRecords(finals: readonly FinalInput[], names: ReadonlyMap<string, string>): TeamRecord[] {
  const byTeam = new Map<string, TeamRecord>();
  for (const f of finals) {
    const record =
      byTeam.get(f.team) ??
      ({
        code: f.team,
        name: names.get(f.team) ?? f.team,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        games: 0,
      } satisfies TeamRecord);
    record.games += 1;
    record.pointsFor += f.pointsFor;
    record.pointsAgainst += f.pointsAgainst;
    if (f.pointsFor > f.pointsAgainst) record.wins += 1;
    else if (f.pointsFor < f.pointsAgainst) record.losses += 1;
    else record.ties += 1;
    byTeam.set(f.team, record);
  }
  const pct = (r: TeamRecord) => (r.games > 0 ? (r.wins + r.ties / 2) / r.games : 0);
  return [...byTeam.values()].sort(
    (a, b) =>
      pct(b) - pct(a) ||
      b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
      a.name.localeCompare(b.name),
  );
}

export type DefenseSplitInput = {
  team: string;
  position: string;
  perGame: number;
  games: number;
};

/**
 * The points allowed grid, ranked on the figure it prints.
 *
 * The rank here is on raw points allowed per game, 1 being the most, because
 * that is the number in the cell and a rank that disagreed with the number
 * beside it would be unreadable. It is NOT the schedule-adjusted figure the
 * projection path applies (lib/calculate-defense-splits.ts), and the page says
 * so.
 */
export function buildDefenseGrid(
  splits: readonly DefenseSplitInput[],
  names: ReadonlyMap<string, string>,
): DefenseVsPositionRow[] {
  const rows = new Map<string, DefenseVsPositionRow>();
  for (const position of MATCHUP_POSITIONS) {
    const group = splits.filter((s) => s.position === position);
    const ranks = rankDescending(group.map((s) => s.perGame));
    group.forEach((s, i) => {
      const row = rows.get(s.team) ?? { team: s.team, name: names.get(s.team) ?? s.team, cells: {} };
      row.cells[position] = { perGame: round1(s.perGame), rank: ranks[i], games: s.games };
      rows.set(s.team, row);
    });
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type PreviewInput = {
  week: number;
  away: TeamSide;
  home: TeamSide;
  homeSpread: number | null;
  total: number | null;
  /** 1 is the highest combined total of the week. Null with no line. */
  totalRank: number | null;
  /** How many games of the week have a total. */
  rankedGames: number;
  /** The points allowed grid, for both defenses. */
  defense: ReadonlyMap<string, DefenseVsPositionRow>;
  /**
   * The forecast's read, or null when the caller draws the forecast itself
   * (a game card has its own weather block, and the same sentence twice on one
   * card is noise).
   */
  weather: WeatherRead | null;
};

function scoringSentence(input: PreviewInput): string | null {
  const { away, home, homeSpread, total } = input;
  const parts: string[] = [];
  if (homeSpread !== null) {
    if (homeSpread === 0) parts.push(`The ${away.nickname} and ${home.nickname} are rated even.`);
    else if (homeSpread < 0) parts.push(`The ${home.nickname} are favoured by ${Math.abs(homeSpread)} at home.`);
    else parts.push(`The ${away.nickname} are favoured by ${homeSpread} on the road.`);
  }
  if (away.implied !== null && home.implied !== null && total !== null) {
    let place = "";
    if (input.totalRank !== null && input.rankedGames >= 6) {
      if (input.totalRank === 1) place = `, the highest of week ${input.week}`;
      else if (input.totalRank <= 3) place = ", one of the three highest this week";
      else if (input.totalRank === input.rankedGames) place = `, the lowest of week ${input.week}`;
      else if (input.totalRank > input.rankedGames - 3) place = ", one of the three lowest this week";
    }
    parts.push(
      `The ${away.nickname} are expected to score about ${away.implied} and the ${home.nickname} about ${home.implied}, a combined ${total}${place}.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

type Matchup = { defense: TeamSide; position: SeasonPosition; rank: number; perGame: number };

function matchups(input: PreviewInput): Matchup[] {
  const out: Matchup[] = [];
  for (const side of [input.away, input.home]) {
    const row = input.defense.get(side.code);
    if (!row) continue;
    for (const position of MATCHUP_POSITIONS) {
      const cell = row.cells[position];
      if (!cell || cell.games < MATCHUP_MIN_GAMES) continue;
      out.push({ defense: side, position, rank: cell.rank, perGame: cell.perGame });
    }
  }
  return out;
}

function matchupSentence(input: PreviewInput, teams: number): string | null {
  const all = matchups(input);
  if (all.length === 0) return null;
  const softest = [...all].sort((a, b) => a.rank - b.rank)[0];
  if (softest.rank <= SOFT_MATCHUP_RANK) {
    const offense = softest.defense.code === input.home.code ? input.away : input.home;
    return `The ${softest.defense.nickname} have allowed the ${ordinalMost(softest.rank)} fantasy points to ${positionNoun(softest.position, "plural")} this season, ${softest.perGame} a game, which is the softest matchup here for the ${offense.nickname}.`;
  }
  const hardest = [...all].sort((a, b) => b.rank - a.rank)[0];
  if (hardest.rank >= Math.min(HARD_MATCHUP_RANK, teams - 4)) {
    // Counted from the bottom on the figure itself, so two defenses tied for
    // the fewest are both "the fewest" and neither is called second.
    let stingier = 0;
    for (const row of input.defense.values()) {
      const cell = row.cells[hardest.position];
      if (cell && cell.perGame < hardest.perGame) stingier += 1;
    }
    const fromBottom = stingier + 1;
    return `The ${hardest.defense.nickname} have allowed the ${ordinalMost(fromBottom, "fewest")} fantasy points to ${positionNoun(hardest.position, "plural")} this season, ${hardest.perGame} a game.`;
  }
  return null;
}

function weatherSentence(read: WeatherRead | null): string | null {
  // An unknown forecast is said on the card's own weather line. Repeating it
  // in the prose would put the same absence on the screen twice.
  if (!read || read.band === "unknown") return null;
  return read.forecast ? `${read.forecast} ${read.advice}` : read.advice;
}

/** Two to four sentences about a game still to be played. Never an empty promise. */
export function buildPreview(input: PreviewInput): string[] {
  const teams = input.defense.size;
  return [scoringSentence(input), matchupSentence(input, teams), weatherSentence(input.weather)].filter(
    (s): s is string => s !== null && s.length > 0,
  );
}

/** The combined-total rank of every game in a week, 1 the highest. Keyed by home team. */
export function rankTotals(games: readonly { home: string; total: number | null }[]): {
  byHome: Map<string, number>;
  ranked: number;
} {
  const withTotal = games.filter((g): g is { home: string; total: number } => g.total !== null);
  const ranks = rankDescending(withTotal.map((g) => g.total));
  return { byHome: new Map(withTotal.map((g, i) => [g.home, ranks[i]])), ranked: withTotal.length };
}
