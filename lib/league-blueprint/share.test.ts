import { describe, expect, it } from "vitest";
import { buildBlueprintShareCard, describeBlueprint } from "./share";
import { SECTION_HEIGHT, SHARE_GAP, prioritiesHeight, shareLayout, strategyHeight } from "./share-layout";
import { buildBlueprintView } from "./build";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";
import { SLOTS, buildCards, buildLeague } from "./__fixtures__/league";

function view() {
  const teams = buildLeague();
  return buildBlueprintView({
    sleeperLeagueId: "123",
    season: "2026",
    rosterId: 1,
    generatedAt: "2026-10-29T15:00:00.000Z",
    isDynasty: true,
    isSuperflex: false,
    formatTags: [{ key: "teams", label: "12 teams", tone: "format" }],
    formatDisplay: "Dynasty PPR",
    sourceSlug: "ktc",
    sourceDisplay: "KTC",
    pickSourceDisplay: null,
    cards: buildCards(teams),
    finderTeams: teams,
    startingSlots: SLOTS,
    pulse: null,
    ledger: null,
    signals: new Map(),
    trends: new Map(),
    formatTopValue: 9000,
    alignedSlots: SLOTS.map((t) => ({ token: t, label: t, description: t })),
    rawStarterSleeperIds: teams[0].players.slice(0, 7).map((p) => p.sleeperId!),
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    spotlightWeek: null,
    strategy: { entries: [], playerIds: [], runs: 1 },
    settings: DEFAULT_LEAGUE_BLUEPRINT_SETTINGS,
  });
}

describe("share card", () => {
  it("is built from the view alone", () => {
    const v = view();
    const card = buildBlueprintShareCard(v);
    expect(card.teamName).toBe("Team 1");
    expect(card.overall).toBe(v.standing.overall);
    expect(card.grades.map((g) => g.code)).toEqual(["QB", "RB", "WR", "TE", "BN", "DC"]);
    expect(card.lineup).toHaveLength(SLOTS.length);
    expect(card.formatTags).toEqual(["12 teams"]);
  });

  it("describes the blueprint in one sentence", () => {
    const v = view();
    const s = describeBlueprint(v);
    expect(s.startsWith(`Team 1's blueprint: overall grade ${v.standing.overall.toFixed(1)} of 10`)).toBe(true);
    expect(s).toContain(`first priority: ${v.priorities[0].text}`);
  });
});

describe("share layout", () => {
  it("sums section heights and gaps", () => {
    const l = shareLayout({ slots: 9, capitalSeasons: 3 });
    const sum = l.sections.reduce((a, s) => a + s.height, 0);
    expect(l.height).toBe(sum + SHARE_GAP * (l.sections.length + 1));
  });

  it("grows with the slot count", () => {
    expect(shareLayout({ slots: 14, capitalSeasons: 3 }).height).toBeGreaterThan(
      shareLayout({ slots: 9, capitalSeasons: 3 }).height,
    );
  });
});

describe("measured text sections", () => {
  it("takes the fixed height when nothing was measured", () => {
    expect(prioritiesHeight(undefined)).toBe(SECTION_HEIGHT.priorities);
    expect(strategyHeight(undefined)).toBe(SECTION_HEIGHT.strategy);
  });

  it("shrinks to short text and never passes the fixed height", () => {
    expect(prioritiesHeight([1, 1, 1])).toBeLessThan(SECTION_HEIGHT.priorities);
    expect(prioritiesHeight([3, 2, 2])).toBeLessThanOrEqual(SECTION_HEIGHT.priorities);
    expect(strategyHeight([1, 1, 1])).toBeLessThan(SECTION_HEIGHT.strategy);
    expect(strategyHeight([2, 2, 2])).toBeLessThanOrEqual(SECTION_HEIGHT.strategy);
  });

  it("lets a longer priority grow the card", () => {
    const short = shareLayout({ slots: 9, capitalSeasons: 3, priorityLines: [1, 1, 1], strategyLines: [1, 1, 1] });
    const long = shareLayout({ slots: 9, capitalSeasons: 3, priorityLines: [3, 2, 2], strategyLines: [2, 2, 2] });
    expect(long.height).toBeGreaterThan(short.height);
  });
});
