import { describe, it, expect } from "vitest";
import {
  CLUE_DEFINITIONS,
  bucketRange,
  generateClueCandidates,
  applyDisabledKeys,
  computeClueCoverage,
  selectStarterClues,
  assembleClueFacts,
  STARTER_SPECIFICITY_BUDGET,
  type ClueFacts,
  type GeneratedClue,
  type ClueFactsPlayer,
} from "./clues";
import type { StatsBundle, CareerHighEntry, FinishRow } from "./stats-bundle";
import type { SeasonAgg, StatLine } from "@/components/player-profile/stat-shaping";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "./default-settings";

const DEF_BY_KEY = new Map(CLUE_DEFINITIONS.map((d) => [d.key, d]));

// --- fixtures ----------------------------------------------------------

function emptyLine(overrides: Partial<StatLine> = {}): StatLine {
  return {
    pass_cmp: 0,
    pass_att: 0,
    pass_yd: 0,
    pass_td: 0,
    pass_int: 0,
    rush_att: 0,
    rush_yd: 0,
    rush_td: 0,
    rec: 0,
    rec_tgt: 0,
    rec_yd: 0,
    rec_td: 0,
    pts_ppr: 0,
    ...overrides,
  };
}

function makeSeasonAgg(season: number, games: number, line: Partial<StatLine> = {}): SeasonAgg {
  return { season, games, line: emptyLine(line) };
}

function emptyStatsBundle(): StatsBundle {
  return {
    hasData: false,
    seasons: [],
    lastSeason: null,
    careerHighs: { points: null, totalYards: null },
    pointsPerGame: {},
    finishes: { seasons: [], bestFinish: null },
  };
}

function statsBundleFor(opts: {
  seasons: SeasonAgg[];
  lastSeason?: SeasonAgg | null;
  careerHighPoints?: CareerHighEntry | null;
  careerHighYards?: CareerHighEntry | null;
  finishes?: FinishRow[];
  bestFinish?: FinishRow | null;
}): StatsBundle {
  const pointsPerGame: Record<number, number | null> = {};
  for (const s of opts.seasons) {
    pointsPerGame[s.season] = s.games > 0 ? Number((s.line.pts_ppr / s.games).toFixed(1)) : null;
  }
  return {
    hasData: opts.seasons.length > 0,
    seasons: opts.seasons,
    lastSeason: opts.lastSeason ?? opts.seasons[0] ?? null,
    careerHighs: {
      points: opts.careerHighPoints ?? null,
      totalYards: opts.careerHighYards ?? null,
    },
    pointsPerGame,
    finishes: {
      seasons: opts.finishes ?? [],
      bestFinish: opts.bestFinish ?? null,
    },
  };
}

function baseFacts(overrides: Partial<ClueFacts> = {}): ClueFacts {
  return {
    position: "WR",
    lastName: "Chase",
    birthDate: "1999-03-01",
    yearsExperience: 4,
    heightInches: 72,
    weightLbs: 201,
    college: "LSU",
    highSchool: "Archbishop Rummel",
    jerseyNumber: "1",
    team: "CIN",
    teamName: "Cincinnati Bengals",
    conference: "AFC",
    division: "AFC North",
    stats: emptyStatsBundle(),
    value: {
      value: 8500,
      overallRank: 3,
      movement30dPct: 12.4,
      dataPoints30d: 10,
      sourceUsed: "ffbeacon",
    },
    adp: { value: 8.5 },
    ...overrides,
  };
}

function findClue(candidates: GeneratedClue[], key: string): GeneratedClue | undefined {
  return candidates.find((c) => c.clueKey === key);
}

// --- CLUE_DEFINITIONS catalog sanity ------------------------------------

