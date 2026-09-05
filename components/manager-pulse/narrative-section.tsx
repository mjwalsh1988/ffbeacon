/**
 * Section 6.7: how to deal with them.
 *
 * The actionable summary, and the section the whole tool exists for. Every
 * sentence is a deterministic template built elsewhere from the figures in
 * the other sections (`ManagerNarrative` on `lib/manager-pulse/types.ts`: no
 * free-text field, no language model anywhere in this feature). This
 * component only renders the list; it does not decide what it says.
 *
 * IT LEADS THE REPORT NOW, so it is drawn like a conclusion rather than like
 * an aside. Each sentence gets its own card with a beacon stripe down the
 * side, and the first clause, which is the finding, is set apart from the
 * evidence that follows it. The split is on the first full stop: every
 * template in `narrative.ts` is written as a short claim, then the numbers
 * behind it, in that order.
 *
 * Each `NarrativeSentence.text` already carries its own sample size inline
 * ("14 trades in 4 seasons"), so `sampleSize` is never appended again here.
 * Printing both would say the number twice, once in the sentence and once
 * bolted on after it.
 */

import { SectionFrame } from "./section-frame";
import type { ManagerNarrative } from "@/lib/manager-pulse/types";

/**
 * The claim and the evidence, split on the first full stop.
 *
 * Returns the whole string as the claim when there is no second sentence, so
 * a template that is one sentence long renders as one sentence rather than as
 * a heading with an empty body under it. Never rewrites a word of either half:
 * the templates are checkable against the numbers on this page, and a display
 * layer that edited them would break that.
 */
export function splitNarrative(text: string): { claim: string; evidence: string | null } {
  const stop = text.indexOf(". ");
  if (stop === -1) return { claim: text, evidence: null };
  return {
    claim: text.slice(0, stop + 1),
    evidence: text.slice(stop + 2).trim() || null,
  };
}

export function NarrativeSection({ narrative }: { narrative: ManagerNarrative }) {
  const sentences = narrative.sentences;

  return (
    <SectionFrame id="narrative" title="How to deal with them" accent="cyan">
      <p className="text-xs leading-relaxed text-ink-subtle">
        Built from templates that cite the figures elsewhere in this report, not written freehand.
        Every line here can be checked against a number on this page.
      </p>

      {sentences.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Not enough history yet to say anything useful about this manager. A few more graded
          seasons of trades and lineups will change that.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {sentences.map((sentence) => {
            const { claim, evidence } = splitNarrative(sentence.text);
            return (
              <li
                key={sentence.templateId}
                className="relative overflow-hidden rounded-card border border-line bg-base/40 py-3 pl-4 pr-3"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-beacon"
                />
                <p className="text-base font-semibold leading-snug text-ink">{claim}</p>
                {evidence && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{evidence}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionFrame>
  );
}
