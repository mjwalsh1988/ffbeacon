import { describe, expect, it } from "vitest";
import { computeGrades, rankScore, toGrade, type GradeInput } from "./grades";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";

const base: GradeInput = {
  teamCount: 12,
  leagueKind: "dynasty",
  isSuperflex: false,
  valueRanks: { QB: 1, RB: 3, WR: 6, TE: 12 },
  pointsRanks: { QB: 1, RB: 5, WR: 6, TE: 12 },
  benchValueRank: 4,
  depthRank: 2,
  picksValueRank: 7,
  settings: DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.grades,
};

const gradeOf = (r: ReturnType<typeof computeGrades>, key: string) =>
  r.grades.find((g) => g.key === key)!;

describe("grades", () => {
  it("maps rank 1 of 12 to 10 and 12 of 12 to 1", () => {
    expect(toGrade(rankScore(1, 12))).toBe(10);
    expect(toGrade(rankScore(12, 12))).toBe(1);
  });

  it("blends value and points ranks half and half", () => {
    const r = computeGrades(base);
    // RB: (10/12 + 8/12) / 2 = 0.75 -> 8 (round 7.5 up)
    expect(gradeOf(r, "RB").grade).toBe(8);
    expect(gradeOf(r, "RB").reason).toBe(
      "3rd of 12 in running back value, 5th in projected running back points.",
    );
  });

  it("falls back to value only with no Power Pulse", () => {
    const r = computeGrades({ ...base, pointsRanks: null, depthRank: null });
    // RB value rank 3: 10/12 = 0.833 -> 8
    expect(gradeOf(r, "RB").grade).toBe(8);
    expect(gradeOf(r, "RB").pointsRank).toBeNull();
  });

  it("does not score picks in redraft or chopped, and does in keeper", () => {
    const r = computeGrades({ ...base, leagueKind: "redraft" });
    expect(gradeOf(r, "picks").grade).toBeNull();
    expect(gradeOf(r, "picks").reason).toBe("Not scored in redraft leagues.");
    expect(gradeOf(computeGrades({ ...base, leagueKind: "chopped" }), "picks").grade).toBeNull();
    expect(gradeOf(computeGrades({ ...base, leagueKind: "keeper" }), "picks").grade).toBe(5);
  });

  it("leaves a group with no figure ungraded and out of the overall", () => {
    const r = computeGrades({
      ...base,
      valueRanks: { ...base.valueRanks, TE: null },
      pointsRanks: { ...base.pointsRanks!, TE: null },
      picksValueRank: null,
    });
    expect(gradeOf(r, "TE").grade).toBeNull();
    expect(gradeOf(r, "TE").reason).toBe("Not scored: no tight end figure yet.");
    expect(gradeOf(r, "picks").grade).toBeNull();
    const g = Object.fromEntries(r.grades.map((x) => [x.key, x.grade]));
    const expected = (g.QB! * 1 + g.RB! * 1 + g.WR! * 1 + g.bench! * 0.5) / 3.5;
    expect(r.overall).toBe(Math.round(expected * 10) / 10);
  });

  it("has no overall when nothing is graded", () => {
    const none = { QB: null, RB: null, WR: null, TE: null };
    const r = computeGrades({
      ...base,
      valueRanks: none,
      pointsRanks: none,
      benchValueRank: null,
      depthRank: null,
      picksValueRank: null,
    });
    expect(r.overall).toBeNull();
    expect(r.grades.every((x) => x.grade === null)).toBe(true);
  });

  it("weights the quarterback up in superflex and returns one decimal", () => {
    const one = computeGrades(base).overall!;
    const sf = computeGrades({ ...base, isSuperflex: true }).overall!;
    expect(sf).toBeGreaterThan(one);
    expect(Math.round(one * 10) / 10).toBe(one);
  });

  it("computes the overall as the weighted mean", () => {
    const r = computeGrades(base);
    const g = Object.fromEntries(r.grades.map((x) => [x.key, x.grade!]));
    const expected =
      (g.QB * 1 + g.RB * 1 + g.WR * 1 + g.TE * 0.75 + g.bench * 0.5 + g.picks * 0.5) / 4.75;
    expect(r.overall).toBe(Math.round(expected * 10) / 10);
  });
});
