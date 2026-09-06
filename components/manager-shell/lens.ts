/**
 * The pure lens helpers, in a module with NO "use client" directive.
 *
 * WHY THEY ARE NOT IN lens-switch.tsx, WHICH IS WHERE THEY STARTED
 * That file is a client component, and Next turns EVERY export of a "use
 * client" module into a client reference in the react-server layer. These five
 * functions are called by six SERVER components (the report page and five
 * report sections), and across that boundary the import does not resolve to the
 * function, it resolves to a proxy that throws:
 *
 *   Attempted to call underLens() from the server but underLens is on the client
 *
 * So the report page and the signed-out sample page both returned a 500, while
 * every unit test passed, because a test imports the module directly and never
 * crosses the boundary that breaks it. Being free of React and of fetch is not
 * what makes a function server-safe; not living in a client module is.
 *
 * `lens-switch.tsx` imports these back for its own use, so there is still one
 * definition of every rule.
 *
 * The lens rules themselves: dynasty and redraft are different games with
 * different value scales, so the whole report reads through one lens, and a
 * value-priced figure has no combined form. `perTypeUnderLens` is that rule in
 * one function and every PerTypeStat reader goes through it.
 */

import type { LeagueLens, PerTypeStat, PoolableStat } from "@/lib/manager-pulse/types";

export type LensCounts = { leagueSeasons: number; dynasty: number; redraft: number };

/** Read a PoolableStat under the active lens. `PoolableStat`'s three keys are
 *  spelled exactly like `LeagueLens`'s three values, so this is a direct
 *  lookup rather than a three-way branch. */
export function underLens<T>(
  stat: PoolableStat<T> | null | undefined,
  lens: LeagueLens,
): T | null {
  if (!stat) return null;
  return stat[lens] ?? null;
}

/**
 * The league types a PerTypeStat should render under the active lens.
 *
 * Under "all" this returns BOTH dynasty and redraft, because a value-priced
 * figure has no combined form (docs/manager-pulse/manager-pulse-plan.md 6.0: averaging a
 * dynasty margin with a redraft margin produces a number with no unit) and the
 * two are shown side by side instead. Under a specific lens it returns just
 * that one. This is the whole dynasty/redraft-never-pools rule expressed as one
 * function; every `PerTypeStat` reader in Manager Pulse calls this rather than
 * re-deciding it.
 */
export function perTypeUnderLens(lens: LeagueLens): Array<"dynasty" | "redraft"> {
  return lens === "all" ? ["dynasty", "redraft"] : [lens];
}

/** Read a PerTypeStat's slice for one specific league type. A small companion
 *  to `perTypeUnderLens`, for a caller that already has the one type it wants
 *  (from the loop `perTypeUnderLens` drives) rather than the active lens. */
export function perTypeSlice<T>(stat: PerTypeStat<T>, type: "dynasty" | "redraft"): T | null {
  return stat[type] ?? null;
}

/** The default lens for a report: whichever type holds more league-seasons,
 *  else "all" (a tie, including zero and zero, has no type to prefer). */
export function defaultLens(counts: { dynasty: number; redraft: number }): LeagueLens {
  if (counts.dynasty > counts.redraft) return "dynasty";
  if (counts.redraft > counts.dynasty) return "redraft";
  return "all";
}

/** Plain label for a lens. */
export function lensLabel(lens: LeagueLens): string {
  if (lens === "dynasty") return "Dynasty";
  if (lens === "redraft") return "Redraft";
  return "All";
}

/** The count a lens covers, for the control's label and its announcement. */
export function countFor(lens: LeagueLens, counts: LensCounts): number {
  if (lens === "dynasty") return counts.dynasty;
  if (lens === "redraft") return counts.redraft;
  return counts.leagueSeasons;
}
