"use client";

import { useId } from "react";
import { Info, UserMinus } from "lucide-react";
import type { DropCandidate } from "@/lib/faab/types";

/**
 * Who you could drop, as a shortlist rather than an instruction.
 *
 * The model ranks by projected lineup points and market value. Both are real,
 * and neither can see the reasons a reader keeps somebody: a handcuff whose
 * stock jumped the day the starter ahead of him went down, a rookie they are
 * high on, a piece of a trade already in motion. So this names a few players
 * and says plainly that the last call is theirs.
 *
 * Every figure a wide screen shows is present on a phone. The row stacks
 * rather than dropping the cost, and the cost is one sentence rather than a
 * number drawn for the eye with a hidden twin drawn for the ear.
 */
export function DropOptions({
  options,
  note,
  weeksConsidered,
}: {
  options: DropCandidate[];
  note: string | null;
  weeksConsidered: number;
}) {
  // Both a league answer and a manual answer can be on screen at once, so the
  // heading id has to be unique per instance or the second section points its
  // label at the first section's heading.
  const headingId = `${useId()}-drop`;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h4
        id={headingId}
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <UserMinus aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Who you could drop
      </h4>

      {options.length > 0 ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Your roster is full, so somebody has to go.{" "}
            {options.length === 1
              ? "Only one player here looks spare. Everyone else is in your lineup or worth more than this claim."
              : `Your lineup would miss these least over the next ${weeksConsidered} week${weeksConsidered === 1 ? "" : "s"}, cheapest first.`}
          </p>

          <ul role="list" className="mt-3 space-y-2">
            {options.map((option, index) => (
              <li
                key={option.playerId}
                className="rounded-card border border-line bg-base/50 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {option.name}
                      <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] font-medium text-ink-subtle">
                        {[option.position, option.team].filter(Boolean).join(" ") ||
                          "Bench"}
                      </span>
                      {option.injuryStatus && (
                        <span className="rounded-full border border-signal-warning/40 bg-signal-warning/10 px-2 py-0.5 text-[11px] font-medium text-signal-warning">
                          {option.injuryStatus}
                        </span>
                      )}
                      {index === 0 && (
                        <span className="rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-medium text-brand-cyan">
                          Used for the figures above
                        </span>
                      )}
                    </p>
                    {option.note && (
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                        {option.note}
                      </p>
                    )}
                  </div>

                  <p className="shrink-0 text-right text-xs text-ink-subtle">
                    {option.pointsPerWeek <= 0.05
                      ? "Free to cut"
                      : `Costs ${option.pointsPerWeek.toFixed(1)} points a week`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {note && <p className="mt-3 text-sm leading-relaxed text-ink-muted">{note}</p>}

      {/* The caveat is part of the answer, not a disclaimer bolted to the end
          of it, so it sits inside the same card and is read out with the list. */}
      <p className="mt-3 flex items-start gap-2 rounded-card border border-dashed border-line bg-base/40 px-3 py-2.5 text-sm leading-relaxed text-ink-muted">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
        <span>
          A shortlist, not advice. We only see projected points and market value,
          so we miss what you know: a backup who just became the starter, a rookie
          you like, a name someone has asked you about in a trade. Check before you
          cut.
        </span>
      </p>
    </section>
  );
}
