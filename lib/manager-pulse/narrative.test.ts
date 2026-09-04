import { describe, expect, it } from "vitest";
import { buildNarrative, NARRATIVE_TEMPLATE_IDS } from "./narrative";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type { ManagerPulseSettings } from "./default-settings";
import type { ManagerReport } from "./types";

/* -------------------------------------------------------------------------- */
/* A fully-null report. Every guard in narrative.ts must fail against this.   */
/* -------------------------------------------------------------------------- */

function nullReport(): ManagerReport {
  return {
    identity: {
      sleeperUserId: "user-1",
      handle: "TestManager",
      avatarUrl: null,
      seasonsCovered: 0,
      leagueSeasonsFound: 0,
      splits: { dynasty: 0, redraft: 0, bestBallDynasty: 0, bestBallRedraft: 0 },
      firstSeasonSeen: null,
    },
    results: {
      sampleSize: { all: null, dynasty: null, redraft: null },
      record: { all: null, dynasty: null, redraft: null },
      winRate: { all: null, dynasty: null, redraft: null },
      championships: { all: null, dynasty: null, redraft: null },
      runnerUps: { all: null, dynasty: null, redraft: null },
      playoffRate: { all: null, dynasty: null, redraft: null },
      lastPlaceFinishes: { all: null, dynasty: null, redraft: null },
      avgFinishPercentile: { all: null, dynasty: null, redraft: null },
      pointsForRank: { all: null, dynasty: null, redraft: null },
      pointsAgainstRank: { all: null, dynasty: null, redraft: null },
    },
    drafting: {
      reachIndexRounds: { all: null, dynasty: null, redraft: null },
      reachIndexSampleSize: { all: null, dynasty: null, redraft: null },
      firstRoundsShape: { all: null, dynasty: null, redraft: null },
      firstRoundsSampleSize: { all: null, dynasty: null, redraft: null },
      rookieVeteranLean: null,
      rookieVeteranLeanSampleSize: 0,
      keeperUsageRate: null,
      keeperUsageSampleSize: 0,
      avgDraftGrade: { all: null, dynasty: null, redraft: null },
      avgDraftGradeSampleSize: { all: null, dynasty: null, redraft: null },
      draftPace: null,
      perPickClock: null,
      autopick: null,
    },
    affinity: {
      favourites: [],
      favouritesSampleSize: 0,
      avoids: [],
      avoidsSampleSize: 0,
      repeatDrafts: [],
      repeatDraftsSampleSize: 0,
    },
    trading: {
      tradeCount: { all: null, dynasty: null, redraft: null },
      tradesPerSeason: { all: null, dynasty: null, redraft: null },
      avgValueMargin: { dynasty: null, redraft: null },
      avgValueMarginSampleSize: { dynasty: null, redraft: null },
      verdictDistribution: { dynasty: {}, redraft: {} },
      positionAppetite: { dynasty: null, redraft: null },
      ageLean: null,
      ageLeanSampleSize: 0,
      picksTraded: { dynasty: null, redraft: null },
      mostTradedWith: { dynasty: [], redraft: [] },
      overpays: { dynasty: [], redraft: [] },
      tradesWithUnpricedPicks: { dynasty: null, redraft: null },
    },
    rosterOps: {
      movesPerWeek: { all: null, dynasty: null, redraft: null },
      moveShape: { all: null, dynasty: null, redraft: null },
      waiverClaimsPerSeason: { all: null, dynasty: null, redraft: null },
      avgFaabBidShare: { all: null, dynasty: null, redraft: null },
      waiverPointsProduced: { all: null, dynasty: null, redraft: null },
      lineupEfficiency: { all: null, dynasty: null, redraft: null },
      lineupEfficiencySampleSize: { all: null, dynasty: null, redraft: null },
      bestLineupRecord: { all: null, dynasty: null, redraft: null },
      winsLeftOnBench: { all: null, dynasty: null, redraft: null },
      abandonmentCount: { all: null, dynasty: null, redraft: null },
    },
    narrative: { sentences: [] },
    leagues: [],
    defaultLens: "all",
    window: { seasonFrom: 2023, seasonTo: 2026 },
    counts: { leagueSeasons: 0, dynasty: 0, redraft: 0 },
    generatedAt: "2026-01-01T00:00:00.000Z",
    modelVersion: "mp-1",
    limits: { leagueSeasonsSkipped: 0, leagueSeasonsWithoutLedger: 0, seasonsWithoutDraftObservations: 0 },
  };
}

function withReport(mutate: (r: ManagerReport) => void): ManagerReport {
  const report = nullReport();
  mutate(report);
  return report;
}

