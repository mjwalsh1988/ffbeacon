"use client";

/**
 * Draft grades.
 *
 * A letter is only worth reading if you can argue with it, so every grade opens
 * to its components, each with the number that produced it, and the written
 * review leads with whichever component actually moved the letter.
 *
 * The curve is stated rather than implied. Twelve teams draft from one pool, so
 * a grade is mostly a comparison, and a reader who does not know that will read
 * a C as an insult instead of as "middle of this room".
 *
 * Progressive disclosure with a native details element: no custom widget, full
 * keyboard support, and a screen reader announces expanded state for free.
 */

import { GraduationCap } from "lucide-react";
import type { DraftGrade } from "@/lib/on-the-clock/draft-grade";
import { EmptyCard, NotStartedCard } from "./states";

function letterTone(letter: string): string {
  if (letter.startsWith("A")) return "text-emerald-300 border-emerald-400/50 bg-emerald-400/10";
  if (letter.startsWith("B")) return "text-brand-cyan border-brand-cyan/50 bg-brand-cyan/10";
  if (letter.startsWith("C")) return "text-ink border-line bg-base/60";
  if (letter.startsWith("D")) return "text-amber-300 border-amber-400/50 bg-amber-400/10";
  return "text-rose-300 border-rose-400/50 bg-rose-400/10";
}

export function DraftGrades({
  grades,
  inProgress,
  boardReady,
  draftStarted,
  pulseAvailable,
}: {
  grades: DraftGrade[];
  inProgress: boolean;
  boardReady: boolean;
  /** False before the first pick lands: there is nothing to grade. */
  draftStarted: boolean;
  pulseAvailable: boolean;
}) {
  if (!boardReady) {
    return (
      <EmptyCard
        title="FF Beacon values are not available yet."
        body="Grades are built from what each pick was worth against the market price of its slot. Once this format's FF Beacon values load, every team gets a grade."
      />
    );
  }
  // Before the first pick there is nothing to grade, and a table of identical
  // zeroes reads like a verdict rather than an absence of one.
  if (!draftStarted) {
    return (
      <NotStartedCard
        icon={GraduationCap}
        eyebrow="Draft grades"
        title="Nothing to grade yet"
        body="A grade is an argument about picks that have been made. Nobody has picked, so there is no case to make. These fill in from the first selection and move with every one after it."
        points={[
          "A letter and a 0 to 100 score for every team, curved against this room rather than against every draft on the site.",
          "Every grade opens to the components behind it, each with the number that produced it.",
          "A written review that leads with whichever component actually moved the letter.",
        ]}
      />
    );
  }
  if (grades.length === 0) {
    return (
      <EmptyCard
        title="No grades yet."
        body="Grades appear once teams have made picks we can price. Press Sync draft to pull the latest."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        {/* h2, matching every other tab panel; this one opened at h3 with no h2
            above it, so the outline skipped a level here and nowhere else. */}
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
          {inProgress ? "Draft grades so far" : "Draft grades"}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Graded against the {grades.length - 1} other{" "}
          {grades.length === 2 ? "draft" : "drafts"} in this room rather than against every draft on
          the site, because every team here is drafting from the same pool. Someone finishes last in
          a great room, and someone finishes first in a poor one.
          {inProgress && " The draft is still running, so these move with every pick."}
        </p>
        {!pulseAvailable && (
          <p className="mt-2 rounded-card border border-dashed border-line bg-surface/40 px-3 py-2 text-xs text-ink-subtle">
            Weekly projections are unavailable for this league, so the starting lineup and starter
            reliability components were left out and the remaining components carry the full weight.
          </p>
        )}
      </div>

      <ul role="list" className="space-y-3">
        {grades.map((grade) => (
          <li key={grade.rosterId}>
            <details
              className={`group overflow-hidden rounded-modal border bg-surface/40 ${
                grade.isYou ? "border-brand-purple/60" : "border-line"
              }`}
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan">
                <span
                  aria-hidden="true"
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-card border text-lg font-black ${letterTone(grade.letter)}`}
                >
                  {grade.letter}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">
                    {grade.ownerName}
                    {grade.isYou && (
                      <span className="ml-1.5 text-xs font-semibold text-brand-purple">(You)</span>
                    )}
                  </span>
                  {grade.teamName && (
                    <span className="block truncate text-xs text-ink-subtle">{grade.teamName}</span>
                  )}
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Grade {grade.letter}, {grade.score.toFixed(0)} out of 100, ranked{" "}
                    {grade.rank} of {grades.length} in this draft.
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-xs font-semibold text-ink-subtle group-open:hidden"
                >
                  Details
                </span>
              </summary>

              <div className="space-y-4 border-t border-line px-4 py-4">
                <p className="text-sm leading-relaxed text-ink">{grade.review}</p>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    What went into it
                  </h3>
                  <ul role="list" className="mt-2 space-y-2">
                    {grade.components.map((c) => (
                      <li key={c.key} className="rounded-card border border-line bg-base/50 px-3 py-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-semibold text-ink">{c.label}</span>
                          <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-brand-cyan">
                            {c.score.toFixed(0)}
                            <span className="ml-1 text-[10px] font-normal text-ink-subtle">
                              / 100, {Math.round(c.weight * 100)}% of the grade
                            </span>
                          </span>
                        </div>
                        {/* The bar is decorative: the number above it is the data,
                            and it is already in the text. */}
                        <div aria-hidden="true" className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full rounded-full bg-beacon"
                            style={{ width: `${Math.max(2, Math.min(100, c.score))}%` }}
                          />
                        </div>
                        {c.evidence && (
                          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{c.evidence}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {grade.omitted.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      Left out of this grade
                    </h3>
                    <ul role="list" className="mt-1.5 space-y-1">
                      {grade.omitted.map((o) => (
                        <li key={o.key} className="text-xs text-ink-subtle">
                          <span className="font-medium text-ink-muted">{o.label}:</span> {o.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>

      <p className="flex items-start gap-1.5 text-xs text-ink-subtle">
        <GraduationCap aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          A component with no data is dropped rather than scored zero, and the remaining components
          carry its weight. A redraft league has no future-assets component, and a team that never
          traded has no trades component.
        </span>
      </p>
    </div>
  );
}
