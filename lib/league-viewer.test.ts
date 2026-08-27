import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchViewerRoster, type ViewerCandidate } from "@/lib/league-viewer";

/**
 * "Whose team it is" is decided once, in lib/league-viewer.ts, and used by
 * both the client TeamFilter and any server caller. Extracted verbatim from
 * the former components/team-filter.tsx resolveOwnerRosterId, so these tests
 * pin the exact rule down: ?roster= wins when it names a real team, then a
 * case-insensitive trimmed ?username= match, else null.
 */
describe("matchViewerRoster", () => {
  const teams: ViewerCandidate[] = [
    { sleeperRosterId: 1, ownerSleeperUsername: "Alice" },
    { sleeperRosterId: 2, ownerSleeperUsername: "bob_the_builder" },
    { sleeperRosterId: 3, ownerSleeperUsername: null },
  ];

  it("prefers ?roster= over ?username= when both match", () => {
    expect(matchViewerRoster(teams, "bob_the_builder", 1)).toBe(1);
  });

  it("falls through to ?username= when ?roster= names no team", () => {
    expect(matchViewerRoster(teams, "bob_the_builder", 999)).toBe(2);
  });

  it("matches ?username= case-insensitively and trims whitespace", () => {
    expect(matchViewerRoster(teams, "  ALICE  ", null)).toBe(1);
    expect(matchViewerRoster(teams, "BOB_THE_BUILDER", undefined)).toBe(2);
  });

  it("never matches a null owner username against an empty or whitespace ?username=", () => {
    expect(matchViewerRoster(teams, "", null)).toBeNull();
    expect(matchViewerRoster(teams, "   ", null)).toBeNull();
    expect(matchViewerRoster(teams, null, null)).toBeNull();
    expect(matchViewerRoster(teams, undefined, undefined)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchViewerRoster(teams, "nobody-in-this-league", 42)).toBeNull();
  });

  // E1a-5: the same inputs give the same answer whether called through the
  // extracted function or through what TeamFilter now calls. TeamFilter calls
  // matchViewerRoster directly, so this guards against a second copy of the
  // rule ever coming back into components/team-filter.tsx.
  it("is the only implementation: TeamFilter imports it and defines no local copy", () => {
    const source = readFileSync(
      join(process.cwd(), "components", "team-filter.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /import\s*\{\s*matchViewerRoster\s*\}\s*from\s*["']@\/lib\/league-viewer["']/,
    );
    expect(source).not.toMatch(/function\s+resolveOwnerRosterId/);
  });
});
