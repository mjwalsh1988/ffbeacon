/**
 * How a fantasy team is named, everywhere on the site.
 *
 * Team name plus handle, because a team name changes on a whim and the handle
 * does not. "Herbert The Pervert" in September is something else by November,
 * and a reader looking at a trade, a power ranking, or a matchup needs to know
 * which manager they are looking at without playing a guessing game.
 *
 * Sleeper's `display_name` IS the account handle. `team_name` is the nickname
 * layered on top of it, and plenty of managers never set one, so the pair has
 * to degrade gracefully rather than printing an empty parenthesis.
 *
 *   both, and different       Herbert The Pervert (@BigBCardz)
 *   no team name              @BenMacleod27
 *   team name equals handle   @BigBCardz            (never printed twice)
 *   no handle                 Brown Syndrome
 *   neither                   Team 4
 *
 * ONE FORMATTER, ON PURPOSE. Before this, fifteen call sites each wrote their
 * own `team_name || display_name || \`Team ${id}\`` and the site quietly showed
 * the same manager under two different names depending on which page you were
 * on. Add new team-naming code here rather than beside it.
 */

export type TeamLabelInput = {
  /** league_users.team_name. Usually null. */
  teamName?: string | null;
  /** league_users.display_name, which is the Sleeper handle. */
  username?: string | null;
  /** Last resort, so a roster with no owner still has something to be called. */
  sleeperRosterId: number | string;
};

export function formatTeamLabel(input: TeamLabelInput): string {
  const team = input.teamName?.trim() || null;
  const handle = input.username?.trim() || null;

  if (!handle) return team ?? `Team ${input.sleeperRosterId}`;
  if (!team || team.toLowerCase() === handle.toLowerCase()) return `@${handle}`;
  return `${team} (@${handle})`;
}

/**
 * The same pairing split into its parts, for layouts that stack a name over a
 * smaller owner line rather than running them together on one row.
 *
 * `owner` is null exactly when printing it would repeat `primary`, so a caller
 * can render it unconditionally without checking for the duplicate case.
 */
export function teamLabelParts(input: TeamLabelInput): {
  primary: string;
  owner: string | null;
} {
  const team = input.teamName?.trim() || null;
  const handle = input.username?.trim() || null;

  if (!handle) return { primary: team ?? `Team ${input.sleeperRosterId}`, owner: null };
  if (!team || team.toLowerCase() === handle.toLowerCase()) {
    return { primary: `@${handle}`, owner: null };
  }
  return { primary: team, owner: `@${handle}` };
}

/**
 * A shortened pairing for places with a hard width budget: an OG image cell, a
 * dropdown option, a filter chip. Keeps the handle, which is the durable half,
 * and trims the team name rather than dropping it.
 */
export function formatTeamLabelCompact(
  input: TeamLabelInput,
  maxTeamChars = 18,
): string {
  const team = input.teamName?.trim() || null;
  const handle = input.username?.trim() || null;

  if (!handle) {
    const fallback = team ?? `Team ${input.sleeperRosterId}`;
    return clip(fallback, maxTeamChars);
  }
  if (!team || team.toLowerCase() === handle.toLowerCase()) return `@${handle}`;

  return `${clip(team, maxTeamChars)} (@${handle})`;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3).trimEnd()}...` : value;
}

/**
 * The owner line for a layout that stacks a handle under a team name.
 *
 * Returns null exactly when printing it would repeat the name above it, which
 * happens on every roster whose manager never set a team name: the team name
 * falls back to the handle, and the row then reads "BenMacleod27" over
 * "@BenMacleod27". Callers render the result unconditionally.
 */
export function ownerLine(
  teamName: string,
  handle: string | null | undefined,
): string | null {
  const h = handle?.trim();
  if (!h) return null;
  return teamName.trim().toLowerCase() === h.toLowerCase() ? null : `@${h}`;
}

/**
 * The pairing for callers that treat "we know nothing about this manager" as a
 * distinct case and skip the label entirely, rather than printing a roster
 * number nobody would recognise.
 */
export function formatTeamLabelOrNull(
  input: Omit<TeamLabelInput, "sleeperRosterId">,
): string | null {
  if (!input.teamName?.trim() && !input.username?.trim()) return null;
  return formatTeamLabel({ ...input, sleeperRosterId: "" });
}
