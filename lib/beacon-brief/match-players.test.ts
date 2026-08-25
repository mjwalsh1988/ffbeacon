import { describe, expect, it } from "vitest";
import { matchReferences } from "./match";
import type { CategorizeResult } from "./types";
import type { BeaconBriefSettings } from "./settings";

/**
 * Player matching applies NO relevance filter, and that is the point of these
 * tests.
 *
 * It used to gate on `players.status` being "active" or "ir". That failed in the
 * single case the Brief handles most often: Sleeper reports a player on injured
 * reserve as "Inactive", so an article about a season-ending injury could not
 * link to the player whose injury it was. It went to manual review instead, and
 * the reason it went there was the injury.
 *
 * The owner's instruction is that this search must not be limited in any way:
 * linking an article to a retired player, or anyone else, has to be possible.
 * News is written about whoever it is written about.
 *
 * What actually keeps a link safe is the exact normalized-name match and the
 * one-result rule. Those are tested here alongside the absence of the filter, so
 * removing the filter cannot quietly become "link anything that looks close".
 */

type Candidate = {
  id: string;
  full_name: string;
  status: string | null;
  team: string | null;
  pos: string | null;
  sim: number;
};

const SETTINGS = {
  matchCandidateLimit: 8,
  matchSimilarityThreshold: 0.3,
} as unknown as BeaconBriefSettings;

function ai(players: string[]): CategorizeResult {
  return { category_slug: null, players, teams: [] } as unknown as CategorizeResult;
}

/** Admin fake: the RPC returns the candidates a test hands it, nothing filters. */
function makeAdmin(candidates: Candidate[]) {
  const api = {
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: [], error: null })),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: candidates, error: null }),
  };
  return api as never;
}

const pearsall = (status: string | null): Candidate => ({
  id: "p-pearsall",
  full_name: "Ricky Pearsall",
  status,
  team: "SF",
  pos: "WR",
  sim: 1,
});

describe("matchReferences, players", () => {
  it("links a player on injured reserve", async () => {
    // The bug. Sleeper reports an IR player as "Inactive", and the article most
    // likely to name him is the one about the injury.
    const result = await matchReferences(
      makeAdmin([pearsall("inactive")]),
      ai(["Ricky Pearsall"]),
      SETTINGS,
    );
    expect(result.playerIds).toContain("p-pearsall");
    expect(result.pending).toHaveLength(0);
  });

  it.each(["active", "ir", "inactive", "practice_squad", "suspended", "pup", "retired", null])(
    "links a player whose status is %s",
    async (status) => {
      const result = await matchReferences(
        makeAdmin([pearsall(status)]),
        ai(["Ricky Pearsall"]),
        SETTINGS,
      );
      expect(result.playerIds).toEqual(["p-pearsall"]);
    },
  );

  it("links a retired player, because an article may be about one", async () => {
    const gore: Candidate = {
      id: "p-gore",
      full_name: "Frank Gore",
      status: "retired",
      team: null,
      pos: "RB",
      sim: 1,
    };
    const result = await matchReferences(makeAdmin([gore]), ai(["Frank Gore"]), SETTINGS);
    expect(result.playerIds).toEqual(["p-gore"]);
  });

  it("still refuses to link a name that is merely similar", async () => {
    // The safety that does the real work. Trigram similarity gets a candidate
    // into the list; only an exact normalized name gets it linked.
    const other: Candidate = {
      id: "p-other",
      full_name: "Ricky Pearsall Jr",
      status: "active",
      team: "SF",
      pos: "WR",
      sim: 0.9,
    };
    const result = await matchReferences(makeAdmin([other]), ai(["Rick Pearson"]), SETTINGS);
    expect(result.playerIds).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].kind).toBe("player");
  });

  it("still sends two same-named players to moderation rather than guessing", async () => {
    const a: Candidate = {
      id: "p-a",
      full_name: "Michael Thomas",
      status: "active",
      team: "NO",
      pos: "WR",
      sim: 1,
    };
    const b: Candidate = { ...a, id: "p-b", status: "retired", team: "HOU", pos: "S" };
    const result = await matchReferences(makeAdmin([a, b]), ai(["Michael Thomas"]), SETTINGS);
    expect(result.playerIds).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].candidates).toHaveLength(2);
  });

  it("notes an unusual roster situation in the moderation label", async () => {
    // Cosmetic only, and the one thing status is still read for: a human
    // choosing between two same-named players can see which is which.
    const a: Candidate = {
      id: "p-a",
      full_name: "Michael Thomas",
      status: "active",
      team: "NO",
      pos: "WR",
      sim: 1,
    };
    const b: Candidate = { ...a, id: "p-b", status: "retired", team: "HOU", pos: "S" };
    const result = await matchReferences(makeAdmin([a, b]), ai(["Michael Thomas"]), SETTINGS);
    const labels = result.pending[0].candidates.map((c) => c.label);
    expect(labels.some((l) => l.includes("[retired]"))).toBe(true);
    expect(labels.some((l) => !l.includes("["))).toBe(true);
  });
});
