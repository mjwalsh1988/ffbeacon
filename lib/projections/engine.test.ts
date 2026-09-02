/**
 * computeBeaconProjections.
 *
 * Two of these tests exist because the behaviour they pin was WRONG in the
 * first build and was only caught by querying production afterwards, not by
 * reading the code. Both are marked below. They are the reason this file is
 * worth more than its line count.
 */

import { describe, expect, it } from "vitest";
import { computeBeaconProjections, leagueTargetsPerAttempt, withRedZoneLeverage } from "./engine";
import type { EngineInput, EngineSubject, SleeperProjectionRow } from "./engine";
import { DEFAULT_PROJECTION_SETTINGS } from "./default-settings";
import type { PlayerStatRow } from "./usage";
import type { EfficiencyRates, GameEnvironment } from "./types";

const SETTINGS = DEFAULT_PROJECTION_SETTINGS;

function statRow(over: Partial<PlayerStatRow> & Pick<PlayerStatRow, "playerId" | "position">): PlayerStatRow {
  return {
    team: "DET",
    season: 2025,
    week: 1,
    gp: 1,
    offSnaps: 60,
    targets: 0,
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
    ...over,
  };
}

function sleeperRow(
  over: Partial<SleeperProjectionRow> & Pick<SleeperProjectionRow, "playerId" | "week">,
): SleeperProjectionRow {
  return {
    statLine: { gp: 1, rec: 5, rec_yd: 60, rec_td: 0.4, rec_tgt: 7 },
    team: "DET",
    opponent: "CHI",
    availability: "projected",
    points: { ppr: 14, halfPpr: 11.5, std: 9 },
    ...over,
  };
}

/** A whole offense, so team denominators are real rather than degenerate. */
function offense(team: string, season: number, weeks: number[]): PlayerStatRow[] {
  const rows: PlayerStatRow[] = [];
  for (const week of weeks) {
    rows.push(
      statRow({
        playerId: `${team}-qb`,
        position: "QB",
        team,
        season,
        week,
        offSnaps: 65,
        passAttempts: 34,
        passCompletions: 22,
        passYards: 250,
        passTds: 1.6,
        interceptions: 0.7,
      }),
    );
    rows.push(
      statRow({
        playerId: `${team}-wr1`,
        position: "WR",
        team,
        season,
        week,
        offSnaps: 60,
        targets: 10,
        receptions: 7,
        recYards: 88,
        recTds: 0.6,
      }),
    );
    rows.push(
      statRow({
        playerId: `${team}-wr2`,
        position: "WR",
        team,
        season,
        week,
        offSnaps: 45,
        targets: 6,
        receptions: 4,
        recYards: 44,
        recTds: 0.3,
      }),
    );
    rows.push(
      statRow({
        playerId: `${team}-rb1`,
        position: "RB",
        team,
        season,
        week,
        offSnaps: 40,
        carries: 16,
        rushYards: 72,
        rushTds: 0.5,
        rushRedZoneAttempts: 3,
        targets: 4,
        receptions: 3,
        recYards: 22,
      }),
    );
  }
  return rows;
}

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  const stats = [...offense("DET", 2025, WEEKS), ...offense("CHI", 2025, WEEKS)];
  const subjects: EngineSubject[] = [
    { playerId: "DET-wr1", sleeperPlayerId: "s1", position: "WR", team: "DET" },
    { playerId: "DET-rb1", sleeperPlayerId: "s2", position: "RB", team: "DET" },
    { playerId: "DET-qb", sleeperPlayerId: "s3", position: "QB", team: "DET" },
  ];
  const sleeper = new Map<string, SleeperProjectionRow>();
  for (const s of subjects) {
    sleeper.set(`${s.playerId}|1`, sleeperRow({ playerId: s.playerId, week: 1 }));
  }
  return {
    season: 2026,
    currentSeason: 2026,
    latestWeek: 0,
    stats,
    subjects,
    sleeper,
    environment: new Map<string, GameEnvironment>(),
    settings: SETTINGS,
    ...over,
  };
}

