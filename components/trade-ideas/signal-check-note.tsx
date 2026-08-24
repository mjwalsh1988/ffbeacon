import { ShieldCheck } from "lucide-react";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";

/**
 * Signal Check's second opinion on a deal, as a block.
 *
 * Extracted because two surfaces show it and only ever one of them at a time.
 * The suggestion card carries it while there is no full evaluation on screen;
 * once the evaluation loads, the Value tab inside it owns the grade and the card
 * drops its own copy, so the same verdict is never printed twice on one page.
 * Two hand-maintained copies of this markup is how they would drift.
 *
 * Presentational. No state, no fetch.
 */
export function SignalCheckNote({ grade }: { grade: SuggestionGrade }) {
  return (
    <div className="rounded-card border border-line-accent bg-base/50 p-3">
      {/* The verdict sits ON the heading row rather than under it. As its own
          line it read as a second, shorter explanation of the paragraph below;
          beside the source of the opinion it reads as the opinion. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-brand-purple">
          <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
          Signal Check
        </h4>
        <p className="text-sm font-bold text-ink">{grade.verdictLabel}</p>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        {stripVerdictPrefix(grade.explanation, grade.verdictLabel)}
      </p>
      {/* The provenance, as chips. "Graded on FF Beacon values in Dynasty
          Superflex, High confidence, Two for one" was one run-on line doing three
          separate jobs, and the first clause named the grader a second time two
          lines under its own heading. */}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {[grade.formatDisplay, grade.confidenceLabel, grade.tradeShapeLabel]
          .filter(Boolean)
          .map((chip) => (
            <li
              key={chip as string}
              className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted"
            >
              {chip}
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * Signal Check's explanation opens by restating its own verdict, which is right
 * on its own page and wrong here, where the verdict is already the line above.
 * Left alone it reads "Fair Trade. Fair Trade Neither side comes out ahead."
 */
function stripVerdictPrefix(explanation: string, verdict: string): string {
  const trimmed = explanation.trimStart();
  if (!trimmed.toLowerCase().startsWith(verdict.trim().toLowerCase())) {
    return explanation;
  }
  return trimmed.slice(verdict.trim().length).replace(/^[\s.:,-]+/, "");
}
