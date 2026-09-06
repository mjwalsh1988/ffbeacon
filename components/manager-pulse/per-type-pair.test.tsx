/**
 * Unit tests for `resolvePerTypePairSides`, the pure decision at the heart of
 * `PerTypePair` (docs/manager-pulse/manager-pulse-plan.md section 6.0).
 *
 * This repo has no React Testing Library set up (no @testing-library/react in
 * package.json, and vitest.config.ts's `test.include` only picks up
 * `*.test.ts`, not `*.test.tsx`, so this file is not wired into `npm test`
 * today; see the report for MP-T029). Rather than add a dependency and a
 * config change outside this task's owned files, these tests target the one
 * exported function that makes the render decision: no JSX, no DOM, no
 * React import. Run directly with:
 *
 *   npx vitest run components/manager-pulse/per-type-pair.test.tsx
 */

import { describe, expect, it } from "vitest";
import { resolvePerTypePairSides } from "./per-type-pair";

describe("resolvePerTypePairSides", () => {
  it("under the all lens, returns both sides, never combined into one figure", () => {
    const sides = resolvePerTypePairSides({
      lens: "all",
      stat: { dynasty: 12, redraft: -4 },
      typeCounts: { dynasty: 5, redraft: 3 },
    });

    expect(sides).toHaveLength(2);
    const dynasty = sides.find((s) => s.type === "dynasty");
    const redraft = sides.find((s) => s.type === "redraft");
    expect(dynasty?.state).toBe("value");
    expect(dynasty?.value).toBe(12);
    expect(redraft?.state).toBe("value");
    expect(redraft?.value).toBe(-4);
    // The two values are preserved exactly as given: no sum (8), no average
    // (4), no field anywhere that merges them into one number.
    const values = sides.map((s) => s.value);
    expect(values).toEqual([12, -4]);
    expect(values.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).not.toBe(sides[0]?.value);
  });

  it("under a specific lens, returns only that one side", () => {
    const dynastyOnly = resolvePerTypePairSides({
      lens: "dynasty",
      stat: { dynasty: 12, redraft: -4 },
      typeCounts: { dynasty: 5, redraft: 3 },
    });
    expect(dynastyOnly).toHaveLength(1);
    expect(dynastyOnly[0]).toMatchObject({ type: "dynasty", state: "value", value: 12 });

    const redraftOnly = resolvePerTypePairSides({
      lens: "redraft",
      stat: { dynasty: 12, redraft: -4 },
      typeCounts: { dynasty: 5, redraft: 3 },
    });
    expect(redraftOnly).toHaveLength(1);
    expect(redraftOnly[0]).toMatchObject({ type: "redraft", state: "value", value: -4 });
  });

  it("a null side with league-seasons of that type is 'empty', not 'never' and not zero", () => {
    const sides = resolvePerTypePairSides({
      lens: "all",
      stat: { dynasty: null, redraft: 6 },
      typeCounts: { dynasty: 5, redraft: 3 },
    });
    const dynasty = sides.find((s) => s.type === "dynasty");
    expect(dynasty?.state).toBe("empty");
    expect(dynasty?.value).toBeNull();
  });

  it("a side with zero league-seasons of that type is 'never', even if the stat itself is non-null", () => {
    const sides = resolvePerTypePairSides({
      lens: "all",
      // A non-null value here would be a bug upstream, but the classification
      // must still read "never" off typeCounts, not off the value.
      stat: { dynasty: 12, redraft: 99 },
      typeCounts: { dynasty: 5, redraft: 0 },
    });
    const redraft = sides.find((s) => s.type === "redraft");
    expect(redraft?.state).toBe("never");
  });

  it("distinguishes 'never played' from 'not enough data' on the same call", () => {
    const sides = resolvePerTypePairSides({
      lens: "all",
      stat: { dynasty: null, redraft: null },
      typeCounts: { dynasty: 5, redraft: 0 },
    });
    const dynasty = sides.find((s) => s.type === "dynasty");
    const redraft = sides.find((s) => s.type === "redraft");
    // Same null stat on both sides, different typeCounts: the reasons differ.
    expect(dynasty?.state).toBe("empty");
    expect(redraft?.state).toBe("never");
  });

  it("carries each side's own sample size independently", () => {
    const sides = resolvePerTypePairSides({
      lens: "all",
      stat: { dynasty: 8, redraft: -2 },
      sampleStat: { dynasty: 14, redraft: 3 },
      typeCounts: { dynasty: 5, redraft: 3 },
    });
    const dynasty = sides.find((s) => s.type === "dynasty");
    const redraft = sides.find((s) => s.type === "redraft");
    expect(dynasty?.sampleSize).toBe(14);
    expect(redraft?.sampleSize).toBe(3);
  });

  it("sample size is null when no sampleStat is supplied", () => {
    const sides = resolvePerTypePairSides({
      lens: "dynasty",
      stat: { dynasty: 8, redraft: null },
      typeCounts: { dynasty: 5, redraft: 3 },
    });
    expect(sides[0]?.sampleSize).toBeNull();
  });
});
