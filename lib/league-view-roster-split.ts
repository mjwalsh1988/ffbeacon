/**
 * The rostered players a team card has no value column for (plan IDP-209,
 * R-27), split into the two groups the card names them in.
 *
 * Defenders (DL, LB, DB) get a Defense group of their own, sorted by
 * position then name. Kickers and team defenses get a named line. Everyone
 * else (QB, RB, WR, TE) is already in a value column and is not returned.
 * Anything else a roster can hold (an offensive lineman on a deep roster) is
 * left out, as it always has been.
 *
 * Pure and client-safe.
 */

import { isDefender } from "@/lib/site";

const DEFENDER_ORDER: Record<string, number> = { DL: 0, LB: 1, DB: 2 };

export function splitUnvaluedRoster<P extends { position: string; full_name: string }>(
  players: P[],
): { defenders: P[]; specialists: P[] } {
  const defenders = players
    .filter((p) => isDefender(p.position))
    .sort(
      (a, b) =>
        (DEFENDER_ORDER[a.position.toUpperCase()] ?? 9) -
          (DEFENDER_ORDER[b.position.toUpperCase()] ?? 9) ||
        a.full_name.localeCompare(b.full_name),
    );
  const specialists = players.filter((p) => p.position === "K" || p.position === "DEF");
  return { defenders, specialists };
}
