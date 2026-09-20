"use client";

import { useId } from "react";
import { Users } from "lucide-react";
import type { RivalRow } from "@/lib/faab/types";

/**
 * Who else wants him, by name.
 *
 * A real table, because this is tabular: four facts about each of several
 * teams, and a reader comparing budgets down a column is doing exactly what a
 * table is for. Team names are real names rather than "Team 4": the reader is
 * in this league and already knows who these people are, and an anonymised
 * table would be harder to act on without being any more private.
 *
 * Only the teams who would actually start him are listed. The rest are one
 * sentence underneath, because eleven rows saying "would not start him" is
 * not a list anybody reads. The two counts come from one definition in the
 * engine and always sum to the rivals checked, so the table and the sentence
 * under it describe the same league.
 *
 * NOTHING IS DROPPED ON A PHONE. The columns are short by design (a budget, a
 * style, a range) so all four fit at 400px with the team name wrapping, and no
 * cell is hidden at any breakpoint.
 */
export function RivalTable({
  rivals,
  notInterested,
  playerName,
}: {
  rivals: RivalRow[];
  notInterested: number;
  playerName: string;
}) {
  const headingId = `${useId()}-rivals`;
  if (rivals.length === 0 && notInterested === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h4
        id={headingId}
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <Users aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Who else wants him
      </h4>

      {rivals.length > 0 && (
        <table className="mt-3 w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Teams that would start {playerName}, and what they can spend.
          </caption>
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                Team
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                Budget left
              </th>
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                Bid style
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                Likely bid
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rivals.map((rival) => (
              <tr key={rival.rosterId}>
                <th
                  scope="row"
                  className="py-1.5 pr-2 text-left font-medium text-ink"
                >
                  {rival.teamName}
                </th>
                <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                  {rival.budget} FAAB
                </td>
                <td className="py-1.5 pr-2 text-ink-muted">{rival.style}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-muted">
                  {rival.likelyBid
                    ? `${rival.likelyBid.low} to ${rival.likelyBid.high}`
                    : "Not enough to price"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* One sentence, never two: with no rivals listed, "nobody else would
          start him" and "13 other teams would not" are the same fact said
          twice. */}
      {notInterested > 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          {rivals.length === 0
            ? `Nobody else would start him. All ${notInterested} of the other teams already have someone better in that slot.`
            : `${notInterested} other team${notInterested === 1 ? "" : "s"} would not start him.`}
        </p>
      ) : (
        rivals.length === 0 && (
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Nobody else would start him.
          </p>
        )
      )}
    </section>
  );
}
