import { describe, it, expect } from "vitest";
import { buildWaiverDigest, buildWaiverWriteup, type WaiverMove, type WaiverPlayer } from "./waiver-writeup";
import type { RelayLeague, RelayTeam } from "./types";
import { buildRelayHeader } from "./header";

const league: RelayLeague = {
  id: "league-1",
  sleeperLeagueId: "123",
  name: "The Test League",
  season: 2026,
  totalRosters: 12,
  rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
  metadata: {},
  watermarkAt: new Date(0).toISOString(),
  header: buildRelayHeader({
    leagueName: "The Test League",
    season: 2026,
    totalRosters: 12,
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
    sleeperLeague: null,
  }),
};

function team(id: number, name: string): RelayTeam {
  return {
    sleeperRosterId: id,
    name,
    handle: name,
    teamName: null,
    record: { wins: 3, losses: 2, ties: 0 },
  };
}

function player(name: string, over: Partial<WaiverPlayer> = {}): WaiverPlayer {
  return {
    name,
    position: "RB",
    nflTeam: "BUF",
    injuryStatus: null,
    projectedPoints: 8,
    value: 100,
    change30dPct: null,
    positionRank: null,
    ...over,
  };
}

function move(over: Partial<WaiverMove> = {}): WaiverMove {
  return {
    team: team(1, "Alpha"),
    pulseRank: 4,
    kind: "waiver",
    added: [player("Incoming Guy")],
    dropped: [],
    faabSpent: 10,
    week: 3,
    seedKey: "waiver:league-1:tx1",
    ...over,
  };
}

const digestBase = {
  league,
  kind: "waiver" as const,
  week: 3,
  faabBudget: 100,
  faabMedian: 8,
  snark: 0.8,
  showNumbers: true,
  url: null,
  seedKey: "waiver-digest:league-1:tx1",
};

function textOf(writeup: ReturnType<typeof buildWaiverDigest>): string {
  return (writeup?.sections ?? []).map((s) => s.text).join("\n\n");
}

