import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECTION_SETTINGS } from "./default-settings";
import type { ProjectionSettings } from "./default-settings";
import { computeEfficiencyRates, computeUsageShares, recencyWeight, type PlayerStatRow } from "./usage";

const SETTINGS = DEFAULT_PROJECTION_SETTINGS;

function withUsage(overrides: Partial<ProjectionSettings["usage"]>): ProjectionSettings {
  return { ...SETTINGS, usage: { ...SETTINGS.usage, ...overrides } };
}

/** A full PlayerStatRow with every field defaulted to "no data" or zero. */
function row(
  overrides: Partial<PlayerStatRow> & Pick<PlayerStatRow, "playerId" | "team" | "season" | "week">,
): PlayerStatRow {
  return {
    position: "WR",
    gp: 1,
    offSnaps: null,
    targets: null,
    receptions: 0,
    recYards: 0,
    recTds: 0,
    carries: 0,
    rushYards: 0,
    rushTds: 0,
    rushRedZoneAttempts: 0,
    passAttempts: 0,
    passCompletions: 0,
    passYards: 0,
    passTds: 0,
    interceptions: 0,
    fumblesLost: 0,
    ...overrides,
  };
}

describe("recencyWeight", () => {
  it("weighs the current week at full season weight with no decay", () => {
    const weight = recencyWeight({ season: 2026, week: 10 }, { currentSeason: 2026, latestWeek: 10 }, SETTINGS);
    expect(weight).toBeCloseTo(SETTINGS.usage.seasonWeights.currentSeason, 10);
  });

  it("halves the current-season weight once weeksAgo reaches the half life", () => {
    const weight = recencyWeight({ season: 2026, week: 6 }, { currentSeason: 2026, latestWeek: 10 }, SETTINGS);
    expect(weight).toBeCloseTo(SETTINGS.usage.seasonWeights.currentSeason * 0.5, 10);
  });

  it("applies the one-season-back ladder weight, decayed from that season's own final week", () => {
    // Week 18 of last season is treated as weeksAgo 0 for the within-season
    // decay, since that is the assumed end of a past season.
    const weight = recencyWeight({ season: 2025, week: 18 }, { currentSeason: 2026, latestWeek: 3 }, SETTINGS);
    expect(weight).toBeCloseTo(SETTINGS.usage.seasonWeights.oneSeasonBack, 10);
  });

  it("applies the two-seasons-back ladder weight", () => {
    const weight = recencyWeight({ season: 2024, week: 18 }, { currentSeason: 2026, latestWeek: 3 }, SETTINGS);
    expect(weight).toBeCloseTo(SETTINGS.usage.seasonWeights.twoSeasonsBack, 10);
  });

  it("falls back to the older-seasons ladder weight past two seasons back", () => {
    const weight = recencyWeight({ season: 2021, week: 18 }, { currentSeason: 2026, latestWeek: 3 }, SETTINGS);
    expect(weight).toBeCloseTo(SETTINGS.usage.seasonWeights.olderSeasons, 10);
  });

  it("treats a week 2 game in last season as older than a week 17 game in last season", () => {
    // This is the case the module exists to get right: two games in the same
    // PAST season must not decay identically just because they share a
    // season-distance bucket.
    const early = recencyWeight({ season: 2025, week: 2 }, { currentSeason: 2026, latestWeek: 1 }, SETTINGS);
    const late = recencyWeight({ season: 2025, week: 17 }, { currentSeason: 2026, latestWeek: 1 }, SETTINGS);
    expect(late).toBeGreaterThan(early);
  });

  it("measures the current season's decay from latestWeek, not a fixed season end", () => {
    const early = recencyWeight({ season: 2026, week: 1 }, { currentSeason: 2026, latestWeek: 12 }, SETTINGS);
    const recent = recencyWeight({ season: 2026, week: 11 }, { currentSeason: 2026, latestWeek: 12 }, SETTINGS);
    expect(recent).toBeGreaterThan(early);
  });

  it("is pure: identical inputs return identical output", () => {
    const params = { currentSeason: 2026, latestWeek: 8 };
    const a = recencyWeight({ season: 2025, week: 4 }, params, SETTINGS);
    const b = recencyWeight({ season: 2025, week: 4 }, params, SETTINGS);
    expect(a).toBe(b);
  });
});