function settings(overrides: Partial<ManagerPulseSettings["display"]> = {}): ManagerPulseSettings {
  return {
    ...DEFAULT_MANAGER_PULSE_SETTINGS,
    display: { ...DEFAULT_MANAGER_PULSE_SETTINGS.display, ...overrides },
  };
}

/**
 * A single fixture wired to fire ten of the fifteen templates at once (the
 * remaining five are each the mutually-exclusive OTHER side of a pair this
 * fixture already picked one side of). Used by the cap, banned-character and
 * inline-sample-size tests, which each want many real sentences to check.
 */
function manyFiringReport(): ManagerReport {
  return withReport((r) => {
    r.identity.seasonsCovered = 4;
    r.counts.leagueSeasons = 31;

    r.trading.tradeCount = { all: 20, dynasty: 14, redraft: 6 };
    r.trading.tradesPerSeason = { all: 5, dynasty: 3.5, redraft: 1.5 };
    r.trading.avgValueMargin = { dynasty: -0.08, redraft: 0.05 };
    r.trading.avgValueMarginSampleSize = { dynasty: 11, redraft: 7 };
    r.trading.ageLean = 0.3;
    r.trading.ageLeanSampleSize = 9;
    r.trading.picksTraded = { dynasty: 0, redraft: 2 };

    r.rosterOps.moveShape.all = "front-loaded";
    r.rosterOps.lineupEfficiency.all = 0.96;
    r.rosterOps.lineupEfficiencySampleSize.all = 9;

    r.drafting.reachIndexRounds.all = 0.8;
    r.drafting.reachIndexSampleSize.all = 6;

    r.results.championships.all = 3;
    r.results.sampleSize.all = 19;
    r.results.pointsForRank.all = 0.5;
    r.results.pointsAgainstRank.all = 0.1;
  });
}

/* -------------------------------------------------------------------------- */
/* Null-everything                                                            */
/* -------------------------------------------------------------------------- */

