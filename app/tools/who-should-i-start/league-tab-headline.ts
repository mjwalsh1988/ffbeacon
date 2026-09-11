/**
 * The decision behind the "Your lineup" tab's one-sentence headline, pulled
 * out of league-tab.tsx as plain data so it can be unit tested without a DOM.
 *
 * This repo has no React Testing Library set up (see
 * components/manager-pulse/per-type-pair.test.tsx), so a decision that lives
 * only inside JSX is a decision nothing exercises directly. Returning a plain
 * object here and switching on it in the component keeps the wording tested
 * the same way every other pure decision in this codebase is: no JSX, no DOM.
 *
 * N equals 2 is not a special case in the RANKING below; it falls out of the
 * measured list happening to have two entries. It IS a special case in the
 * WORDING: exactly two measured sides keep the original two-name sentence
 * forms verbatim (naming both players), so the common pairwise Beacon
 * Breakdown path reads exactly as it did before this file supported more than
 * two. Three to eight measured sides get a ranked form that names the leader
 * and the runner-up rather than every name in the group.
 */

import type { BreakdownPlayer, LeagueImpact } from "@/lib/beacon-breakdown";

export type Side = { player: BreakdownPlayer; impact: LeagueImpact | null };
export type MeasuredSide = { player: BreakdownPlayer; impact: LeagueImpact };

export function isMeasured(side: Side): side is MeasuredSide {
  return side.impact !== null;
}

/** Comma-and-"and" list, the plain-prose join used everywhere else on the site. */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Below this gap, two net-points-per-week figures read as the same player. */
const EVEN_GAP_POINTS = 0.15;

export type LeagueTabHeadlinePlan =
  | { kind: "empty" }
  | {
      kind: "single";
      name: string;
      net: number;
      weeksStarting: number;
      weeksConsidered: number;
    }
  | { kind: "all-bench"; names: string[]; pairwise: boolean }
  | {
      kind: "pair-even";
      leaderName: string;
      trailerName: string;
      leaderNet: number;
      trailerNet: number;
    }
  | {
      kind: "pair-lead";
      leaderName: string;
      trailerName: string;
      gap: number;
      leaderNet: number;
      trailerNet: number;
      leaderWeeksStarting: number;
      leaderWeeksConsidered: number;
      trailerWeeksStarting: number;
    }
  | { kind: "group-even"; leaderName: string; secondName: string; net: number }
  | {
      kind: "group-lead";
      leaderName: string;
      secondName: string;
      leaderNet: number;
      secondNet: number;
      leaderWeeksStarting: number;
      leaderWeeksConsidered: number;
    };

export function describeLeagueTabHeadline(sides: Side[]): LeagueTabHeadlinePlan {
  const measured = sides.filter(isMeasured);
  if (measured.length === 0) return { kind: "empty" };

  if (measured.length === 1) {
    const only = measured[0];
    return {
      kind: "single",
      name: only.player.name,
      net: only.impact.netPointsPerWeek,
      weeksStarting: only.impact.weeksStarting,
      weeksConsidered: only.impact.weeksConsidered,
    };
  }

  if (measured.every((s) => s.impact.isBenchOnly)) {
    return {
      kind: "all-bench",
      names: measured.map((s) => s.player.name),
      pairwise: measured.length === 2,
    };
  }

  const ranked = [...measured].sort(
    (x, y) => y.impact.netPointsPerWeek - x.impact.netPointsPerWeek,
  );
  const leader = ranked[0];
  const second = ranked[1];
  const gap = leader.impact.netPointsPerWeek - second.impact.netPointsPerWeek;

  if (measured.length === 2) {
    const trailer = ranked[1];
    if (Math.abs(gap) < EVEN_GAP_POINTS) {
      return {
        kind: "pair-even",
        leaderName: leader.player.name,
        trailerName: trailer.player.name,
        leaderNet: leader.impact.netPointsPerWeek,
        trailerNet: trailer.impact.netPointsPerWeek,
      };
    }
    return {
      kind: "pair-lead",
      leaderName: leader.player.name,
      trailerName: trailer.player.name,
      gap: Math.abs(gap),
      leaderNet: leader.impact.netPointsPerWeek,
      trailerNet: trailer.impact.netPointsPerWeek,
      leaderWeeksStarting: leader.impact.weeksStarting,
      leaderWeeksConsidered: leader.impact.weeksConsidered,
      trailerWeeksStarting: trailer.impact.weeksStarting,
    };
  }

  // Three to eight measured sides: rank rather than name every gap.
  if (Math.abs(gap) < EVEN_GAP_POINTS) {
    return {
      kind: "group-even",
      leaderName: leader.player.name,
      secondName: second.player.name,
      net: leader.impact.netPointsPerWeek,
    };
  }
  return {
    kind: "group-lead",
    leaderName: leader.player.name,
    secondName: second.player.name,
    leaderNet: leader.impact.netPointsPerWeek,
    secondNet: second.impact.netPointsPerWeek,
    leaderWeeksStarting: leader.impact.weeksStarting,
    leaderWeeksConsidered: leader.impact.weeksConsidered,
  };
}
