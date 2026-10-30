/**
 * Top priorities (plan 9.12). An ordered list of three; the first is the
 * section's hero (larger, full ink), the other two follow at body size. The
 * numerals are RankMarks, the top three in the beacon gradient.
 */

import { Panel } from "@/components/dashboard-panel";
import { RankMark } from "@/components/league-leaderboards/leader-row";
import type { Priority } from "@/lib/league-blueprint/types";

export function PrioritiesPanel({ priorities }: { priorities: Priority[] }) {
  return (
    <Panel id="bp-priorities" eyebrow="In order" title="Top priorities">
      <ol className="space-y-3">
        {priorities.map((p, i) => (
          <li key={p.id} className="flex items-start gap-3">
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
    </Panel>
  );
}
