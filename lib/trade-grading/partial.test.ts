import { describe, expect, it } from "vitest";
import { assessPartialGrade, partialGradeNote } from "./partial";
import { runPipeline } from "@/lib/signal-check/pipeline";
import { buildPublicPayload } from "@/lib/signal-check/freeze";
import { toBuilderView } from "@/lib/signal-check/builder-view";
import { missingValueNote } from "@/lib/signal-check/copy";
import {
  fakeResolver,
  settingsWith,
  DYNASTY_FORMAT,
  SOURCE,
} from "@/lib/signal-check/_test-kit";
import type { AnalysisInput } from "@/lib/signal-check/types";

describe("assessPartialGrade (plan R-19)", () => {
  it("a side of only a defender: no verdict, partial, one unpriced", () => {
    const g = assessPartialGrade([
      [{ noValue: true, position: "LB" }],
      [{ noValue: false, position: "WR" }],
    ]);
    expect(g).toEqual({ partial: true, unpricedCount: 1, unresolvedCount: 0, graded: false });
  });

  it("a defender beside a priced piece: partial but graded", () => {
    const g = assessPartialGrade([
      [
        { noValue: true, position: "DB" },
        { noValue: false, position: "RB" },
      ],
      [{ noValue: false, position: "WR" }],
    ]);
    expect(g.partial).toBe(true);
    expect(g.graded).toBe(true);
  });

  it("counts unresolved apart from unpriced, and an unpriced offensive player is not a defender", () => {
    const g = assessPartialGrade([
      [{ noValue: true, position: null, resolved: false }],
      [{ noValue: true, position: "WR" }],
    ]);
    expect(g).toEqual({ partial: false, unpricedCount: 0, unresolvedCount: 1, graded: true });
  });

  it("the team defense is not an individual defender", () => {
    expect(assessPartialGrade([[{ noValue: true, position: "DEF" }], []]).partial).toBe(false);
  });

  it("words the note", () => {
    expect(partialGradeNote(1)).toBe("Partial grade: excludes 1 defensive player no value source prices.");
    expect(partialGradeNote(3)).toContain("3 defensive players");
  });
});

describe("Signal Check with a defender", () => {
  const players = {
    wr: { name: "Receiver", position: "WR", team: "DAL", value: 100 },
    rb: { name: "Runner", position: "RB", team: "SF", value: 40 },
    lb: { name: "Linebacker", position: "LB", team: "BAL", value: null },
  };
  const base = () => ({
    resolver: fakeResolver(players),
    format: DYNASTY_FORMAT,
    source: SOURCE,
    settings: settingsWith(),
    rules: [],
    rulesetVersion: 1,
  });

  it("gives no verdict when a side is only a defender", () => {
    const input: AnalysisInput = {
      formatSlug: DYNASTY_FORMAT.slug,
      sides: { a: [{ kind: "player", playerId: "lb" }], b: [{ kind: "player", playerId: "wr" }] },
    };
    const r = runPipeline({ ...base(), input });
    expect(r.graded).toBe(false);
    expect(r.partial).toBe(true);
    expect(r.unpricedCount).toBe(1);
    expect(r.verdict.winnerSide).toBeNull();
    expect(r.verdict.label).toBe("No verdict");
    expect(r.explanation).toMatch(/^No verdict\. One side of this trade is only defensive players/);

    const payload = buildPublicPayload(r, settingsWith(), "2026-09-24T12:00:00.000Z");
    expect(payload.partial).toBe(true);
    expect(payload.graded).toBe(false);
    expect(payload.marginPct).toBeNull();
    expect(payload.sides[0].assets[0]).toMatchObject({ noValue: true, unpriced: true });
  });

  it("grades on the priced pieces and says it is partial", () => {
    const input: AnalysisInput = {
      formatSlug: DYNASTY_FORMAT.slug,
      sides: {
        a: [
          { kind: "player", playerId: "lb" },
          { kind: "player", playerId: "rb" },
        ],
        b: [{ kind: "player", playerId: "wr" }],
      },
    };
    const r = runPipeline({ ...base(), input });
    expect(r.graded).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.verdict.winnerSide).toBe("b");
    expect(r.explanation).toContain("Partial grade: excludes 1 defensive player");
    // A defender is not "a value we could not find".
    expect(r.explanation).not.toContain("had no FF Beacon value");
    const view = toBuilderView(r, settingsWith());
    expect(view.sides[0].assets[0].unpriced).toBe(true);
    expect(missingValueNote(view)).toBe("Partial grade: excludes 1 defensive player no value source prices.");
  });
});
