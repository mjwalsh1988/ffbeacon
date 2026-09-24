/**
 * What our own synced IDP leagues look like (plan IDP-217, lessons 1 and 2).
 *
 * Read from the leagues table at request time, so the counts move as leagues
 * sync. Only structure is read (slot tokens and scoring rules), never a
 * manager, a roster or a name.
 */

const IDP_SLOTS = new Set(["DL", "LB", "DB", "IDP_FLEX"]);

export type IdpLeagueRow = {
  rosterPositions: unknown;
  scoringSettings: Record<string, unknown> | null;
};

export type IdpLeagueFacts = {
  /** Leagues starting at least one IDP slot. */
  leagues: number;
  /** Every league we hold. */
  allLeagues: number;
  /** IDP starters per IDP league, ascending. */
  starterCounts: number[];
  medianStarters: number | null;
  /** Leagues whose only IDP slots are IDP_FLEX. */
  flexOnly: number;
  /** Leagues scoring plain "Tackle" (idp_tkl). */
  plainTackle: number;
  /** Of those, how many ALSO score solo tackles: the stacking trap. */
  plainTackleAndSolo: number;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeIdpLeagues(rows: IdpLeagueRow[]): IdpLeagueFacts {
  const starterCounts: number[] = [];
  let flexOnly = 0;
  let plainTackle = 0;
  let plainTackleAndSolo = 0;
  for (const row of rows) {
    const slots = Array.isArray(row.rosterPositions)
      ? (row.rosterPositions as unknown[]).map((s) => String(s).toUpperCase())
      : [];
    const idp = slots.filter((s) => IDP_SLOTS.has(s));
    if (idp.length === 0) continue;
    starterCounts.push(idp.length);
    if (idp.every((s) => s === "IDP_FLEX")) flexOnly += 1;
    const scoring = row.scoringSettings ?? {};
    if (num(scoring.idp_tkl) !== 0) {
      plainTackle += 1;
      if (num(scoring.idp_tkl_solo) !== 0) plainTackleAndSolo += 1;
    }
  }
  starterCounts.sort((a, b) => a - b);
  const mid = starterCounts.length;
  const medianStarters =
    mid === 0
      ? null
      : mid % 2 === 1
        ? starterCounts[(mid - 1) / 2]
        : (starterCounts[mid / 2 - 1] + starterCounts[mid / 2]) / 2;
  return {
    leagues: starterCounts.length,
    allLeagues: rows.length,
    starterCounts,
    medianStarters,
    flexOnly,
    plainTackle,
    plainTackleAndSolo,
  };
}
