import { describe, expect, it } from "vitest";
import { DEFAULT_FAAB_SETTINGS } from "@/lib/faab/default-settings";
import {
  CHAMPION_LEDGER,
  CLUSTER_WEEK,
  CONSISTENCY_GROUPS,
  DANGER_RUNGS,
  PACE_TARGETS,
  PRICE_BANDS,
  SEASON_WEEKS,
  TEAMS,
  buildByeClusterRows,
  buildConsistencyRows,
  buildFieldRows,
} from "./chopped-examples";

/**
 * These tests exist to stop the page's PROSE and its DIAGRAMS drifting apart.
 * The guide states each of these numbers in a sentence, so each one is pinned
 * here: if a simulation, a seed or a shipped default moves, the assertion
 * fails and whoever moved it has to fix the sentence too.
 *
 * The simulated figures are asserted as inequalities and wide bands rather
 * than exact decimals. A Monte Carlo at a fixed seed is reproducible, but
 * pinning it to four places would turn a legitimate tuning change to
 * simulateSurvival into a failure in a guide test, which teaches people to
 * update the number rather than check the claim. The claims themselves, the
 * orderings and the rough magnitudes, are what the page actually says.
 */

describe("the field and the wire", () => {
  const rows = buildFieldRows();

  it("keeps every roster accounted for in every week", () => {
    for (const row of rows) {
      expect(row.alive + row.released).toBe(TEAMS);
    }
    expect(rows.length).toBe(SEASON_WEEKS);
  });

  it("never chops the last roster standing", () => {
    for (const row of rows) expect(row.alive).toBeGreaterThanOrEqual(1);
    expect(rows[rows.length - 1].alive).toBe(1);
  });

  it("balances in week 9 and crosses over in week 10, the two weeks the copy names", () => {
    const crossover = rows.filter((r) => r.crossover);
    expect(crossover.length).toBe(1);
    expect(crossover[0].week).toBe(10);
    // Week 9 is the exact balance point: nine rosters in the league and nine
    // on the wire. Week 10 is the first week the wire holds more than the
    // league does. That reversal is the whole point of the figure.
    expect(rows[8].alive).toBe(rows[8].released);
    expect(rows[9].released).toBeGreaterThan(rows[9].alive);
  });

  it("matches the guide's milestone sentences: 12 left after 6, 6 after 12", () => {
    expect(rows[5].alive).toBe(12);
    expect(rows[11].alive).toBe(6);
  });
});

describe("same points, different spread", () => {
  const rows = buildConsistencyRows();
  const steady = rows.find((r) => r.key === "steady")!;
  const average = rows.find((r) => r.key === "average")!;
  const spiky = rows.find((r) => r.key === "spiky")!;

  it("gives every roster in the league the identical weekly average", () => {
    // The figure's entire claim rests on this. If the means ever differ, the
    // gap below stops being about spread and the caption becomes a lie.
    const sigmas = CONSISTENCY_GROUPS.map((g) => g.sigma);
    expect(new Set(sigmas).size).toBe(3);
    expect(sigmas).toEqual([...sigmas].sort((a, b) => a - b));
  });

  it("ranks week 1 chop risk by spread alone, steady safest", () => {
    expect(steady.pChoppedWeek1).toBeLessThan(average.pChoppedWeek1);
    expect(average.pChoppedWeek1).toBeLessThan(spiky.pChoppedWeek1);
    // The page says the steady roster is under one percent and the spiky one
    // is around one in nine.
    expect(steady.pChoppedWeek1).toBeLessThan(0.02);
    expect(spiky.pChoppedWeek1).toBeGreaterThan(0.08);
  });

  it("has the average roster near the 1-in-18 baseline, as the other figure says", () => {
    // The existing SurvivalFigure runs an all-equal league at this same sigma
    // and lands on 1/18, about 5.6 percent. The middle group here should sit
    // close to it, which is what makes the two diagrams one league.
    expect(average.pChoppedWeek1).toBeGreaterThan(0.03);
    expect(average.pChoppedWeek1).toBeLessThan(0.07);
  });

  it("survives longer the steadier it is", () => {
    expect(steady.weeksAlive).toBeGreaterThan(average.weeksAlive);
    expect(average.weeksAlive).toBeGreaterThan(spiky.weeksAlive);
    expect(steady.weeksAlive).toBeGreaterThan(11);
    expect(spiky.weeksAlive).toBeLessThan(6.5);
  });

  it("backs the headline: steady wins the league several times as often", () => {
    expect(steady.pWin).toBeGreaterThan(spiky.pWin * 4);
    // A sanity floor. Eighteen rosters, so the average of all three groups
    // has to come out near 1/18 whatever the spreads are.
    const total = rows.reduce((sum, r) => sum + r.pWin * 6, 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.05);
  });

  it("is monotonic week by week, so the drawn curves never cross", () => {
    for (const row of rows) {
      let previous = 1;
      for (let w = 1; w <= SEASON_WEEKS; w += 1) {
        const p = row.pAliveAfter.get(w)!;
        expect(p).toBeLessThanOrEqual(previous + 1e-9);
        previous = p;
      }
    }
    for (let w = 1; w <= SEASON_WEEKS; w += 1) {
      expect(steady.pAliveAfter.get(w)!).toBeGreaterThan(spiky.pAliveAfter.get(w)!);
    }
  });
});

