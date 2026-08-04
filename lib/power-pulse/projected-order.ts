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
};

/** Sort comparator: best projected finish first. */
export function compareProjectedFinish(
  a: ProjectedFinishInput,
  b: ProjectedFinishInput,
): number {
  return (
    (b.projectedWins ?? 0) - (a.projectedWins ?? 0) ||
    (b.expectedPointsPerWeek ?? 0) - (a.expectedPointsPerWeek ?? 0)
  );
}