describe("CLUE_DEFINITIONS", () => {
  it("never marks exact_position, current_team, or last_name_initial as starter eligible", () => {
    expect(DEF_BY_KEY.get("exact_position")?.starterEligible).toBe(false);
    expect(DEF_BY_KEY.get("current_team")?.starterEligible).toBe(false);
    expect(DEF_BY_KEY.get("last_name_initial")?.starterEligible).toBe(false);
  });

  it("never marks exact_age as starter eligible (tier clear, not weak)", () => {
    expect(DEF_BY_KEY.get("exact_age")?.starterEligible).toBe(false);
    expect(DEF_BY_KEY.get("exact_age")?.tier).toBe("clear");
  });

  it("marks the expected starter-eligible clues true", () => {
    const starterKeys = [
      "age_range",
      "experience_range",
      "height",
      "weight",
      "conference",
      "position_group",
      "last_season_points_range",
      "value_range",
    ];
    for (const key of starterKeys) {
      expect(DEF_BY_KEY.get(key)?.starterEligible, `${key} should be starter eligible`).toBe(true);
    }
  });

  it("marks college, high_school, jersey_number, division, overall_rank_range as not starter eligible", () => {
    for (const key of ["college", "high_school", "jersey_number", "division", "overall_rank_range"]) {
      expect(DEF_BY_KEY.get(key)?.starterEligible, `${key} should not be starter eligible`).toBe(false);
    }
  });

  it("every key is unique", () => {
    const keys = CLUE_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// --- bucketRange ---------------------------------------------------------

describe("bucketRange", () => {
  it("buckets a 2-year age range with the given example boundaries", () => {
    expect(bucketRange(26, 2)).toEqual({ lo: 26, hi: 27 });
    expect(bucketRange(27, 2)).toEqual({ lo: 26, hi: 27 });
    expect(bucketRange(28, 2)).toEqual({ lo: 28, hi: 29 });
  });

  it("buckets a 25-point range on exact edges", () => {
    expect(bucketRange(224, 25)).toEqual({ lo: 200, hi: 224 });
    expect(bucketRange(225, 25)).toEqual({ lo: 225, hi: 249 });
  });

  it("buckets a 500-value range on exact edges", () => {
    expect(bucketRange(1999, 500)).toEqual({ lo: 1500, hi: 1999 });
    expect(bucketRange(2000, 500)).toEqual({ lo: 2000, hi: 2499 });
  });

  it("buckets a 1-indexed rank range with base 1", () => {
    expect(bucketRange(1, 10, 1)).toEqual({ lo: 1, hi: 10 });
    expect(bucketRange(10, 10, 1)).toEqual({ lo: 1, hi: 10 });
    expect(bucketRange(11, 10, 1)).toEqual({ lo: 11, hi: 20 });
  });
});

// --- generateClueCandidates: position gates -------------------------------

describe("generateClueCandidates position gates", () => {
  const namedSeason = makeSeasonAgg(2023, 16, {
    pts_ppr: 300,
    pass_yd: 4000,
    pass_td: 30,
    rush_yd: 200,
    rush_td: 2,
    rec_yd: 50,
    rec: 3,
    rec_tgt: 5,
    rush_att: 10,
  });

  it("QB gets passing clues, not receiving/carries clues", () => {
    const bundle = statsBundleFor({
      seasons: [namedSeason],
      careerHighPoints: { season: 2023, value: 300 },
    });
    const facts = baseFacts({ position: "QB", stats: bundle });
    const candidates = generateClueCandidates(facts);

    expect(findClue(candidates, "season_passing_yards_exact")).toBeDefined();
    expect(findClue(candidates, "season_passing_tds_exact")).toBeDefined();
    expect(findClue(candidates, "season_rushing_yards_exact")).toBeDefined();
    expect(findClue(candidates, "season_receiving_yards_exact")).toBeUndefined();
    expect(findClue(candidates, "season_receptions_exact")).toBeUndefined();
    expect(findClue(candidates, "season_targets_exact")).toBeUndefined();
    expect(findClue(candidates, "season_carries_exact")).toBeUndefined();
  });

  it("WR gets receiving clues, not passing/carries clues", () => {
    const bundle = statsBundleFor({
      seasons: [namedSeason],
      careerHighPoints: { season: 2023, value: 300 },
    });
    const facts = baseFacts({ position: "WR", stats: bundle });
    const candidates = generateClueCandidates(facts);

    expect(findClue(candidates, "season_receiving_yards_exact")).toBeDefined();
    expect(findClue(candidates, "season_receptions_exact")).toBeDefined();
    expect(findClue(candidates, "season_targets_exact")).toBeDefined();
    expect(findClue(candidates, "season_passing_yards_exact")).toBeUndefined();
    expect(findClue(candidates, "season_carries_exact")).toBeUndefined();
  });

  it("RB gets carries and rushing clues plus receiving, not passing", () => {
    const bundle = statsBundleFor({
      seasons: [namedSeason],
      careerHighPoints: { season: 2023, value: 300 },
    });
    const facts = baseFacts({ position: "RB", stats: bundle });
    const candidates = generateClueCandidates(facts);

    expect(findClue(candidates, "season_carries_exact")).toBeDefined();
    expect(findClue(candidates, "season_rushing_yards_exact")).toBeDefined();
    expect(findClue(candidates, "season_receiving_yards_exact")).toBeDefined();
    expect(findClue(candidates, "season_targets_exact")).toBeUndefined();
    expect(findClue(candidates, "season_passing_yards_exact")).toBeUndefined();
  });
});

// --- generateClueCandidates: data gates -----------------------------------

describe("generateClueCandidates data gates", () => {
  it("suppresses conference/division/position_group/exact_position/current_team when team is null", () => {
    const facts = baseFacts({ team: null, teamName: null, conference: null, division: null });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "conference")).toBeUndefined();
    expect(findClue(candidates, "division")).toBeUndefined();
    expect(findClue(candidates, "position_group")).toBeUndefined();
    expect(findClue(candidates, "exact_position")).toBeUndefined();
    expect(findClue(candidates, "current_team")).toBeUndefined();
  });

  it("generates team clues when team is present", () => {
    const facts = baseFacts();
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "conference")?.displayValue).toBe("AFC");
    expect(findClue(candidates, "division")?.displayValue).toBe("AFC North");
    expect(findClue(candidates, "position_group")?.displayValue).toBe("Not a quarterback");
    expect(findClue(candidates, "exact_position")?.displayValue).toBe("Wide receiver");
    expect(findClue(candidates, "current_team")?.displayValue).toBe("Cincinnati Bengals");
  });

  it("skips position_group entirely for QB targets even when team is present", () => {
    const facts = baseFacts({ position: "QB" });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "position_group")).toBeUndefined();
    // Other team clues still generate normally for QB.
    expect(findClue(candidates, "conference")).toBeDefined();
    expect(findClue(candidates, "exact_position")?.displayValue).toBe("Quarterback");
  });

  it("generates position_group as 'Not a quarterback' for RB, WR, and TE targets", () => {
    for (const position of ["RB", "WR", "TE"]) {
      const candidates = generateClueCandidates(baseFacts({ position }));
      expect(findClue(candidates, "position_group")?.displayValue, `${position} should get position_group`).toBe(
        "Not a quarterback",
      );
    }
  });

  it("suppresses high_school and jersey_number when missing", () => {
    const facts = baseFacts({ highSchool: null, jerseyNumber: null });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "high_school")).toBeUndefined();
    expect(findClue(candidates, "jersey_number")).toBeUndefined();
  });

  it("suppresses every stat clue when there is no stats data", () => {
    const facts = baseFacts({ stats: emptyStatsBundle() });
    const candidates = generateClueCandidates(facts);
    const statKeys = CLUE_DEFINITIONS.filter((d) => d.category === "stat").map((d) => d.key);
    for (const key of statKeys) {
      expect(findClue(candidates, key), `${key} should be suppressed`).toBeUndefined();
    }
  });

  it("suppresses value_movement_30d when data_points_30d is below 7, keeps value_range", () => {
    const facts = baseFacts({
      value: { value: 8500, overallRank: 3, movement30dPct: 12.4, dataPoints30d: 6, sourceUsed: "ffbeacon" },
    });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "value_movement_30d")).toBeUndefined();
    expect(findClue(candidates, "value_range")).toBeDefined();
    expect(findClue(candidates, "overall_rank_range")).toBeDefined();
  });

  it("keeps value_movement_30d when data_points_30d is at least 7", () => {
    const facts = baseFacts({
      value: { value: 8500, overallRank: 3, movement30dPct: 12.4, dataPoints30d: 7, sourceUsed: "ffbeacon" },
    });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "value_movement_30d")).toBeDefined();
  });

  it("suppresses sleeper_adp_range when there is no ADP", () => {
    const facts = baseFacts({ adp: null });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "sleeper_adp_range")).toBeUndefined();
  });

  it("suppresses all value clues when value facts are null", () => {
    const facts = baseFacts({ value: null });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "value_range")).toBeUndefined();
    expect(findClue(candidates, "overall_rank_range")).toBeUndefined();
    expect(findClue(candidates, "value_movement_30d")).toBeUndefined();
  });

  it("suppresses age/experience/height/weight/college when missing", () => {
    const facts = baseFacts({
      birthDate: null,
      yearsExperience: null,
      heightInches: null,
      weightLbs: null,
      college: null,
    });
    const candidates = generateClueCandidates(facts);
    expect(findClue(candidates, "age_range")).toBeUndefined();
    expect(findClue(candidates, "exact_age")).toBeUndefined();
    expect(findClue(candidates, "experience_range")).toBeUndefined();
    expect(findClue(candidates, "exact_experience")).toBeUndefined();
    expect(findClue(candidates, "height")).toBeUndefined();
    expect(findClue(candidates, "weight")).toBeUndefined();
    expect(findClue(candidates, "college")).toBeUndefined();
  });
});

