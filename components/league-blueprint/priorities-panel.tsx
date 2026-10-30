/**
 * Top priorities (plan 9.12): the written part of the report card. An
 * ordered list of three; the first is the section's hero (larger, full
 * ink), the other two follow at body size. The numerals are RankMarks, the
 * top three in the beacon gradient, and each priority is a ruled row.
 */

import { RankMark } from "@/components/league-leaderboards/leader-row";
import type { Priority } from "@/lib/league-blueprint/types";
import { RULED, SheetSection } from "./sheet";

export function PrioritiesPanel({ priorities, number }: { priorities: Priority[]; number: string }) {
  return (
    <SheetSection
      id="bp-priorities"
      number={number}
      title="The plan"
      helper="Three priorities, in order. Each one cites a figure from this report."
    >
      <ol className={RULED}>
        {priorities.map((p, i) => (
          <li key={p.id} className="flex items-start gap-3 py-3.5">
            <RankMark rank={i + 1} />
            <p
              className={
                i === 0
                  ? "pt-0.5 text-lg font-bold leading-snug text-ink sm:text-xl"
                  : "pt-1 text-base leading-relaxed text-ink-muted"
              }
            >
              {p.text}
            </p>
          </li>
        ))}
      </ol>
    </SheetSection>
  );
}