describe("computeUsageShares", () => {
  const params = { currentSeason: 2026, latestWeek: 3 };

  it("uses the MAXIMUM off_snp on a team-week as the snap denominator, not the sum", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "qb", team: "AAA", season: 2026, week: 1, position: "QB", offSnaps: 60 }),
      row({ playerId: "wr", team: "AAA", season: 2026, week: 1, position: "WR", offSnaps: 55 }),
      row({ playerId: "qb", team: "AAA", season: 2026, week: 2, position: "QB", offSnaps: 60 }),
      row({ playerId: "wr", team: "AAA", season: 2026, week: 2, position: "WR", offSnaps: 55 }),
      row({ playerId: "qb", team: "AAA", season: 2026, week: 3, position: "QB", offSnaps: 60 }),
      row({ playerId: "wr", team: "AAA", season: 2026, week: 3, position: "WR", offSnaps: 55 }),
    ];
    const shares = computeUsageShares(rows, params, withUsage({ minWeightedGames: 1, priorGames: 0 }));
    const wr = shares.get("wr");
    expect(wr?.snapShare).toBeCloseTo(55 / 60, 10);
  });

  it("sums targets across a team-week rather than taking the maximum", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "wr1", team: "AAA", season: 2026, week: 1, position: "WR", targets: 6 }),
      row({ playerId: "wr2", team: "AAA", season: 2026, week: 1, position: "WR", targets: 4 }),
      row({ playerId: "wr1", team: "AAA", season: 2026, week: 2, position: "WR", targets: 6 }),
      row({ playerId: "wr2", team: "AAA", season: 2026, week: 2, position: "WR", targets: 4 }),
      row({ playerId: "wr1", team: "AAA", season: 2026, week: 3, position: "WR", targets: 6 }),
      row({ playerId: "wr2", team: "AAA", season: 2026, week: 3, position: "WR", targets: 4 }),
    ];
    const shares = computeUsageShares(rows, params, withUsage({ minWeightedGames: 1, priorGames: 0 }));
    // Team target total is 10 (6 + 4), so wr1's raw share is 0.6, which only
    // holds if the denominator summed rather than took the max of 6.
    expect(shares.get("wr1")?.targetShare).toBeCloseTo(0.6, 10);
  });

  it("excludes a team-week whose target total is below the minimum, as thin data rather than a zero", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "wr1", team: "AAA", season: 2026, week: 1, position: "WR", targets: 2 }),
      row({ playerId: "wr2", team: "AAA", season: 2026, week: 1, position: "WR", targets: 3 }),
      row({ playerId: "wr1", team: "AAA", season: 2026, week: 2, position: "WR", targets: 2 }),
      row({ playerId: "wr2", team: "AAA", season: 2026, week: 2, position: "WR", targets: 3 }),
      row({ playerId: "wr1", team: "AAA", season: 2026, week: 3, position: "WR", targets: 2 }),
      row({ playerId: "wr2", team: "AAA", season: 2026, week: 3, position: "WR", targets: 3 }),
    ];
    // Team total is 5 targets a week, below the default minTeamTargets of 10.
    const shares = computeUsageShares(rows, params, withUsage({ minWeightedGames: 1, priorGames: 0 }));
    expect(shares.get("wr1")?.targetShare).toBeNull();
    // Carries never had any data at all, so that share is also null, but the
    // player still publishes (weightedGames comes from games played, not
    // from any one share type).
    expect(shares.has("wr1")).toBe(true);
    expect(shares.get("wr1")?.carryShare).toBeNull();
  });

  it("counts a gp <= 0 row toward the team denominator without letting it affect its own share", () => {
    const rows: PlayerStatRow[] = [1, 2, 3].map((week) =>
      row({ playerId: "inactive", team: "AAA", season: 2026, week, position: "WR", gp: 0, targets: 3 }),
    );
    const teammateRows: PlayerStatRow[] = [1, 2, 3].map((week) =>
      row({ playerId: "starter", team: "AAA", season: 2026, week, position: "WR", targets: 7 }),
    );
    const shares = computeUsageShares(
      [...rows, ...teammateRows],
      params,
      withUsage({ minWeightedGames: 1, priorGames: 0 }),
    );

    // The inactive player never played, so he publishes no row at all.
    expect(shares.has("inactive")).toBe(false);

    // The team-week total is 3 (inactive) + 7 (starter) = 10, which clears
    // the default minimum of 10. If the inactive row's 3 targets were
    // dropped from the denominator, the team-week total would be 7, below
    // the minimum, and the starter's targetShare would be null instead.
    expect(shares.get("starter")?.targetShare).toBeCloseTo(0.7, 10);
  });

  it("shrinks a raw share toward the position average, and priorGames 0 leaves it untouched", () => {
    // wr-high's raw target share is 0.8 every week; wr-low's is 0.2. Both
    // players share the same three weeks, so their weighted-games totals are
    // identical and the position average is a plain 0.5.
    const weeks = [1, 2, 3];
    const rows: PlayerStatRow[] = weeks.flatMap((week) => [
      row({ playerId: "wr-high", team: "AAA", season: 2026, week, position: "WR", targets: 8 }),
      row({ playerId: "filler-a", team: "AAA", season: 2026, week, position: "WR", targets: 2 }),
      row({ playerId: "wr-low", team: "BBB", season: 2026, week, position: "WR", targets: 2 }),
      row({ playerId: "filler-b", team: "BBB", season: 2026, week, position: "WR", targets: 8 }),
    ]);

    const noPrior = computeUsageShares(rows, params, withUsage({ minWeightedGames: 1, priorGames: 0 }));
    expect(noPrior.get("wr-high")?.targetShare).toBeCloseTo(0.8, 10);
    expect(noPrior.get("wr-low")?.targetShare).toBeCloseTo(0.2, 10);

    const heavyPrior = computeUsageShares(
      rows,
      params,
      withUsage({ minWeightedGames: 1, priorGames: 1_000_000 }),
    );
    // With an overwhelming prior, both players are pulled almost all the way
    // to the 0.5 position average, and away from their raw values.
    expect(heavyPrior.get("wr-high")?.targetShare).toBeCloseTo(0.5, 3);
    expect(heavyPrior.get("wr-low")?.targetShare).toBeCloseTo(0.5, 3);
  });

  it("omits a player entirely below minWeightedGames rather than publishing a thin or fabricated row", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "rookie", team: "AAA", season: 2026, week: 1, position: "WR", targets: 1 }),
      row({ playerId: "filler", team: "AAA", season: 2026, week: 1, position: "WR", targets: 9 }),
    ];
    // Default minWeightedGames is 3; this rookie has exactly one game.
    const shares = computeUsageShares(rows, params, SETTINGS);
    expect(shares.has("rookie")).toBe(false);
  });

  it("counts currentSeasonGames only from rows in the current season with gp > 0", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "vet", team: "AAA", season: 2024, week: 1, position: "WR", targets: 5 }),
      row({ playerId: "vet", team: "AAA", season: 2025, week: 1, position: "WR", targets: 5 }),
      row({ playerId: "vet", team: "AAA", season: 2026, week: 1, position: "WR", targets: 5 }),
      row({ playerId: "vet", team: "AAA", season: 2026, week: 2, position: "WR", targets: 5, gp: 0 }),
      row({ playerId: "filler", team: "AAA", season: 2024, week: 1, position: "WR", targets: 5 }),
      row({ playerId: "filler", team: "AAA", season: 2025, week: 1, position: "WR", targets: 5 }),
      row({ playerId: "filler", team: "AAA", season: 2026, week: 1, position: "WR", targets: 5 }),
    ];
    const shares = computeUsageShares(rows, params, withUsage({ minWeightedGames: 0.01 }));
    expect(shares.get("vet")?.currentSeasonGames).toBe(1);
    expect(shares.get("vet")?.games).toBe(3);
  });
});

