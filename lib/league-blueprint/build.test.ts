import { describe, expect, it } from "vitest";
import { buildBlueprintView, type BlueprintInputs } from "./build";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";
import { SLOTS, buildCards, buildLeague } from "./__fixtures__/league";

function inputs(over: Partial<BlueprintInputs> = {}): BlueprintInputs {
  const teams = buildLeague();
  const cards = buildCards(teams);
  const mine = teams[0];
  return {
    sleeperLeagueId: "123",
    season: "2026",
    rosterId: 1,
    generatedAt: "2026-10-29T15:00:00.000Z",
    isDynasty: true,
    isSuperflex: false,
    formatTags: [],
    formatDisplay: "Dynasty PPR",
    sourceSlug: "ktc",
    sourceDisplay: "KTC",
    pickSourceDisplay: null,
    cards,
    finderTeams: teams,
    startingSlots: SLOTS,
    pulse: null,
    ledger: null,
    signals: new Map(),
    trends: new Map(),
    formatTopValue: 9000,
    alignedSlots: SLOTS.map((t) => ({ token: t, label: t, description: t })),
    rawStarterSleeperIds: [mine.players[0], mine.players[1], mine.players[2], mine.players[3], mine.players[4], mine.players[7]]
      .map((p) => p.sleeperId!)
      .concat(["0"]),
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    spotlightWeek: null,
    strategy: { entries: [], playerIds: [], runs: 1 },
    settings: DEFAULT_LEAGUE_BLUEPRINT_SETTINGS,
    ...over,
  };
}

describe("buildBlueprintView", () => {
  const view = buildBlueprintView(inputs());

  it("aligns the lineup to Sleeper's positional starters, empty slot included", () => {
    expect(view.lineup).toHaveLength(SLOTS.length);
    expect(view.lineup[6].playerId).toBeNull();
    expect(view.lineup.every((l, i) => (i === 6 ? true : l.playerId !== null))).toBe(true);
  });

  it("grades six categories and computes an overall", () => {
    expect(view.grades.map((g) => g.key)).toEqual(["QB", "RB", "WR", "TE", "bench", "picks"]);
    expect(view.standing.overall).toBeGreaterThan(0);
    // The reader's backs are the league's worst.
    expect(view.grades.find((g) => g.key === "RB")!.grade).toBeLessThanOrEqual(2);
  });

  it("reports no standing without Power Pulse and says why", () => {
    expect(view.standing.status).toBeNull();
    expect(view.standing.standingNote).toMatch(/Power Pulse/);
  });

  it("calls every priced player and stores each player once", () => {
    const priced = Object.values(view.players).filter((p) => p.id.startsWith("r1-"));
    for (const p of priced) expect(view.calls[p.id]).toBeDefined();
    expect(Object.keys(view.players).length).toBeGreaterThanOrEqual(priced.length);
  });

  it("names a running back buy on another roster", () => {
    const rb = view.buys.find((g) => g.position === "RB");
    expect(rb?.targets.length).toBeGreaterThan(0);
    for (const t of rb!.targets) expect(view.players[t.playerId]).toBeDefined();
  });

  it("returns three priorities, the first about running back", () => {
    expect(view.priorities).toHaveLength(3);
    expect(view.priorities[0].text).toMatch(/running back/);
  });

  it("drops draft capital and the outlook in redraft and says so", () => {
    const redraft = buildBlueprintView(inputs({ isDynasty: false }));
    expect(redraft.capital).toBeNull();
    expect(redraft.grades.find((g) => g.key === "picks")!.grade).toBeNull();
    expect(redraft.standing.outlook).toBeNull();
    expect(redraft.standing.outlookNote).toMatch(/redraft/);
  });

  it("stays under 40 KB as JSON", () => {
    expect(JSON.stringify(view).length).toBeLessThan(40_000);
  });
});
