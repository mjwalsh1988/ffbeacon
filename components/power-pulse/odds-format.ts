/**
 * Words and figures for Power Pulse odds, shared by every table and card that
 * prints them, so the page, the overview and the rail never round or phrase one
 * number two ways.
 *
 * Three rules live here. A missing figure is said in words, never as a dash or
 * a zero. A chance under one percent says "under 1%", because "0%" reads as
 * impossible. And the postseason words follow the league's phase: before the
 * playoffs a team has odds, during them a team is alive or out, after them a
 * team has a final place.
 */

import type { PulseTeam } from "@/lib/league-power-pulse-data";
import type { PlayoffPhase } from "@/lib/power-pulse/playoffs";

export function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** A chance as a percentage in words. Null is "No odds yet". */
export function pctOdds(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "No odds yet";
  }
  const asPct = value * 100;
  if (asPct > 0 && asPct < 1) return "under 1%";
  if (asPct > 99 && asPct < 100) return "over 99%";
  return `${Math.round(asPct)}%`;
}

/** A projected record, averaged over simulated seasons, so it lands on fractions. */
export function projectedRecordText(
  record: { wins: number; losses: number; ties: number } | null,
): string {
  if (record === null) return "No projection";
  const base = `${record.wins.toFixed(1)}-${record.losses.toFixed(1)}`;
  return record.ties >= 0.05 ? `${base}-${record.ties.toFixed(1)}` : base;
}

/** A played record such as "9-4" or "9-4-1". */
export function playedRecordText(record: {
  wins: number;
  losses: number;
  ties: number;
}): string {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}

/**
 * What the Title column says for a team.
 *
 * Chopped: the chance of being the last team standing. Before the playoffs:
 * title odds. During them: the bracket odds for a team still alive, and a word
 * for a team that is out. After them: the champion, or the final place.
 */
export function titleFigure(team: PulseTeam, phase: PlayoffPhase | null): string {
  if (team.chopped) return pctOdds(team.surviveAllOdds);
  const p = team.playoff;
  if (phase === "complete" && p) {
    if (p.status === "champion") return "Champion";
    if (p.finalPlace !== null) return `${ordinal(p.finalPlace)} place`;
    return p.status === "missed" ? "Missed playoffs" : "Eliminated";
  }
  if (phase === "playoffs" && p) {
    if (p.status === "eliminated") return "Eliminated";
    if (p.status === "missed") return "Missed playoffs";
    if (p.status === "champion") return "Champion";
  }
  return pctOdds(team.titleOdds);
}

/**
 * What the Playoffs column says for a team: odds before the bracket exists,
 * the seed and where it stands once it does.
 */
export function playoffFigure(team: PulseTeam, phase: PlayoffPhase | null): string {
  const p = team.playoff;
  if ((phase === "playoffs" || phase === "complete") && p) {
    if (p.status === "missed" || p.seed === null) return "Missed playoffs";
    return `Seed ${p.seed}`;
  }
  return pctOdds(team.playoffOdds);
}

/** True when the playoffs column carries odds, so a bar can be drawn for it. */
export function playoffIsOdds(team: PulseTeam, phase: PlayoffPhase | null): boolean {
  if (team.chopped) return false;
  return !((phase === "playoffs" || phase === "complete") && team.playoff);
}

/** Two labeled figures for a compact row: the title line and the playoff line. */
export type OddsSummary = {
  primary: { label: string; text: string };
  secondary: { label: string; text: string };
};

export function oddsSummary(team: PulseTeam, phase: PlayoffPhase | null): OddsSummary {
  if (team.chopped) {
    return {
      primary: { label: "Last standing", text: titleFigure(team, phase) },
      secondary: { label: "Chopped this week", text: pctOdds(team.chopOddsThisWeek) },
    };
  }
  if (phase === "complete") {
    return {
      primary: { label: "Result", text: titleFigure(team, phase) },
      secondary: { label: "Seed", text: playoffFigure(team, phase) },
    };
  }
  if (phase === "playoffs") {
    return {
      primary: { label: "Bracket odds", text: titleFigure(team, phase) },
      secondary: { label: "Seed", text: playoffFigure(team, phase) },
    };
  }
  return {
    primary: { label: "Title", text: titleFigure(team, phase) },
    secondary: { label: "Playoffs", text: playoffFigure(team, phase) },
  };
}

/** The one short line a heading carries for the league's phase. */
export function phaseLine(
  phase: PlayoffPhase | null,
  chopped: boolean,
): string {
  if (chopped) return "One team is chopped each week, so there is no bracket.";
  if (phase === "playoffs") return "The bracket is being played, so odds count only the teams still alive.";
  if (phase === "complete") return "The title game is played, so this is the final result.";
  return "The regular season is still being played, so these are odds.";
}

/** Names of the teams with a given postseason status, in table order. */
export function namesWithStatus(
  teams: PulseTeam[],
  status: "eliminated" | "missed" | "alive",
): string[] {
  return teams.filter((t) => t.playoff?.status === status).map((t) => t.teamName);
}

/** Joins names as "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
