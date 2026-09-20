import { describe, expect, it } from "vitest";

import { bidForTargetFromCell, pickCell, priorCdf, type PriorCell } from "./priors-read";

function cell(over: Partial<PriorCell> = {}): PriorCell {
  const key = over.cellKey ?? "any|any|any|any|any";
  const [leagueKind, superflex, position, phase, bidders] = key.split("|");
  return {
    cellKey: key,
    leagueKind: leagueKind as PriorCell["leagueKind"],
    superflex: superflex as PriorCell["superflex"],
    position,
    phase,
    bidders: bidders as PriorCell["bidders"],
    sampleSize: 100,
    zeroShare: 0.2,
    p05: 0,
    p10: 0,
    p25: 1,
    p50: 5,
    p75: 12,
    p90: 26,
    p95: 40,
    p99: 83,
    runnerUpRatioP50: 2,
    leaguesCount: 20,
    seasons: [2024, 2025],
    builtAt: "2026-09-19T12:00:00.000Z",
    ...over,
  };
}

const WANT = {
  leagueKind: "dynasty" as const,
  superflex: true,
  position: "RB",
  phase: "wk2_6",
  bidders: "3" as const,
};

describe("pickCell", () => {
  it("uses the exact cell when it has the samples", () => {
    const exact = cell({ cellKey: "dynasty|yes|RB|wk2_6|3", sampleSize: 50 });
    const picked = pickCell([exact, cell()], WANT, 30);
    expect(picked?.cell.cellKey).toBe("dynasty|yes|RB|wk2_6|3");
    expect(picked?.fellBackTo).toBeNull();
  });

  it("drops the position first, because bidder count moves a price further", () => {
    const thin = cell({ cellKey: "dynasty|yes|RB|wk2_6|3", sampleSize: 4 });
    const wider = cell({ cellKey: "dynasty|yes|any|wk2_6|3", sampleSize: 60 });
    const picked = pickCell([thin, wider], WANT, 30);
    expect(picked?.cell.cellKey).toBe("dynasty|yes|any|wk2_6|3");
    expect(picked?.fellBackTo).toBe("every position");
  });

  it("widens one rung at a time and keeps the bidder count to the last", () => {
    const cells = [
      cell({ cellKey: "dynasty|yes|RB|wk2_6|3", sampleSize: 1 }),
      cell({ cellKey: "dynasty|yes|any|wk2_6|3", sampleSize: 2 }),
      cell({ cellKey: "dynasty|any|any|wk2_6|3", sampleSize: 3 }),
      cell({ cellKey: "dynasty|any|any|any|3", sampleSize: 4 }),
      cell({ cellKey: "any|any|any|any|3", sampleSize: 500 }),
    ];
    const picked = pickCell(cells, WANT, 30);
    expect(picked?.cell.cellKey).toBe("any|any|any|any|3");
    expect(picked?.fellBackTo).toBe("every league type");
  });

  it("falls all the way to every auction when even the league type is thin", () => {
    const cells = [
      cell({ cellKey: "dynasty|yes|RB|wk2_6|3", sampleSize: 1 }),
      cell({ cellKey: "any|any|any|any|3", sampleSize: 2 }),
      cell({ cellKey: "any|any|any|any|any", sampleSize: 9000 }),
    ];
    const picked = pickCell(cells, WANT, 30);
    expect(picked?.cell.cellKey).toBe("any|any|any|any|any");
    expect(picked?.fellBackTo).toBe("every auction we hold");
  });

  it("returns the widest cell it found rather than nothing when none clears the bar", () => {
    const only = cell({ cellKey: "any|any|any|any|any", sampleSize: 3 });
    const picked = pickCell([only], WANT, 30);
    expect(picked?.cell.sampleSize).toBe(3);
    expect(picked?.fellBackTo).toBe("every auction we hold");
  });

  it("returns null with no cells at all", () => {
    expect(pickCell([], WANT, 30)).toBeNull();
  });

  it("treats an unknown position as any rather than missing every rung", () => {
    const wide = cell({ cellKey: "dynasty|yes|any|wk2_6|3", sampleSize: 80 });
    const picked = pickCell([wide], { ...WANT, position: null }, 30);
    expect(picked?.cell.cellKey).toBe("dynasty|yes|any|wk2_6|3");
    expect(picked?.fellBackTo).toBeNull();
  });
});