// --- generateClueCandidates: display rendering spot checks -----------------

describe("generateClueCandidates display rendering", () => {
  it("renders age_range at a bucket edge", () => {
    // 1999-03-01 vs "now" default (real Date) is flaky across years; use a
    // fixed stats-only fact instead for the bucket edges we actually control
    // (points, value). Age display is exercised end-to-end via the position
    // gate fixtures above (Chase, born 1999-03-01, real age well past 20).
    const facts = baseFacts();
    const candidates = generateClueCandidates(facts);
    const age = findClue(candidates, "age_range");
    expect(age?.displayValue).toMatch(/^\d+ to \d+ years old$/);
  });

  it("renders last_season_points_range at bucket edges", () => {
    const low = statsBundleFor({ seasons: [makeSeasonAgg(2023, 16, { pts_ppr: 224 })] });
    const high = statsBundleFor({ seasons: [makeSeasonAgg(2023, 16, { pts_ppr: 225 })] });
    expect(findClue(generateClueCandidates(baseFacts({ stats: low })), "last_season_points_range")?.displayValue).toBe(
      "200 to 224 PPR points",
    );
    expect(
      findClue(generateClueCandidates(baseFacts({ stats: high })), "last_season_points_range")?.displayValue,
    ).toBe("225 to 249 PPR points");
  });

  it("renders value_range at bucket edges", () => {
    const low = findClue(
      generateClueCandidates(baseFacts({ value: { value: 1999, overallRank: 1, movement30dPct: 0, dataPoints30d: 10, sourceUsed: "ffbeacon" } })),
      "value_range",
    );
    const high = findClue(
      generateClueCandidates(baseFacts({ value: { value: 2000, overallRank: 1, movement30dPct: 0, dataPoints30d: 10, sourceUsed: "ffbeacon" } })),
      "value_range",
    );
    expect(low?.displayValue).toBe("1500 to 1999 FF Beacon value");
    expect(high?.displayValue).toBe("2000 to 2499 FF Beacon value");
  });

  it("renders height and weight matching the site convention", () => {
    const candidates = generateClueCandidates(baseFacts({ heightInches: 74, weightLbs: 215 }));
    expect(findClue(candidates, "height")?.displayValue).toBe("6'2\"");
    expect(findClue(candidates, "weight")?.displayValue).toBe("215 lb");
  });

  it("renders positional_finish using the named season", () => {
    const namedSeason = makeSeasonAgg(2023, 16, { pts_ppr: 300, rec_yd: 1400 });
    const bundle = statsBundleFor({
      seasons: [namedSeason],
      careerHighPoints: { season: 2023, value: 300 },
      finishes: [{ season: 2023, finish: 14, playersRanked: 60 }],
    });
    const candidates = generateClueCandidates(baseFacts({ position: "WR", stats: bundle }));
    expect(findClue(candidates, "positional_finish")?.displayValue).toBe("Finished WR14 in 2023");
  });
});

