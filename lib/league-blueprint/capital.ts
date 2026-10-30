/**
 * Draft capital by season (plan 6.12). Pure. Dynasty and keeper only.
 *
 * Reads the trade finder's PER-PICK valuation (each pick priced at its own
 * early, mid or late slot through the pick position resolver), never the
 * power rankings cache, which prices every pick at "mid". A pick with no value
 * is listed and counted but adds nothing, and the season says how many.
 */

import type { FinderPick, FinderTeam } from "@/lib/trade-finder/types";
import type { BlueprintCapital, CapitalPick, CapitalSeason } from "./types";

/** "2027 R1, early, via @handle" -> "R1, early". The season is the row heading. */
export function pickShortLabel(p: FinderPick): string {
  let label = p.label;
  const seasonPrefix = `${p.season} `;
  if (label.startsWith(seasonPrefix)) label = label.slice(seasonPrefix.length);
  const via = label.indexOf(", via ");
  if (via >= 0) label = label.slice(0, via);
  return label;
}

function seasonTotals(picks: readonly FinderPick[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of picks) out.set(p.season, (out.get(p.season) ?? 0) + (p.hasValue ? p.value : 0));
  return out;
}

export function computeCapital(
  teams: readonly FinderTeam[],
  myRosterId: number,
  pickSourceDisplay: string | null,
): BlueprintCapital {
  const mine = teams.find((t) => t.rosterId === myRosterId);
  const myPicks = [...(mine?.picks ?? [])].sort(
    (a, b) => a.season - b.season || a.round - b.round || a.label.localeCompare(b.label),
  );
  const totalsByRoster = teams.map((t) => ({ rosterId: t.rosterId, totals: seasonTotals(t.picks) }));

  const seasons = [...new Set(myPicks.map((p) => p.season))].sort((a, b) => a - b);
  const rows: CapitalSeason[] = seasons.map((season) => {
    const picks = myPicks.filter((p) => p.season === season);
    const list: CapitalPick[] = picks.map((p) => ({
      label: pickShortLabel(p),
      isOwn: p.isOwnPick,
      via: p.isOwnPick
        ? null
        : p.originalOwnerHandle
          ? `via @${p.originalOwnerHandle}`
          : p.originalTeamName
            ? `via ${p.originalTeamName}`
            : null,
      value: p.hasValue ? Math.round(p.value) : null,
    }));
    const value = picks.reduce((s, p) => s + (p.hasValue ? p.value : 0), 0);
    const mineTotal = value;
    const rank =
      value > 0
        ? 1 +
          totalsByRoster.filter(
            (r) =>
              r.rosterId !== myRosterId &&
              ((r.totals.get(season) ?? 0) > mineTotal ||
                ((r.totals.get(season) ?? 0) === mineTotal && r.rosterId < myRosterId)),
          ).length
        : null;
    return {
      season,
      picks: list,
      value: Math.round(value),
      rank,
      unpricedCount: picks.filter((p) => !p.hasValue).length,
    };
  });
  return { seasons: rows, pickSourceDisplay };
}

export const REDRAFT_CAPITAL = "Redraft leagues hold no future picks.";