describe("computeEfficiencyRates", () => {
  const params = { currentSeason: 2026, latestWeek: 1 };

  it("computes a weighted ratio of weighted sums, which differs from the mean of per-game ratios", () => {
    // Both games sit at weeksAgo 0 (week 2 clamps to weeksAgo 0 the same as
    // week 1 when latestWeek is 1), so they carry equal recency weight and
    // the only thing separating the two computations is game volume.
    const rows: PlayerStatRow[] = [
      row({ playerId: "wr", team: "AAA", season: 2026, week: 1, position: "WR", targets: 2, receptions: 1 }),
      row({ playerId: "wr", team: "AAA", season: 2026, week: 2, position: "WR", targets: 12, receptions: 12 }),
    ];
    const { byPlayer } = computeEfficiencyRates(rows, params, SETTINGS);
    const meanOfRatios = (1 / 2 + 12 / 12) / 2; // 0.75
    const weightedRatio = (1 + 12) / (2 + 12); // 13/14 ~= 0.9286

    expect(byPlayer.get("wr")?.catchRate).toBeCloseTo(weightedRatio, 10);
    expect(byPlayer.get("wr")?.catchRate).not.toBeCloseTo(meanOfRatios, 2);
  });

  it("returns null for every rate whose denominator never accumulated", () => {
    const rows: PlayerStatRow[] = [row({ playerId: "bench", team: "AAA", season: 2026, week: 1, position: "WR" })];
    const { byPlayer } = computeEfficiencyRates(rows, params, SETTINGS);
    const rates = byPlayer.get("bench");
    expect(rates?.catchRate).toBeNull();
    expect(rates?.yardsPerReception).toBeNull();
    expect(rates?.recTdPerTarget).toBeNull();
    expect(rates?.yardsPerCarry).toBeNull();
    expect(rates?.rushTdPerCarry).toBeNull();
    expect(rates?.completionRate).toBeNull();
    expect(rates?.yardsPerAttempt).toBeNull();
    expect(rates?.passTdPerAttempt).toBeNull();
    expect(rates?.intPerAttempt).toBeNull();
    expect(rates?.fumbleLostPerTouch).toBeNull();
    expect(rates?.weightedGames).toBeGreaterThan(0);
  });

  it("treats targets: null as no data, distinct from targets: 0", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "noTargets", team: "AAA", season: 2026, week: 1, position: "WR", targets: null }),
    ];
    const { byPlayer } = computeEfficiencyRates(rows, params, SETTINGS);
    expect(byPlayer.get("noTargets")?.catchRate).toBeNull();
  });

  it("computes fumbleLostPerTouch over carries plus receptions plus pass attempts", () => {
    const rows: PlayerStatRow[] = [
      row({
        playerId: "rb",
        team: "AAA",
        season: 2026,
        week: 1,
        position: "RB",
        carries: 15,
        receptions: 5,
        fumblesLost: 1,
      }),
    ];
    const { byPlayer } = computeEfficiencyRates(rows, params, SETTINGS);
    expect(byPlayer.get("rb")?.fumbleLostPerTouch).toBeCloseTo(1 / 20, 10);
  });

  it("publishes a non-null leagueByPosition entry for any position present in the input, even with no production", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "kick-returner", team: "AAA", season: 2026, week: 1, position: "TE" }),
    ];
    const { leagueByPosition } = computeEfficiencyRates(rows, params, SETTINGS);
    expect(leagueByPosition.has("TE")).toBe(true);
    expect(leagueByPosition.get("TE")?.catchRate).toBeNull();
  });

  it("pools every player at a position into leagueByPosition as one weighted ratio", () => {
    const rows: PlayerStatRow[] = [
      row({ playerId: "wr1", team: "AAA", season: 2026, week: 1, position: "WR", targets: 2, receptions: 1 }),
      row({ playerId: "wr2", team: "BBB", season: 2026, week: 1, position: "WR", targets: 12, receptions: 12 }),
    ];
    const { leagueByPosition } = computeEfficiencyRates(rows, params, SETTINGS);
    expect(leagueByPosition.get("WR")?.catchRate).toBeCloseTo((1 + 12) / (2 + 12), 10);
  });
});