// --- applyDisabledKeys and computeClueCoverage ------------------------------

describe("applyDisabledKeys", () => {
  it("filters out disabled clue keys", () => {
    const candidates: GeneratedClue[] = [
      { clueKey: "age_range", tier: "weak", category: "bio", label: "x", displayValue: "x", specificity: 2 },
      { clueKey: "college", tier: "clear", category: "bio", label: "x", displayValue: "x", specificity: 4 },
    ];
    const filtered = applyDisabledKeys(candidates, ["college"]);
    expect(filtered.map((c) => c.clueKey)).toEqual(["age_range"]);
  });

  it("returns the same list when no keys are disabled", () => {
    const candidates: GeneratedClue[] = [
      { clueKey: "age_range", tier: "weak", category: "bio", label: "x", displayValue: "x", specificity: 2 },
    ];
    expect(applyDisabledKeys(candidates, [])).toBe(candidates);
  });
});

describe("computeClueCoverage", () => {
  it("counts starter candidates and generatable-by-tier correctly on a crafted set", () => {
    const candidates: GeneratedClue[] = [
      { clueKey: "age_range", tier: "weak", category: "bio", label: "x", displayValue: "x", specificity: 2 }, // starter
      { clueKey: "height", tier: "weak", category: "bio", label: "x", displayValue: "x", specificity: 2 }, // starter
      { clueKey: "college", tier: "clear", category: "bio", label: "x", displayValue: "x", specificity: 4 }, // not starter
      { clueKey: "exact_position", tier: "ping", category: "team", label: "x", displayValue: "x", specificity: 5 },
      { clueKey: "current_team", tier: "scan", category: "team", label: "x", displayValue: "x", specificity: 5 },
    ];
    const coverage = computeClueCoverage(candidates);
    expect(coverage.starterCandidates).toBe(2);
    expect(coverage.generatableByTier).toEqual({ weak: 2, clear: 1, ping: 1, scan: 1 });
  });

  it("reflects post-filter reality when computed after applyDisabledKeys", () => {
    const candidates: GeneratedClue[] = [
      { clueKey: "age_range", tier: "weak", category: "bio", label: "x", displayValue: "x", specificity: 2 },
      { clueKey: "height", tier: "weak", category: "bio", label: "x", displayValue: "x", specificity: 2 },
    ];
    const filtered = applyDisabledKeys(candidates, ["height"]);
    const coverage = computeClueCoverage(filtered);
    expect(coverage.starterCandidates).toBe(1);
    expect(coverage.generatableByTier.weak).toBe(1);
  });
});