describe("buildWaiverDigest", () => {
  it("lists EVERY move, however many there are", () => {
    // The rule the digest exists to serve. A list that says "and three more"
    // has all of the wall's uselessness and none of its completeness.
    const moves = Array.from({ length: 14 }, (_, i) =>
      move({ added: [player(`Player ${i}`)], seedKey: `k${i}` }),
    );
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    for (let i = 0; i < 14; i += 1) expect(text).toContain(`Player ${i}`);
  });

  it("names each team when more than one manager moved", () => {
    const moves = [
      move({ team: team(1, "Alpha"), added: [player("A One")] }),
      move({ team: team(2, "Bravo"), added: [player("B One")], seedKey: "k2" }),
      move({ team: team(3, "Charlie"), added: [player("C One")], seedKey: "k3" }),
      move({ team: team(4, "Delta"), added: [player("D One")], seedKey: "k4" }),
    ];
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    expect(text).toContain("**Alpha**");
    expect(text).toContain("**Bravo**");
    expect(text).toContain("across 4 teams");
  });

  it("stops repeating one manager's name on every line when they made every move", () => {
    // The intro already says it. Twelve repetitions of the same name is noise.
    const moves = Array.from({ length: 5 }, (_, i) =>
      move({ added: [player(`Player ${i}`)], seedKey: `k${i}` }),
    );
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    expect(text).toContain("every one of them from Alpha");
    expect(text).not.toContain("**Alpha** get");
  });

  it("reads a drop as a drop rather than as an arrival with nobody in it", () => {
    const moves = Array.from({ length: 4 }, (_, i) =>
      move({
        team: team(i + 1, `Team ${i}`),
        added: [],
        dropped: [player(`Gone ${i}`)],
        faabSpent: null,
        seedKey: `k${i}`,
      }),
    );
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    expect(text).toContain("drop Gone 0");
    expect(text).not.toContain("cut loose");
  });

  it("calls out the biggest bid", () => {
    const moves = [
      move({ faabSpent: 61, added: [player("Expensive Guy")] }),
      move({ faabSpent: 3, seedKey: "k2" }),
      move({ faabSpent: 2, seedKey: "k3" }),
      move({ faabSpent: 1, seedKey: "k4" }),
    ];
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    expect(text).toContain("biggest bid of the run was 61");
    expect(text).toContain("Expensive Guy");
  });

  it("leaves the budget share off a bid too small to be worth quoting", () => {
    // "for 2 FAAB, 0% of a season's budget" says the same thing twice, the
    // second time wrongly.
    const moves = Array.from({ length: 4 }, (_, i) =>
      move({ faabSpent: 2, added: [player(`P${i}`)], seedKey: `k${i}` }),
    );
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    expect(text).toContain("for 2 FAAB.");
    expect(text).not.toContain("0% of a season's budget");
  });

  it("keeps the budget share on a bid that is actually large", () => {
    const moves = Array.from({ length: 4 }, (_, i) =>
      move({ faabSpent: i === 0 ? 40 : 1, added: [player(`P${i}`)], seedKey: `k${i}` }),
    );
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    expect(text).toContain("40% of a season's budget");
  });

  it("flags a valuable player who was cut rather than claimed", () => {
    const moves = [
      move({ added: [player("Cheap Add", { value: 10 })] }),
      move({
        team: team(2, "Bravo"),
        added: [],
        dropped: [player("Expensive Cut", { value: 900 })],
        faabSpent: null,
        seedKey: "k2",
      }),
      move({ team: team(3, "Charlie"), seedKey: "k3", added: [player("Another", { value: 5 })] }),
      move({ team: team(4, "Delta"), seedKey: "k4", added: [player("More", { value: 5 })] }),
    ];
    const text = textOf(buildWaiverDigest({ ...digestBase, moves }));
    expect(text).toContain("Expensive Cut");
    expect(text).toContain("let go rather than won");
  });

  it("returns nothing for an empty run rather than an empty message", () => {
    expect(buildWaiverDigest({ ...digestBase, moves: [] })).toBeNull();
  });

  it("marks the list as essential, so a squeeze can never drop it", () => {
    const moves = Array.from({ length: 5 }, (_, i) => move({ seedKey: `k${i}` }));
    const writeup = buildWaiverDigest({ ...digestBase, moves });
    const list = writeup?.sections.find((s) => s.key === "list");
    expect(list?.priority).toBe(0);
  });
});

describe("buildWaiverWriteup", () => {
  const base = {
    league,
    faabBudget: 100,
    faabMedian: 8,
    weakestPosition: null,
    snark: 0.8,
    showNumbers: true,
    url: null,
  };

  it("writes prose, not a stack of one-line facts", () => {
    const writeup = buildWaiverWriteup({ ...base, ...move() });
    const text = (writeup?.sections ?? []).map((s) => s.text).join("\n\n");
    // The projection and the market read belong in one breath. Two sentences on
    // two lines was a bullet list with the bullets taken off.
    expect(text).toContain("points a week under this league's scoring");
    expect(text).not.toContain("**In**");
  });

  it("titles a move with nobody coming back as a cut", () => {
    const writeup = buildWaiverWriteup({
      ...base,
      ...move({ added: [], dropped: [player("Gone Guy")], faabSpent: null }),
    });
    expect(writeup?.title).toContain("Cut:");
    expect(writeup?.title).toContain("Gone Guy");
  });

  it("still covers a bare drop, because cutting a starter is news", () => {
    const writeup = buildWaiverWriteup({
      ...base,
      ...move({ added: [], dropped: [player("Gone Guy")], faabSpent: null }),
    });
    expect(writeup).not.toBeNull();
  });

  it("returns nothing when nothing actually moved", () => {
    expect(buildWaiverWriteup({ ...base, ...move({ added: [], dropped: [] }) })).toBeNull();
  });

  it("never attaches a poll: one manager acted alone", () => {
    expect(buildWaiverWriteup({ ...base, ...move() })?.poll).toBeNull();
  });
});
