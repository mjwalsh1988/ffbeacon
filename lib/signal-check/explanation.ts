/**
 * Signal Check explanation generator (no LLM).
 *
 * Builds a deterministic, plain-language explanation from the verdict, the
 * trade-shape label, and the rule trace. Wording is consistent and
 * reproducible, with no hallucination risk. Raw value points are never emitted
 * here (the public toggle handles point display separately in the UI).
 */

import { NO_VERDICT_LABEL, NO_VERDICT_REASON, partialGradeNote, type PartialGrade } from "@/lib/trade-grading/partial";
import type {
  AnalyzedSide,
  BeaconVerdict,
  RuleTraceEntry,
  SideKey,
  TradeShapeResult,
} from "./types";

export interface ExplanationParams {
  /** Partial-grade facts (plan R-19). Optional so older callers still work. */
  grade?: PartialGrade;
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

/**
 * Give an admin-authored string terminal punctuation when it has none.
 *
 * THE VERDICT LABEL IS A LABEL, NOT A SENTENCE, and the two shapes arrive
 * through the same field. `signal_check_win_template` is authored as a full
 * sentence ending in a period ("Side A wins by 12.4% of total trade value.")
 * while `signal_check_neutral_label` and `signal_check_blowout_label` are
 * captions ("Fair Trade", "Fleeced"). Everything below is a sentence, and the
 * whole list is joined with a single space, so a caption ran straight into the
 * next sentence: "Fair Trade Neither side comes out meaningfully ahead."
 *
 * Adding the stop here rather than in the stored settings is deliberate. The
 * labels are shown on their OWN in the UI, where a trailing period on a chip
 * reading "Fleeced." would be wrong, and an admin editing that field should not
 * have to know which of the two places it lands in.
 */
function asSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function buildExplanation(params: ExplanationParams): string {
  const { verdict, tradeShape, sides, trace, hasMissingValues, grade } = params;
  // No verdict: one side is only defensive players. Say why and stop; a
  // "neither side comes out ahead" line would be a verdict by another name.
  if (grade && !grade.graded) {
    return `${asSentence(NO_VERDICT_LABEL)} ${NO_VERDICT_REASON}`;
  }
  const sentences: string[] = [asSentence(verdict.label)];

  // Kept alongside the consolidation sentence rather than suppressed by it. The
  // consolidation sentence explains the discount; this one names who holds the
  // best asset, and it is measured rather than assumed, so the two complement
  // each other instead of repeating.
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
    // Same rule as the verdict label: these are admin-authored templates and
    // nothing guarantees the author ended one with a stop.
    sentences.push(asSentence(text));
  }

  if (tradeShape.enabled && tradeShape.label) {
    const label = tradeShape.label.toLowerCase();
    sentences.push(`The deal grades as ${indefiniteArticle(label)} ${label}.`);
  }

  if (grade?.partial) sentences.push(partialGradeNote(grade.unpricedCount));

  // The generic note is for a value we expected and did not find. Defenders
  // are counted by the partial line above, so it fires only when something
  // else is missing too.
  // Without grade facts (an older caller) the note behaves as it always did.
  const otherMissing =
    hasMissingValues &&
    (!grade?.partial ||
      (["a", "b"] as const).some((side) =>
        (sides[side]?.assets ?? []).some(
          (r) => r.asset?.noValue && !(r.asset.kind === "player" && r.asset.unpriced),
        ),
      ));
  if (otherMissing) {
    sentences.push(
      "Note: one or more assets had no FF Beacon value and were excluded from the totals.",
    );
  }

  // An empty label would otherwise leave a leading space on the whole string.
  return sentences.filter(Boolean).join(" ");
}
