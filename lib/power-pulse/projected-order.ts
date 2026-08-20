/**
 * The one definition of "where does this team finish".
 *
 * Projected final standings are ordered by expected wins, with points per week
 * breaking ties. That is deliberately NOT Power Pulse order: a strong roster
 * drawing a hard schedule finishes below where its Pulse sits, and the gap is
 * the thing the standings table exists to show.
 *
 * Two surfaces quote this order. The table inside a league
 * (components/power-pulse/projected-standings.tsx) and the projected finish on
 * every league row of the league list (lib/league-team-status-data.ts). A row
 * that promises 3rd and a league that then says 4th is the kind of discrepancy
 * nobody reports and everybody stops trusting, so the comparator is shared
 * rather than written twice.
 *
 * Structural, so it accepts anything carrying the two fields: the league view
 * holds camelCase PulseTeam objects, the list reads snake_case cache rows and
 * adapts.
 */
export type ProjectedFinishInput = {
  projectedWins: number | null | undefined;
  expectedPointsPerWeek: number | null | undefined;
  /**
   * Roster row id, used only to settle a tie both other fields agree on.
   *
   * Both surfaces sort rows that arrived from an unordered read, so without a
   * final tiebreak two genuinely level teams take whichever order the database
   * happened to return, and the league row and the league page can disagree
   * about who is 4th. Optional so a caller with no id still compiles; those
   * callers keep the old input-order behavior.
   */
  rosterId?: string | null;
};

/** Sort comparator: best projected finish first. */
export function compareProjectedFinish(
  a: ProjectedFinishInput,
  b: ProjectedFinishInput,
): number {
  const byWins = (b.projectedWins ?? 0) - (a.projectedWins ?? 0);
  if (byWins !== 0) return byWins;
  const byPoints = (b.expectedPointsPerWeek ?? 0) - (a.expectedPointsPerWeek ?? 0);
  if (byPoints !== 0) return byPoints;
  if (a.rosterId && b.rosterId) return a.rosterId.localeCompare(b.rosterId);
  return 0;
}