describe("priorCdf", () => {
  it("starts at the share of auctions won for nothing", () => {
    expect(priorCdf(cell(), 0)).toBeCloseTo(0.2, 5);
  });

  it("reaches certainty at the full budget", () => {
    expect(priorCdf(cell(), 100)).toBe(1);
  });

  it("never decreases as the bid rises", () => {
    let last = -1;
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const value = priorCdf(cell(), pct);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("stays inside 0 and 1 for any bid, including nonsense ones", () => {
    for (const pct of [-50, -1, 0, 3.3, 99.9, 100, 250]) {
      const value = priorCdf(cell(), pct);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("puts the median bid at about half", () => {
    expect(priorCdf(cell(), 5)).toBeCloseTo(0.5, 2);
  });

  it("handles a cell where most auctions clear at zero without dividing by zero", () => {
    const flat = cell({ zeroShare: 0.8, p05: 0, p10: 0, p25: 0, p50: 0, p75: 1, p90: 5 });
    expect(priorCdf(flat, 0)).toBeCloseTo(0.8, 5);
    expect(priorCdf(flat, 1)).toBeGreaterThanOrEqual(0.75);
    expect(Number.isFinite(priorCdf(flat, 0.5))).toBe(true);
  });
});

describe("bidForTargetFromCell", () => {
  it("finds the cheapest bid that reaches the target", () => {
    const dollars = bidForTargetFromCell(cell(), 0.75, 100, 100);
    expect(dollars).toBe(12);
  });

  it("scales with the league's budget, because cells are shares not dollars", () => {
    const dollars = bidForTargetFromCell(cell(), 0.75, 1000, 1000);
    expect(dollars).toBe(120);
  });

  it("returns null when even the whole budget does not reach the target", () => {
    const dollars = bidForTargetFromCell(cell(), 0.99, 100, 20);
    expect(dollars).toBeNull();
  });

  it("asks for more in a wild room and less in a tight one", () => {
    const tight = bidForTargetFromCell(cell(), 0.75, 100, 100, 0.7);
    const wild = bidForTargetFromCell(cell(), 0.75, 100, 100, 1.4);
    expect(tight).toBeLessThan(wild!);
  });
});

describe("a chopped league asks for chopped cells", () => {
  /**
   * Chopped leagues are priced by how much of the field is left, never by
   * the week of the calendar. Reading Sleeper type 3 as redraft, which it
   * becomes once it is correctly not a keeper league, judged a guillotine
   * room hot or cold against redraft prices.
   */
  it("picks the chopped cell for an alive-fraction phase", () => {
    const choppedCell = cell({ cellKey: "chopped|any|any|alive_50p|3", sampleSize: 300 });
    const redraftCell = cell({ cellKey: "redraft|any|any|wk2_6|3", sampleSize: 900 });
    const picked = pickCell(
      [choppedCell, redraftCell],
      {
        leagueKind: "chopped",
        superflex: null,
        position: null,
        phase: "alive_50p",
        bidders: "3",
      },
      30,
    );
    expect(picked?.cell.cellKey).toBe("chopped|any|any|alive_50p|3");
    expect(picked?.fellBackTo).toBeNull();
  });

  it("falls back past the league type only when the chopped cells are thin", () => {
    const thin = cell({ cellKey: "chopped|any|any|alive_lt30|3", sampleSize: 2 });
    const wide = cell({ cellKey: "any|any|any|any|3", sampleSize: 900 });
    const picked = pickCell(
      [thin, wide],
      {
        leagueKind: "chopped",
        superflex: null,
        position: null,
        phase: "alive_lt30",
        bidders: "3",
      },
      30,
    );
    expect(picked?.cell.cellKey).toBe("any|any|any|any|3");
  });
});
