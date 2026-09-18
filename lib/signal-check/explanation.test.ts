import { describe, expect, it } from "vitest";
import { buildExplanation, type ExplanationParams } from "./explanation";
import type { AnalyzedSide, RuleTraceEntry, SideKey } from "./types";

function side(values: number[]): AnalyzedSide {
  return {
    assets: values.map((adjustedValue, i) => ({
      adjustedValue,
      name: `Asset ${i}`,
    })),
  } as unknown as AnalyzedSide;
}

function params(over: Partial<ExplanationParams> = {}): ExplanationParams {
  return {
    verdict: {
      label: "Fair Trade",
      winnerSide: null,
      marginPct: 1.7,
      marginRaw: 30,
      isNeutral: true,
      isBlowout: false,
    } as ExplanationParams["verdict"],
    tradeShape: { enabled: false, label: null } as ExplanationParams["tradeShape"],
    sides: { a: side([100]), b: side([90]) } as Record<SideKey, AnalyzedSide>,
    trace: [],
    hasMissingValues: false,
    ...over,
  };
}

/**
 * The verdict label and the win template arrive through the SAME field and are
 * different shapes: "Fair Trade" is a caption, "Side A wins by 12.4% of total
 * trade value." is a sentence. Joining the list with a space ran the caption
 * straight into the sentence after it.
 */
describe("buildExplanation", () => {
  it("ends a caption-shaped verdict label with a stop", () => {
    expect(buildExplanation(params())).toBe(
      "Fair Trade. Neither side comes out meaningfully ahead.",
    );
  });

  it("leaves a label that already ends in punctuation alone", () => {
    const text = buildExplanation(
      params({
        verdict: {
          label: "Side A wins by 12.4% of total trade value.",
          winnerSide: "a",
          marginPct: 12.4,
          marginRaw: 300,
          isNeutral: false,
          isBlowout: false,
        } as ExplanationParams["verdict"],
      }),
    );
    expect(text.startsWith("Side A wins by 12.4% of total trade value. ")).toBe(true);
    expect(text).not.toContain("value.. ");
  });

  it("closes an admin-authored rule sentence that has no stop", () => {
    const trace = [
      {
        phase: "post_aggregation_trade_shape",
        publicExplanation: "Side B receives several lower-value pieces",
      },
    ] as unknown as RuleTraceEntry[];
    expect(buildExplanation(params({ trace }))).toContain(
      "Side B receives several lower-value pieces.",
    );
  });

  it("never leaves a leading space when the label is blank", () => {
    const text = buildExplanation(
      params({
        verdict: { ...params().verdict, label: "  " } as ExplanationParams["verdict"],
      }),
    );
    expect(text).toBe("Neither side comes out meaningfully ahead.");
  });

  it("reads as a paragraph of whole sentences end to end", () => {
    const text = buildExplanation(
      params({
        tradeShape: {
          enabled: true,
          label: "Near-even swap",
        } as ExplanationParams["tradeShape"],
        hasMissingValues: true,
      }),
    );
    expect(text).toBe(
      "Fair Trade. Neither side comes out meaningfully ahead. " +
        "The deal grades as a near-even swap. " +
        "Note: one or more assets had no FF Beacon value and were excluded from the totals.",
    );
    expect(text).not.toMatch(/\.\./);
  });
});