describe("buildNarrative", () => {
  it("fires none of its templates when every figure is null", () => {
    const result = buildNarrative(nullReport(), DEFAULT_MANAGER_PULSE_SETTINGS);
    expect(result.sentences).toEqual([]);
    for (const id of NARRATIVE_TEMPLATE_IDS) {
      expect(result.sentences.some((s) => s.templateId === id)).toBe(false);
    }
  });

  it("declares between 10 and 16 templates", () => {
    expect(NARRATIVE_TEMPLATE_IDS.length).toBeGreaterThanOrEqual(10);
    expect(NARRATIVE_TEMPLATE_IDS.length).toBeLessThanOrEqual(16);
  });

  /* -------------------------------------------------------------------------- */
  /* Each template, fired individually                                        */
  /* -------------------------------------------------------------------------- */

  it("trades_often fires on a high per-season rate and cites both counts", () => {
    const report = withReport((r) => {
      r.identity.seasonsCovered = 4;
      r.trading.tradeCount.all = 14;
      r.trading.tradesPerSeason.all = 3.5;
    });
    const result = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS);
    const sentence = result.sentences.find((s) => s.templateId === "trades_often");
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("14");
    expect(sentence!.text).toContain("4");
    expect(sentence!.sampleSize).toBe(14);
  });

  it("trades_rarely fires on a low per-season rate", () => {
    const report = withReport((r) => {
      r.identity.seasonsCovered = 3;
      r.trading.tradeCount.all = 1;
      r.trading.tradesPerSeason.all = 0.33;
    });
    const result = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS);
    const sentence = result.sentences.find((s) => s.templateId === "trades_rarely");
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("1");
    expect(sentence!.sampleSize).toBe(1);
  });

  it("trades_often and trades_rarely never fire together", () => {
    const often = withReport((r) => {
      r.trading.tradeCount.all = 14;
      r.trading.tradesPerSeason.all = 3.5;
    });
    const rare = withReport((r) => {
      r.trading.tradeCount.all = 1;
      r.trading.tradesPerSeason.all = 0.33;
    });
    const oftenIds = buildNarrative(often, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId);
    const rareIds = buildNarrative(rare, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId);
    expect(oftenIds).toContain("trades_often");
    expect(oftenIds).not.toContain("trades_rarely");
    expect(rareIds).toContain("trades_rarely");
    expect(rareIds).not.toContain("trades_often");
  });

  it("pays_up_dynasty fires on a negative dynasty margin and names dynasty", () => {
    const report = withReport((r) => {
      r.trading.avgValueMargin.dynasty = -0.08;
      r.trading.avgValueMarginSampleSize.dynasty = 11;
    });
    const sentence = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.find(
      (s) => s.templateId === "pays_up_dynasty",
    );
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("dynasty");
    expect(sentence!.text).toContain("8%");
    expect(sentence!.text).toContain("11");
    expect(sentence!.sampleSize).toBe(11);
  });

  it("gets_value_dynasty fires on a positive dynasty margin, never alongside pays_up_dynasty", () => {
    const report = withReport((r) => {
      r.trading.avgValueMargin.dynasty = 0.08;
      r.trading.avgValueMarginSampleSize.dynasty = 5;
    });
    const ids = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId);
    expect(ids).toContain("gets_value_dynasty");
    expect(ids).not.toContain("pays_up_dynasty");
  });

  it("pays_up_redraft fires on a negative redraft margin and names redraft", () => {
    const report = withReport((r) => {
      r.trading.avgValueMargin.redraft = -0.1;
      r.trading.avgValueMarginSampleSize.redraft = 6;
    });
    const sentence = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.find(
      (s) => s.templateId === "pays_up_redraft",
    );
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("redraft");
    expect(sentence!.text).toContain("10%");
  });

  it("gets_value_redraft fires on a positive redraft margin", () => {
    const report = withReport((r) => {
      r.trading.avgValueMargin.redraft = 0.05;
      r.trading.avgValueMarginSampleSize.redraft = 7;
    });
    const ids = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId);
    expect(ids).toContain("gets_value_redraft");
  });

  it("wont_trade_picks fires only at zero picks with enough trades to call it a habit", () => {
    const belowFloor = withReport((r) => {
      r.trading.picksTraded.dynasty = 0;
      r.trading.tradeCount.dynasty = 1;
    });
    expect(
      buildNarrative(belowFloor, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId),
    ).not.toContain("wont_trade_picks");

    const atFloor = withReport((r) => {
      r.trading.picksTraded.dynasty = 0;
      r.trading.tradeCount.dynasty = 14;
    });
    const sentence = buildNarrative(atFloor, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.find(
      (s) => s.templateId === "wont_trade_picks",
    );
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("dynasty");
    expect(sentence!.text).toContain("14");
  });

  it("buys_young_dynasty and buys_production_dynasty are opposite signs of the same figure", () => {
    const young = withReport((r) => {
      r.trading.ageLean = 0.3;
      r.trading.ageLeanSampleSize = 9;
    });
    const old = withReport((r) => {
      r.trading.ageLean = -0.3;
      r.trading.ageLeanSampleSize = 9;
    });
    const youngIds = buildNarrative(young, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId);
    const oldIds = buildNarrative(old, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId);
    expect(youngIds).toContain("buys_young_dynasty");
    expect(youngIds).not.toContain("buys_production_dynasty");
    expect(oldIds).toContain("buys_production_dynasty");
    expect(oldIds).not.toContain("buys_young_dynasty");

    const youngSentence = buildNarrative(young, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.find(
      (s) => s.templateId === "buys_young_dynasty",
    )!;
    expect(youngSentence.text).toContain("dynasty");
    expect(youngSentence.text).toContain("9");
  });

  it("good_lineup fires above the efficiency threshold and cites the coverage fraction", () => {
    const report = withReport((r) => {
      r.rosterOps.lineupEfficiency.all = 0.96;
      r.rosterOps.lineupEfficiencySampleSize.all = 9;
      r.counts.leagueSeasons = 31;
    });
    const sentence = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.find(
      (s) => s.templateId === "good_lineup",
    );
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("96%");
    expect(sentence!.text).toContain("9");
    expect(sentence!.text).toContain("31");
  });

  it("poor_lineup fires below the efficiency threshold", () => {
    const report = withReport((r) => {
      r.rosterOps.lineupEfficiency.all = 0.78;
      r.rosterOps.lineupEfficiencySampleSize.all = 5;
      r.counts.leagueSeasons = 31;
    });
    const ids = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId);
    expect(ids).toContain("poor_lineup");
    expect(ids).not.toContain("good_lineup");
  });

  it("drafts_early fires on a positive reach index and cites the rounds and the sample", () => {
    const report = withReport((r) => {
      r.drafting.reachIndexRounds.all = 0.8;
      r.drafting.reachIndexSampleSize.all = 6;
    });
    const sentence = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.find(
      (s) => s.templateId === "drafts_early",
    );
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("0.8");
    expect(sentence!.text).toContain("6");
  });

  it("front_loaded_moves fires only when the shape is front-loaded", () => {
    const front = withReport((r) => {
      r.rosterOps.moveShape.all = "front-loaded";
      r.counts.leagueSeasons = 12;
    });
    const steady = withReport((r) => {
      r.rosterOps.moveShape.all = "steady";
      r.counts.leagueSeasons = 12;
    });
    expect(
      buildNarrative(front, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId),
    ).toContain("front_loaded_moves");
    expect(
      buildNarrative(steady, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId),
    ).not.toContain("front_loaded_moves");
  });

  it("wins fires only above zero championships and cites both counts", () => {
    const report = withReport((r) => {
      r.results.championships.all = 3;
      r.results.sampleSize.all = 19;
    });
    const sentence = buildNarrative(report, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.find(
      (s) => s.templateId === "wins",
    );
    expect(sentence).toBeDefined();
    expect(sentence!.text).toContain("3");
    expect(sentence!.text).toContain("19");

    const zero = withReport((r) => {
      r.results.championships.all = 0;
      r.results.sampleSize.all = 19;
    });
    expect(
      buildNarrative(zero, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId),
    ).not.toContain("wins");
  });

  it("unlucky fires only when middling on points for and worst on points against", () => {
    const unlucky = withReport((r) => {
      r.results.pointsForRank.all = 0.5;
      r.results.pointsAgainstRank.all = 0.1;
      r.results.sampleSize.all = 19;
    });
    const goodLuck = withReport((r) => {
      r.results.pointsForRank.all = 0.5;
      r.results.pointsAgainstRank.all = 0.9;
      r.results.sampleSize.all = 19;
    });
    expect(
      buildNarrative(unlucky, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId),
    ).toContain("unlucky");
    expect(
      buildNarrative(goodLuck, DEFAULT_MANAGER_PULSE_SETTINGS).sentences.map((s) => s.templateId),
    ).not.toContain("unlucky");
  });

  /* -------------------------------------------------------------------------- */
  /* Cross-cutting rules                                                        */
  /* -------------------------------------------------------------------------- */

  it("caps the output at settings.display.narrativeSentencesMax, in priority order", () => {
    const report = manyFiringReport();
    const capped = buildNarrative(report, settings({ narrativeSentencesMax: 3 }));
    expect(capped.sentences).toHaveLength(3);
    // Priority order is trades_often, trades_rarely, pays_up_dynasty,
    // gets_value_dynasty, pays_up_redraft, gets_value_redraft, wont_trade_picks,
    // ... . manyFiringReport() fires trades_often, pays_up_dynasty and
    // gets_value_redraft (redraft's margin is positive), in that order; the
    // three templates in between all fail their guard, and wont_trade_picks
    // never gets evaluated because the cap is already full by the time the
    // loop reaches it.
    expect(capped.sentences.map((s) => s.templateId)).toEqual([
      "trades_often",
      "pays_up_dynasty",
      "gets_value_redraft",
    ]);
  });

  it("respects a higher cap by returning every template that actually fired", () => {
    const report = manyFiringReport();
    const uncapped = buildNarrative(report, settings({ narrativeSentencesMax: 20 }));
    expect(uncapped.sentences.length).toBeGreaterThanOrEqual(10);
    expect(uncapped.sentences.length).toBeLessThanOrEqual(NARRATIVE_TEMPLATE_IDS.length);
  });

  it("contains no banned character in any fired sentence", () => {
    const report = manyFiringReport();
    const result = buildNarrative(report, settings({ narrativeSentencesMax: 20 }));
    expect(result.sentences.length).toBeGreaterThan(0);

    const banned = [
      "—", // em dash
      "–", // en dash
      "“", // left curly double quote
      "”", // right curly double quote
      "‘", // left curly single quote
      "’", // right curly single quote
      "…", // ellipsis character
      "·", // middle dot
    ];
    for (const sentence of result.sentences) {
      for (const char of banned) {
        expect(sentence.text.includes(char)).toBe(false);
      }
      // A broad emoji sanity net: nothing in these templates should ever
      // reach a codepoint in the emoji astral range.
      for (const ch of Array.from(sentence.text)) {
        const codepoint = ch.codePointAt(0) ?? 0;
        expect(codepoint).toBeLessThan(0x1f300);
      }
    }
  });

  it("every fired sentence's text contains its own sampleSize as a substring", () => {
    const report = manyFiringReport();
    const result = buildNarrative(report, settings({ narrativeSentencesMax: 20 }));
    expect(result.sentences.length).toBeGreaterThan(0);
    for (const sentence of result.sentences) {
      if (sentence.sampleSize === null) continue;
      expect(sentence.text).toContain(String(sentence.sampleSize));
    }
  });
});
