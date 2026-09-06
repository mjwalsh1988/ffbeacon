/**
 * Resolving whose team it is.
 *
 * Extracted verbatim from components/team-filter.tsx (formerly
 * resolveOwnerRosterId), because a server-side caller now needs the same rule
 * as the client-side team filter, and two copies of it would drift.
 *
 * The rule, in order:
 *   1. An explicit ?roster= wins when it names a team in the list.
 *   2. The viewer's Sleeper USER ID, matched against the roster's owner and
 *      then against its co-owners.
 *   3. A case-insensitive, whitespace-trimmed match of the viewer's handle
 *      against the owner's display name.
 *   4. Null.
 *
 * Step 2 exists because a Sleeper USERNAME and a Sleeper DISPLAY NAME are
 * different strings, and step 3 compares against the display name. That worked
 * only for as long as every reader arrived through League Pulse, which forwards
 * `user.display_name` into `?username=`. A SAVED handle is a username, so a
 * reader whose two names differ would have matched nobody and been told, on
 * their own league, that none of these teams is theirs. See D3 in
 * docs/saved-handle/saved-handle-plan.md.
 *
 * Step 3 stays because a guest following a shareable `?username=` link has no
 * user id to match on, and that is still the common way into a league.
 */

export type ViewerCandidate = {
  sleeperRosterId: number;
  /** league_users.display_name for this roster's owner. */
  ownerSleeperUsername: string | null;
  /** rosters.owner_user_id, which holds the Sleeper user id verbatim. */
  ownerSleeperUserId: string | null;
  /** rosters.co_owners: the Sleeper user ids sharing this roster. */
  coOwnerIds: string[];
};

export function matchViewerRoster(
  teams: readonly ViewerCandidate[],
  searchedUsername: string | null | undefined,
  focusedRosterId: number | null | undefined,
  viewerSleeperUserId?: string | null,
): number | null {
  // Explicit roster focus (e.g. clicking a row on Power Rankings) wins over
  // the broader "searched username" default so deep-links land on the exact
  // team the user picked even when they also have a username in the URL.
  if (focusedRosterId != null) {
    const match = teams.find((t) => t.sleeperRosterId === focusedRosterId);
    if (match) return match.sleeperRosterId;
  }

  // The Sleeper user id is exact, so it is tried before the name.
  const userId = viewerSleeperUserId?.trim();
  if (userId) {
    const owned = teams.find((t) => t.ownerSleeperUserId === userId);
    if (owned) return owned.sleeperRosterId;
    const shared = teams.find((t) => (t.coOwnerIds ?? []).includes(userId));
    if (shared) return shared.sleeperRosterId;
  }

  if (!searchedUsername || !searchedUsername.trim()) return null;
  const needle = searchedUsername.trim().toLowerCase();
  const match = teams.find(
    (t) => (t.ownerSleeperUsername ?? "").trim().toLowerCase() === needle,
  );
  return match ? match.sleeperRosterId : null;
}
