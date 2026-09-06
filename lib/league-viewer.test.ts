import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchViewerRoster, type ViewerCandidate } from "@/lib/league-viewer";

/**
 * "Whose team it is" is decided once, in lib/league-viewer.ts, and used by
 * both the client TeamFilter and any server caller. Extracted verbatim from
 * the former components/team-filter.tsx resolveOwnerRosterId, so these tests
 * pin the exact rule down: ?roster= wins when it names a real team, then the
 * viewer's Sleeper user id (owner, then co-owner), then a case-insensitive
 * trimmed handle match, else null.
 *
 * The id path is the fix for the defect described in D3: a saved handle is a
 * Sleeper USERNAME and the name path compares against a DISPLAY NAME, so a
 * reader whose two names differ matched nobody on their own league.
 */
describe("matchViewerRoster", () => {
  const teams: ViewerCandidate[] = [
    {
      sleeperRosterId: 1,
      ownerSleeperUsername: "Alice",
      ownerSleeperUserId: "u-alice",
      coOwnerIds: [],
    },
    {
      sleeperRosterId: 2,
      ownerSleeperUsername: "bob_the_builder",
      ownerSleeperUserId: "u-bob",
      coOwnerIds: ["u-carla"],
    },
    {
      sleeperRosterId: 3,
      ownerSleeperUsername: null,
      ownerSleeperUserId: null,
      coOwnerIds: [],
    },
  ];

  it("prefers ?roster= over ?username= when both match", () => {
    expect(matchViewerRoster(teams, "bob_the_builder", 1)).toBe(1);
  });

  it("prefers ?roster= over the viewer's Sleeper user id", () => {
    expect(matchViewerRoster(teams, null, 1, "u-bob")).toBe(1);
  });

  it("falls through to ?username= when ?roster= names no team", () => {
    expect(matchViewerRoster(teams, "bob_the_builder", 999)).toBe(2);
  });

  it("matches ?username= case-insensitively and trims whitespace", () => {
    expect(matchViewerRoster(teams, "  ALICE  ", null)).toBe(1);
    expect(matchViewerRoster(teams, "BOB_THE_BUILDER", undefined)).toBe(2);
  });

  it("matches on the Sleeper user id when the handle matches nobody", () => {
    // The whole point: this reader's saved USERNAME is nothing like the
    // DISPLAY NAME the league stores, and the id still finds their roster.
    expect(matchViewerRoster(teams, "bobs-real-handle", null, "u-bob")).toBe(2);
  });

  it("lets the id beat a name that points at a different team", () => {
    expect(matchViewerRoster(teams, "Alice", null, "u-bob")).toBe(2);
  });

  it("matches a co-owner by id", () => {
    expect(matchViewerRoster(teams, null, null, "u-carla")).toBe(2);
  });

  it("prefers the owner over a co-owner when one id is both", () => {
    const shared: ViewerCandidate[] = [
      {
        sleeperRosterId: 7,
        ownerSleeperUsername: "dee",
        ownerSleeperUserId: "u-other",
        coOwnerIds: ["u-dee"],
      },
      {
        sleeperRosterId: 8,
        ownerSleeperUsername: "dee",
        ownerSleeperUserId: "u-dee",
        coOwnerIds: [],
      },
    ];
    expect(matchViewerRoster(shared, null, null, "u-dee")).toBe(8);
  });

  it("still uses the name path when the viewer has no id", () => {
    expect(matchViewerRoster(teams, "Alice", null, null)).toBe(1);
    expect(matchViewerRoster(teams, "Alice", null, undefined)).toBe(1);
    expect(matchViewerRoster(teams, "Alice", null, "   ")).toBe(1);
  });

  it("falls back to the name when the id matches no roster", () => {
    expect(matchViewerRoster(teams, "Alice", null, "u-nobody")).toBe(1);
  });

  it("never matches a null owner username against an empty or whitespace ?username=", () => {
    expect(matchViewerRoster(teams, "", null)).toBeNull();
    expect(matchViewerRoster(teams, "   ", null)).toBeNull();
    expect(matchViewerRoster(teams, null, null)).toBeNull();
    expect(matchViewerRoster(teams, undefined, undefined)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchViewerRoster(teams, "nobody-in-this-league", 42)).toBeNull();
    expect(matchViewerRoster(teams, "nobody-in-this-league", 42, "u-nobody")).toBeNull();
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
