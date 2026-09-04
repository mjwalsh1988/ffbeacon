/**
 * Section 6.7: how to deal with them.
 *
 * The actionable summary, and the section the whole tool exists for. Every
 * sentence is a deterministic template built elsewhere from the figures in
 * the other sections (`ManagerNarrative` on `lib/manager-pulse/types.ts`: no
 * free-text field, no language model anywhere in this feature). This
 * component only renders the list; it does not decide what it says.
 *
 * Each `NarrativeSentence.text` already carries its own sample size inline
 * ("14 trades in 4 seasons"), so `sampleSize` is never appended again here.
 * Printing both would say the number twice, once in the sentence and once
 * bolted on after it.
 */

import { SectionFrame } from "./section-frame";
import type { ManagerNarrative } from "@/lib/manager-pulse/types";

export function NarrativeSection({ narrative }: { narrative: ManagerNarrative }) {
  const sentences = narrative.sentences;

  return (
    <SectionFrame id="narrative" title="How to deal with them" eyebrow="Section 7" accent="cyan">
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
        <ul className="space-y-3">
          {sentences.map((sentence) => (
            <li key={sentence.templateId} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-2.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-cyan"
              />
              <span className="text-lg font-medium leading-snug text-ink">{sentence.text}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}