describe("the scheduled disaster", () => {
  const [cluster, spread] = buildByeClusterRows();

  it("only differs from the field in one week", () => {
    expect(CLUSTER_WEEK).toBeGreaterThan(1);
    expect(CLUSTER_WEEK).toBeLessThan(SEASON_WEEKS);
  });

  it("roughly triples the chop risk in the cluster week", () => {
    expect(cluster.pChoppedInClusterWeek).toBeGreaterThan(
      spread.pChoppedInClusterWeek * 2.5,
    );
    // The page says about one in ten becomes about two in five.
    expect(spread.pChoppedInClusterWeek).toBeLessThan(0.15);
    expect(cluster.pChoppedInClusterWeek).toBeGreaterThan(0.3);
  });

  it("costs real season equity for one week of scheduling", () => {
    expect(cluster.weeksAlive).toBeLessThan(spread.weeksAlive);
    expect(cluster.pWin).toBeLessThan(spread.pWin);
  });
});

describe("the ladders read off the shipped defaults", () => {
  it("reads the price bands from the calculator, not from a copy", () => {
    expect(PRICE_BANDS).toBe(DEFAULT_FAAB_SETTINGS.chopped.priceByAliveFraction);
    // Ordered high to low, which is the order priceByAliveFraction is matched
    // in. Out of order, the first band would swallow every lookup.
    for (let i = 1; i < PRICE_BANDS.length; i += 1) {
      expect(PRICE_BANDS[i].minFraction).toBeLessThan(PRICE_BANDS[i - 1].minFraction);
      expect(PRICE_BANDS[i].multiplier).toBeLessThan(PRICE_BANDS[i - 1].multiplier);
    }
    expect(PRICE_BANDS[PRICE_BANDS.length - 1].minFraction).toBe(0);
  });

  it("reads the pace targets from the calculator and ends the season at zero", () => {
    expect(PACE_TARGETS).toBe(DEFAULT_FAAB_SETTINGS.chopped.paceTargets);
    for (let i = 1; i < PACE_TARGETS.length; i += 1) {
      expect(PACE_TARGETS[i].throughWeek).toBeGreaterThan(PACE_TARGETS[i - 1].throughWeek);
      expect(PACE_TARGETS[i].holdPct).toBeLessThan(PACE_TARGETS[i - 1].holdPct);
    }
    expect(PACE_TARGETS[PACE_TARGETS.length - 1].holdPct).toBe(0);
  });

  it("keeps the champion's ledger a comparable shape to the targets", () => {
    for (let i = 1; i < CHAMPION_LEDGER.length; i += 1) {
      expect(CHAMPION_LEDGER[i].throughWeek).toBeGreaterThan(
        CHAMPION_LEDGER[i - 1].throughWeek,
      );
      expect(CHAMPION_LEDGER[i].holdPct).toBeLessThan(CHAMPION_LEDGER[i - 1].holdPct);
    }
    for (const point of CHAMPION_LEDGER) {
      expect(point.holdPct).toBeGreaterThanOrEqual(0);
      expect(point.holdPct).toBeLessThanOrEqual(100);
    }
    // The lesson's claim: he outheld the target early and then spent it all.
    expect(CHAMPION_LEDGER[1].holdPct).toBeGreaterThan(PACE_TARGETS[1].holdPct);
    expect(CHAMPION_LEDGER[3].holdPct).toBeLessThan(5);
  });

  it("reads every danger multiplier from the calculator, in ladder order", () => {
    const source = DEFAULT_FAAB_SETTINGS.chopped.manualDangerMultipliers;
    for (const rung of DANGER_RUNGS) {
      expect(rung.multiplier).toBe(source[rung.key]);
    }
    for (let i = 1; i < DANGER_RUNGS.length; i += 1) {
      expect(DANGER_RUNGS[i].multiplier).toBeLessThan(DANGER_RUNGS[i - 1].multiplier);
    }
    // The page says a safe team should bid less than the ordinary number and
    // a team in the bottom two should bid more. Mid-pack is the baseline.
    expect(DANGER_RUNGS.find((r) => r.key === "midPack")!.multiplier).toBe(1);
    expect(DANGER_RUNGS.find((r) => r.key === "safe")!.multiplier).toBeLessThan(1);
    expect(DANGER_RUNGS.find((r) => r.key === "bottomTwo")!.multiplier).toBeGreaterThan(1);
  });
});
