/**
 * Sleeper's `transaction.draft_picks`, in one shape.
 *
 * Sleeper emits this field as any of four things:
 *   - an array of pick objects
 *   - an object map keyed by index
 *   - a JSON-encoded string
 *   - null or undefined
 *
 * Every reader has to handle all four, which is why this is a shared function
 * rather than an `Array.isArray` check at each call site. See CLAUDE.md,
 * "Sleeper API access".
 *
 * IT LIVES IN ITS OWN FILE because it is depended on from both ends of the
 * sync. `lib/league-pulse.ts` uses it while WRITING transactions, and
 * `lib/league-activity/project.ts` uses it while reading them back, and
 * league-pulse imports the projector. Leaving the function inside league-pulse
 * made that pair a cycle. league-pulse re-exports it, so nothing that already
 * imported it from there had to change.
 */
export function normalizeDraftPicks(input: unknown): unknown[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "object") return Object.values(input as Record<string, unknown>);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
    } catch {
      return [];
    }
  }
  return [];
}