describe("computeBeaconProjections", () => {
  it("mirrors every Sleeper row, so switching source cannot make a week disappear", () => {
    const input = baseInput();
    const result = computeBeaconProjections(input);
    expect(result.projections).toHaveLength(input.sleeper.size);
    for (const key of input.sleeper.keys()) {
      const [playerId, week] = key.split("|");
      expect(
        result.projections.some(
          (p) => p.playerId === playerId && p.week === Number(week),
        ),
      ).toBe(true);
    }
  });

  it("emits no row for a week Sleeper has no row for, because that is a bye", () => {
    const input = baseInput();
    const result = computeBeaconProjections(input);
    expect(result.projections.some((p) => p.week === 2)).toBe(false);
  });

  // REGRESSION GUARD. Before this, the write key always came from
  // players.external_ids.sleeper regardless of the actual Sleeper row being
  // mirrored, so a missing or drifted mapping on that table dropped the
  // player-week with no log line and no counter. The row's own
  // sleeper_player_id, from the row actually being mirrored, is now primary.
  it("prefers the mirrored row's own sleeperPlayerId over the subject's players-table id", () => {
    const sleeper = new Map<string, SleeperProjectionRow>([
      [
        "DET-wr1|1",
        sleeperRow({ playerId: "DET-wr1", week: 1, sleeperPlayerId: "authoritative-1" }),
      ],
    ]);
    const result = computeBeaconProjections(baseInput({ sleeper }));
    const row = result.projections.find((p) => p.playerId === "DET-wr1");
    // baseInput()'s subject for DET-wr1 carries sleeperPlayerId "s1"; the row
    // itself carries a different, authoritative one, and the row must win.
    expect(row?.sleeperPlayerId).toBe("authoritative-1");
  });

  it("falls back to the subject's players-table sleeperPlayerId when the mirrored row carries none", () => {
    const result = computeBeaconProjections(baseInput());
    const row = result.projections.find((p) => p.playerId === "DET-wr1");
    expect(row?.sleeperPlayerId).toBe("s1");
  });

  // REGRESSION. The first build re-derived every stored total from the stat
  // line under canonical scoring, which has no keys for fgm or pts_allow, so
  // 1,119 kicker and defense rows in production came out at a flat 0.00.
  it("carries a kicker's published points through untouched rather than re-deriving them", () => {
    const subjects: EngineSubject[] = [
      { playerId: "K1", sleeperPlayerId: "sk", position: "K", team: "DET" },
    ];
    const sleeper = new Map<string, SleeperProjectionRow>([
      [
        "K1|1",
        sleeperRow({
          playerId: "K1",
          week: 1,
          statLine: { gp: 1, fgm: 1.8, fgmiss: 0.4, xpm: 2.2 },
          points: { ppr: 8.4, halfPpr: 8.4, std: 8.4 },
        }),
      ],
    ]);
    const result = computeBeaconProjections(baseInput({ subjects, sleeper }));

    expect(result.projections).toHaveLength(1);
    const row = result.projections[0];
    expect(row.pointsPpr).toBe(8.4);
    expect(row.pointsHalfPpr).toBe(8.4);
    expect(row.pointsStd).toBe(8.4);
    expect(row.blendWeight).toBe(0);
    expect(result.mirrored.notProjectable).toBe(1);
  });

  it("carries a modelled player's published points through at blend weight zero", () => {
    // No current-season games means blendWeight 0, so our line contributes
    // nothing and the row must be byte-identical to Sleeper's in every base.
    const result = computeBeaconProjections(baseInput());
    const wr = result.projections.find((p) => p.playerId === "DET-wr1");
    expect(wr).toBeDefined();
    expect(wr?.blendWeight).toBe(0);
    expect(wr?.pointsPpr).toBeCloseTo(14, 6);
    expect(wr?.pointsHalfPpr).toBeCloseTo(11.5, 6);
    expect(wr?.pointsStd).toBeCloseTo(9, 6);
  });

  it("carries Sleeper's availability verdict rather than asserting its own", () => {
    const sleeper = new Map<string, SleeperProjectionRow>([
      [
        "DET-wr1|1",
        sleeperRow({
          playerId: "DET-wr1",
          week: 1,
          availability: "out",
          statLine: {},
          points: { ppr: 0, halfPpr: 0, std: 0 },
        }),
      ],
    ]);
    const result = computeBeaconProjections(baseInput({ sleeper }));
    expect(result.projections[0].availability).toBe("out");
    expect(result.projections[0].pointsPpr).toBe(0);
    expect(result.mirrored.unavailable).toBe(1);
  });

  it("keeps an unprojected week as nulls, never as a confident zero", () => {
    const sleeper = new Map<string, SleeperProjectionRow>([
      [
        "DET-wr1|1",
        sleeperRow({
          playerId: "DET-wr1",
          week: 1,
          availability: "unprojected",
          statLine: null,
          points: { ppr: null, halfPpr: null, std: null },
        }),
      ],
    ]);
    const result = computeBeaconProjections(baseInput({ sleeper }));
    const row = result.projections[0];
    expect(row.statLine).toBeNull();
    expect(row.pointsPpr).toBeNull();
    expect(row.pointsHalfPpr).toBeNull();
    expect(row.pointsStd).toBeNull();
  });

  it("mirrors a player with no usage history and counts why", () => {
    const subjects: EngineSubject[] = [
      { playerId: "rookie", sleeperPlayerId: "sr", position: "WR", team: "DET" },
    ];
    const sleeper = new Map<string, SleeperProjectionRow>([
      ["rookie|1", sleeperRow({ playerId: "rookie", week: 1 })],
    ]);
    const result = computeBeaconProjections(baseInput({ subjects, sleeper }));
    expect(result.modelled).toBe(0);
    expect(result.mirrored.noShares).toBe(1);
    expect(result.projections[0].pointsPpr).toBe(14);
  });

  it("models a player once he has enough history, and blends him in as games are played", () => {
    // The preseason fixture above deliberately does NOT clear
    // minWeightedGames: seventeen weeks of last season discounted to 0.45 and
    // decayed on a four week half life comes to about 2.1 weighted games
    // against a floor of 3. That is the model being conservative rather than a
    // gap, and it is why the preseason board is almost entirely mirrored.
    //
    // Six weeks of the CURRENT season clears it comfortably and also drives the
    // blend weight to its cap, which is the state this whole build is aiming
    // at.
    const inSeason = baseInput({
      stats: [
        ...offense("DET", 2025, WEEKS),
        ...offense("CHI", 2025, WEEKS),
        ...offense("DET", 2026, [1, 2, 3, 4, 5, 6]),
        ...offense("CHI", 2026, [1, 2, 3, 4, 5, 6]),
      ],
      latestWeek: 6,
      sleeper: new Map<string, SleeperProjectionRow>([
        ["DET-wr1|7", sleeperRow({ playerId: "DET-wr1", week: 7 })],
        ["DET-rb1|7", sleeperRow({ playerId: "DET-rb1", week: 7 })],
        ["DET-qb|7", sleeperRow({ playerId: "DET-qb", week: 7 })],
      ]),
    });

    // The SHIPPED blend.max is 0, because the 2025 walk-forward backtest
    // measured our model 6.2% worse than Sleeper. This test is about the
    // blending MECHANISM rather than that shipped value, so it supplies its own
    // non-zero weight. Reading SETTINGS.blend.max here instead would make the
    // test silently stop testing anything the day the default went to zero,
    // which is exactly what it just did.
    const blending = {
      ...inSeason,
      settings: { ...SETTINGS, blend: { min: 0, max: 0.5, gamesForMax: 6 } },
    };
    const result = computeBeaconProjections(blending);
    expect(result.modelled).toBeGreaterThan(0);

    const wr = result.projections.find((p) => p.playerId === "DET-wr1");
    expect(wr?.blendWeight).toBeCloseTo(0.5, 6);
    // At a non-zero blend weight the stored total is genuinely ours in part, so
    // it must no longer be Sleeper's number to the decimal.
    expect(wr?.pointsPpr).not.toBeCloseTo(14, 6);
    expect(Number.isFinite(wr?.pointsPpr ?? NaN)).toBe(true);
  });

  // REGRESSION. The first build calibrated the WHOLE pool toward the top-N
  // mean, which pulls every deep-bench player UP toward a startable number.
  // Measured against production, that inflated the average tight end
  // projection by 54%.
  it("leaves a player below the startable range uncalibrated", () => {
    const subjects: EngineSubject[] = [];
    const sleeper = new Map<string, SleeperProjectionRow>();
    // 30 receivers at descending projections. STARTABLE_DEPTH.WR is 48, so with
    // fewer players than the depth every row is inside the range and gets
    // calibrated. Push past it.
    for (let i = 0; i < 60; i++) {
      const id = `wr${i}`;
      subjects.push({ playerId: id, sleeperPlayerId: `s${i}`, position: "WR", team: "DET" });
      const pts = 30 - i * 0.5;
      sleeper.set(
        `${id}|1`,
        sleeperRow({
          playerId: id,
          week: 1,
          statLine: { gp: 1, rec: pts / 3, rec_yd: pts * 4, rec_tgt: pts / 2 },
          points: { ppr: pts, halfPpr: pts * 0.9, std: pts * 0.8 },
        }),
      );
    }
    const result = computeBeaconProjections(baseInput({ subjects, sleeper }));
    const byId = new Map(result.projections.map((p) => [p.playerId, p]));

    // The last receiver is far below the 48th and must keep his number exactly.
    const deepBench = byId.get("wr59");
    expect(deepBench?.pointsPpr).toBeCloseTo(30 - 59 * 0.5, 6);

    // The top receiver is inside the range, above the mean, and must come DOWN.
    const top = byId.get("wr0");
    expect(top?.pointsPpr).toBeLessThan(30);
  });

  it("returns finite, non-negative points for every row it emits", () => {
    const result = computeBeaconProjections(baseInput());
    for (const p of result.projections) {
      for (const value of [p.pointsPpr, p.pointsHalfPpr, p.pointsStd]) {
        if (value === null) continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("contributes nothing at the shipped blend default, which is deliberate", () => {
    // blend.max ships at 0 on measured evidence (see default-settings.ts). At
    // that setting our source is a CALIBRATED Sleeper and nothing more, so a
    // modelled player's stored total must still be Sleeper's own number. If
    // this ever fails, someone raised the default and the backtest needs
    // rerunning before it goes anywhere near a reader.
    const inSeason = baseInput({
      stats: [
        ...offense("DET", 2025, WEEKS),
        ...offense("CHI", 2025, WEEKS),
        ...offense("DET", 2026, [1, 2, 3, 4, 5, 6]),
        ...offense("CHI", 2026, [1, 2, 3, 4, 5, 6]),
      ],
      latestWeek: 6,
      sleeper: new Map<string, SleeperProjectionRow>([
        ["DET-wr1|7", sleeperRow({ playerId: "DET-wr1", week: 7 })],
      ]),
    });
    const result = computeBeaconProjections(inSeason);
    const wr = result.projections.find((p) => p.playerId === "DET-wr1");
    expect(wr?.modelled).toBe(true);
    expect(wr?.blendWeight).toBe(0);
    expect(wr?.pointsPpr).toBeCloseTo(14, 6);
  });

  it("handles an empty input without throwing", () => {
    const result = computeBeaconProjections(
      baseInput({ subjects: [], sleeper: new Map(), stats: [] }),
    );
    expect(result.projections).toEqual([]);
    expect(result.modelled).toBe(0);
  });

  it("applies the game environment when a line exists and not when it does not", () => {
    // A rich environment for a modelled player should move his line. With
    // blendWeight 0 the stored POINTS cannot move, so assert on the stat line,
    // which is what a league rescoring under its own settings actually reads.
    const withOdds = computeBeaconProjections(
      baseInput({
        environment: new Map<string, GameEnvironment>([
          ["DET|1", { team: "DET", opponent: "CHI", impliedTotal: 30, spread: -7 }],
        ]),
      }),
    );
    const without = computeBeaconProjections(baseInput());

    const a = withOdds.projections.find((p) => p.playerId === "DET-rb1");
    const b = without.projections.find((p) => p.playerId === "DET-rb1");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Both mirror Sleeper's total at weight 0, which is the point: the
    // environment changed our own line without changing what we stored, and
    // that is exactly the preseason behaviour the blend is meant to produce.
    expect(a?.pointsPpr).toBeCloseTo(b?.pointsPpr ?? -1, 6);
  });
});

describe("leagueTargetsPerAttempt", () => {
  it("returns 1 when there is nothing to measure, making the correction a no-op", () => {
    expect(leagueTargetsPerAttempt([])).toBe(1);
  });

  it("measures the real ratio rather than assuming one", () => {
    const rows = [
      statRow({ playerId: "qb", position: "QB", passAttempts: 100 }),
      statRow({ playerId: "wr", position: "WR", targets: 90 }),
    ];
    expect(leagueTargetsPerAttempt(rows)).toBeCloseTo(0.9, 6);
  });

  it("ignores rows the player did not play", () => {
    const rows = [
      statRow({ playerId: "qb", position: "QB", passAttempts: 100 }),
      statRow({ playerId: "wr", position: "WR", targets: 90 }),
      statRow({ playerId: "ghost", position: "WR", gp: 0, targets: 500 }),
    ];
    expect(leagueTargetsPerAttempt(rows)).toBeCloseTo(0.9, 6);
  });
});

describe("withRedZoneLeverage", () => {
  const rates: EfficiencyRates = {
    catchRate: 0.7,
    yardsPerReception: 11,
    recTdPerTarget: 0.05,
    yardsPerCarry: 4.4,
    rushTdPerCarry: 0.04,
    completionRate: null,
    yardsPerAttempt: null,
    passTdPerAttempt: null,
    intPerAttempt: null,
    fumbleLostPerTouch: 0.005,
    weightedGames: 12,
  };

  it("raises the rushing touchdown rate for a goal line back", () => {
    const out = withRedZoneLeverage(rates, 0.5, 0.25);
    expect(out.rushTdPerCarry).toBeCloseTo(0.04 * 1.75, 6);
  });

  it("lowers it for a back used only between the twenties", () => {
    const out = withRedZoneLeverage(rates, 0.05, 0.4);
    expect(out.rushTdPerCarry).toBeCloseTo(0.04 * 0.5, 6);
  });

  it("leaves everything else alone", () => {
    const out = withRedZoneLeverage(rates, 0.5, 0.25);
    expect(out.catchRate).toBe(rates.catchRate);
    expect(out.yardsPerCarry).toBe(rates.yardsPerCarry);
  });

  it("returns the rates untouched when either share is missing", () => {
    expect(withRedZoneLeverage(rates, null, 0.3)).toEqual(rates);
    expect(withRedZoneLeverage(rates, 0.3, null)).toEqual(rates);
    expect(withRedZoneLeverage(rates, 0.3, 0)).toEqual(rates);
  });

  it("survives a null input entirely", () => {
    const out = withRedZoneLeverage(null, 0.3, 0.2);
    expect(out.rushTdPerCarry).toBeNull();
    expect(out.weightedGames).toBe(0);
  });
});
