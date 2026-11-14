import { describe, expect, it } from "vitest";
import { buildBlueprintView, EmptyRosterError, type BlueprintInputs } from "./build";
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
    leagueKind: "dynasty",
    isBestBall: false,
    frozenSeasonNote: null,
    signalWindowDays: 30,
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
    const redraft = buildBlueprintView(inputs({ isDynasty: false, leagueKind: "redraft" }));
    expect(redraft.capital).toBeNull();
    expect(redraft.grades.find((g) => g.key === "picks")!.grade).toBeNull();
    expect(redraft.grades.find((g) => g.key === "picks")!.reason).toBe("Not scored in redraft leagues.");
    expect(redraft.standing.outlook).toBeNull();
    expect(redraft.standing.outlookNote).toMatch(/redraft/);
  });

  it("grades draft capital in a keeper league and leaves it out of chopped", () => {
    const keeper = buildBlueprintView(inputs({ isDynasty: false, leagueKind: "keeper" }));
    expect(keeper.grades.find((g) => g.key === "picks")!.grade).not.toBeNull();
    expect(keeper.capital).not.toBeNull();
    const chopped = buildBlueprintView(inputs({ isDynasty: false, leagueKind: "chopped" }));
    expect(chopped.grades.find((g) => g.key === "picks")!.grade).toBeNull();
    expect(chopped.capital).toBeNull();
    expect(chopped.standing.outlookNote).toMatch(/lowest score each week is cut/);
    expect(chopped.header.leagueKind).toBe("chopped");
  });

  it("counts only rosters with players as the league, and refuses an empty roster", () => {
    const teams = buildLeague();
    const cards = buildCards(teams);
    const emptied = cards.map((c, i) => (i === cards.length - 1 ? { ...c, players: [] } : c));
    const v = buildBlueprintView(inputs({ cards: emptied }));
    expect(v.header.teamCount).toBe(cards.length - 1);
    const mineEmpty = cards.map((c, i) => (i === 0 ? { ...c, players: [] } : c));
    expect(() => buildBlueprintView(inputs({ cards: mineEmpty }))).toThrow(EmptyRosterError);
  });

  it("keeps the starter share of value and carries the frozen season note", () => {
    const v = buildBlueprintView(inputs({ frozenSeasonNote: "Final roster from the 2025 season." }));
    expect(v.header.frozenSeasonNote).toBe("Final roster from the 2025 season.");
    const c = buildCards(buildLeague())[0].cacheRow;
    const expected = c && c.starter_value + c.bench_value > 0
      ? Math.round((100 * c.starter_value) / (c.starter_value + c.bench_value))
      : null;
    expect(v.standing.starterSharePct).toBe(expected);
  });

  it("stays under 40 KB as JSON", () => {
    expect(JSON.stringify(view).length).toBeLessThan(40_000);
  });
});
