/**
 * Signal Check explanation generator (no LLM).
 *
 * Builds a deterministic, plain-language explanation from the verdict, the
 * trade-shape label, and the rule trace. Wording is consistent and
 * reproducible, with no hallucination risk. Raw value points are never emitted
 * here (the public toggle handles point display separately in the UI).
 */

import type {
  AnalyzedSide,
  BeaconVerdict,
  RuleTraceEntry,
  SideKey,
  TradeShapeResult,
} from "./types";

export interface ExplanationParams {
  verdict: BeaconVerdict;
  tradeShape: TradeShapeResult;
  sides: Record<SideKey, AnalyzedSide>;
  trace: RuleTraceEntry[];
  hasMissingValues: boolean;
}

function bestAssetSide(sides: Record<SideKey, AnalyzedSide>): SideKey | null {
  let bestSide: SideKey | null = null;
  let bestVal = -Infinity;
  (["a", "b"] as SideKey[]).forEach((side) => {
    for (const r of sides[side].assets) {
      if (r.adjustedValue > bestVal) {
        bestVal = r.adjustedValue;
        bestSide = side;
      }
    }
  });
  return bestSide;
}

function indefiniteArticle(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function buildExplanation(params: ExplanationParams): string {
  const { verdict, tradeShape, sides, trace, hasMissingValues } = params;
  const sentences: string[] = [verdict.label];

  if (!verdict.isNeutral && verdict.winnerSide) {
    const winner = verdict.winnerSide;
    const best = bestAssetSide(sides);
    if (best === winner) {
      sentences.push(`Side ${winner.toUpperCase()} receives the strongest individual asset in the deal.`);
    }
  } else if (verdict.isNeutral) {
    sentences.push("Neither side comes out meaningfully ahead.");
  }

  // Surface side-level adjustments (pile-on and post-aggregation side rules)
  // straight from their trace explanations, de-duplicated.
  const seen = new Set<string>();
  for (const entry of trace) {
    if (entry.phase !== "post_aggregation_trade_shape") continue;
    const text = entry.publicExplanation.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    sentences.push(text);
  }

  if (tradeShape.enabled && tradeShape.label) {
    const label = tradeShape.label.toLowerCase();
    sentences.push(`The deal grades as ${indefiniteArticle(label)} ${label}.`);
  }

  if (hasMissingValues) {
    sentences.push(
      "Note: one or more assets had no FF Beacon value and were excluded from the totals.",
    );
  }

  return sentences.join(" ");
}