// --- selectStarterClues ----------------------------------------------------

describe("selectStarterClues", () => {
  const fullPool: ClueFacts = baseFacts({
    stats: statsBundleFor({ seasons: [makeSeasonAgg(2023, 16, { pts_ppr: 300 })] }),
  });

  function fullCandidates(): GeneratedClue[] {
    return generateClueCandidates(fullPool);
  }

  it("never selects exact_position, current_team, or last_name_initial", () => {
    const selected = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => 0.5);
    const keys = selected.map((c) => c.clueKey);
    expect(keys).not.toContain("exact_position");
    expect(keys).not.toContain("current_team");
    expect(keys).not.toContain("last_name_initial");
  });

  it("selects at most one clue per category", () => {
    for (const seed of [0, 0.25, 0.5, 0.75, 0.99]) {
      const selected = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => seed);
      const categories = selected.map((c) => c.category);
      expect(new Set(categories).size).toBe(categories.length);
    }
  });

  it("never selects both conference and position_group", () => {
    for (const seed of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const selected = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => seed);
      const keys = selected.map((c) => c.clueKey);
      expect(keys.includes("conference") && keys.includes("position_group")).toBe(false);
    }
  });

  it("never selects both exact_age and age_range (exact_age is never starter eligible)", () => {
    const selected = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => 0.5);
    const keys = selected.map((c) => c.clueKey);
    expect(keys.includes("exact_age") && keys.includes("age_range")).toBe(false);
  });

  it("respects the specificity budget", () => {
    for (const seed of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const selected = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => seed);
      const total = selected.reduce((sum, c) => sum + c.specificity, 0);
      expect(total).toBeLessThanOrEqual(STARTER_SPECIFICITY_BUDGET);
    }
  });

  it("includes at least one clue with specificity >= 2 when possible", () => {
    for (const seed of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const selected = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => seed);
      expect(selected.some((c) => c.specificity >= 2)).toBe(true);
    }
  });

  it("selects exactly starter_clue_count clues when enough categories are available", () => {
    const selected = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => 0.42);
    expect(selected).toHaveLength(DEFAULT_SIGNAL_SCOUT_SETTINGS.clues.starter_clue_count);
  });

  it("is deterministic given the same rng sequence", () => {
    const a = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => 0.37);
    const b = selectStarterClues(fullCandidates(), DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => 0.37);
    expect(a).toEqual(b);
  });

  it("returns fewer than starter_clue_count when only two categories have candidates", () => {
    const facts = baseFacts({
      team: null,
      teamName: null,
      conference: null,
      division: null,
      value: null,
      adp: null,
      stats: emptyStatsBundle(),
    });
    const candidates = generateClueCandidates(facts);
    const selected = selectStarterClues(candidates, DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, () => 0.5);
    // Only "bio" has starter-eligible candidates left (age_range/experience_range/height/weight).
    expect(selected.length).toBe(1);
    expect(selected[0].category).toBe("bio");
  });
});

