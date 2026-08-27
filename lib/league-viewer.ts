/**
 * Resolving whose team it is.
 *
 * Extracted verbatim from components/team-filter.tsx (formerly
 * resolveOwnerRosterId), because a server-side caller now needs the same rule
 * as the client-side team filter, and two copies of it would drift.
 *
 * The rule: an explicit ?roster= wins when it matches a team in the list,
 * then a case-insensitive, whitespace-trimmed match of ?username= against
 * the owner's Sleeper username, else null.
 */

export type ViewerCandidate = {
  sleeperRosterId: number;
  ownerSleeperUsername: string | null;
};

export function matchViewerRoster(
  teams: readonly ViewerCandidate[],
  searchedUsername: string | null | undefined,
  focusedRosterId: number | null | undefined,
): number | null {
  // Explicit roster focus (e.g. clicking a row on Power Rankings) wins over
  // the broader "searched username" default so deep-links land on the exact
  // team the user picked even when they also have a username in the URL.
  if (focusedRosterId != null) {
    const match = teams.find((t) => t.sleeperRosterId === focusedRosterId);
    if (match) return match.sleeperRosterId;
  }
  if (!searchedUsername || !searchedUsername.trim()) return null;
  const needle = searchedUsername.trim().toLowerCase();
  const match = teams.find(
    (t) => (t.ownerSleeperUsername ?? "").trim().toLowerCase() === needle,
  );
  return match ? match.sleeperRosterId : null;
}