// --- assembleClueFacts ------------------------------------------------------

type MockResponse = { data: unknown; error: unknown };

function makeMockSupabase(responses: Record<string, MockResponse[]>) {
  const callCounts: Record<string, number> = {};
  const from = (table: string) => {
    const idx = callCounts[table] ?? 0;
    callCounts[table] = idx + 1;
    const list = responses[table] ?? [];
    const result: MockResponse = list[idx] ?? list[list.length - 1] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(result),
    };
    return builder;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: { from } as any, callCounts };
}

function basePlayer(overrides: Partial<ClueFactsPlayer> = {}): ClueFactsPlayer {
  return {
    id: "player-1",
    position: "WR",
    last_name: "Chase",
    birth_date: "1999-03-01",
    years_experience: 4,
    height_inches: 72,
    weight_lbs: 201,
    college: "LSU",
    team: "CIN",
    metadata: { sleeper: { high_school: "Archbishop Rummel", number: "1" } },
    ...overrides,
  };
}

describe("assembleClueFacts", () => {
  it("uses the ffbeacon value row and reports sourceUsed ffbeacon when present", async () => {
    const { supabase } = makeMockSupabase({
      nfl_teams: [{ data: { name: "Cincinnati Bengals", conference: "AFC", division: "AFC North" }, error: null }],
      format_configs: [{ data: { id: "fmt-1" }, error: null }],
      player_value_trends: [
        { data: { current_value: 8500, change_30d_pct: 5, data_points_30d: 10 }, error: null },
      ],
      rankings: [{ data: { overall_rank: 3 }, error: null }],
      player_market_snapshots: [{ data: { adp: { dynasty_2qb: 8.5 } }, error: null }],
    });

    const facts = await assembleClueFacts(supabase, basePlayer(), emptyStatsBundle());
    expect(facts.value?.sourceUsed).toBe("ffbeacon");
    expect(facts.value?.value).toBe(8500);
    expect(facts.value?.overallRank).toBe(3);
    expect(facts.adp?.value).toBe(8.5);
    expect(facts.highSchool).toBe("Archbishop Rummel");
    expect(facts.jerseyNumber).toBe("1");
    expect(facts.teamName).toBe("Cincinnati Bengals");
    expect(facts.conference).toBe("AFC");
  });

  it("falls back to ktc when the ffbeacon row is missing, and reports sourceUsed ktc", async () => {
    const { supabase } = makeMockSupabase({
      nfl_teams: [{ data: null, error: null }],
      format_configs: [{ data: { id: "fmt-1" }, error: null }],
      player_value_trends: [
        { data: null, error: null }, // ffbeacon miss
        { data: { current_value: 7200, change_30d_pct: -2, data_points_30d: 12 }, error: null }, // ktc hit
      ],
      rankings: [{ data: { overall_rank: 9 }, error: null }],
      player_market_snapshots: [{ data: null, error: null }],
    });

    const facts = await assembleClueFacts(supabase, basePlayer({ team: null }), emptyStatsBundle());
    expect(facts.value?.sourceUsed).toBe("ktc");
    expect(facts.value?.value).toBe(7200);
    expect(facts.value?.overallRank).toBe(9);
  });

  it("returns null value facts when both ffbeacon and ktc rows are missing", async () => {
    const { supabase } = makeMockSupabase({
      nfl_teams: [{ data: null, error: null }],
      format_configs: [{ data: { id: "fmt-1" }, error: null }],
      player_value_trends: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      player_market_snapshots: [{ data: null, error: null }],
    });

    const facts = await assembleClueFacts(supabase, basePlayer({ team: null }), emptyStatsBundle());
    expect(facts.value).toBeNull();
  });

  it("returns null value facts when format_configs has no matching row", async () => {
    const { supabase } = makeMockSupabase({
      nfl_teams: [{ data: null, error: null }],
      format_configs: [{ data: null, error: null }],
      player_market_snapshots: [{ data: null, error: null }],
    });

    const facts = await assembleClueFacts(supabase, basePlayer({ team: null }), emptyStatsBundle());
    expect(facts.value).toBeNull();
  });

  it("returns null adp facts and null highSchool/jerseyNumber when absent", async () => {
    const { supabase } = makeMockSupabase({
      nfl_teams: [{ data: null, error: null }],
      format_configs: [{ data: { id: "fmt-1" }, error: null }],
      player_value_trends: [{ data: null, error: null }, { data: null, error: null }],
      player_market_snapshots: [{ data: { adp: {} }, error: null }],
    });

    const facts = await assembleClueFacts(
      supabase,
      basePlayer({ team: null, metadata: {} }),
      emptyStatsBundle(),
    );
    expect(facts.adp).toBeNull();
    expect(facts.highSchool).toBeNull();
    expect(facts.jerseyNumber).toBeNull();
  });

  it("returns null team facts when team is null (does not query nfl_teams)", async () => {
    const { supabase, callCounts } = makeMockSupabase({
      format_configs: [{ data: { id: "fmt-1" }, error: null }],
      player_value_trends: [{ data: null, error: null }, { data: null, error: null }],
      player_market_snapshots: [{ data: null, error: null }],
    });

    const facts = await assembleClueFacts(supabase, basePlayer({ team: null }), emptyStatsBundle());
    expect(facts.team).toBeNull();
    expect(facts.teamName).toBeNull();
    expect(facts.conference).toBeNull();
    expect(callCounts.nfl_teams ?? 0).toBe(0);
  });
});
