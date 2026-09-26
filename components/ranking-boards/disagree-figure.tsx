import { ChartFigure } from "@/components/chart-kit";
import { DivergingBars } from "@/components/manager-pulse/charts";
import { ordinal, type Disagreement } from "@/lib/ranking-boards/compare";

/**
 * "Where you disagree most" (plan sections 13.6 and 13.7): up to five players
 * the reader has HIGHER than the ranking, drawn in purple to the right of the
 * centre line, and up to five LOWER, in cyan to the left. Every number is also
 * a real text node beside its bar and in the table under the disclosure, so
 * nothing here is legible only as a shape.
 *
 * Shared by the finished run in Beacon Ranker and the public board page.
 */
export function DisagreeFigure({
  higher,
  lower,
  subject,
  owner,
  titleLevel = 3,
}: {
  higher: Disagreement[];
  lower: Disagreement[];
  subject: string;
  /** "You" in the builder, the owner's display name on a public board. */
  owner: string;
  titleLevel?: 3 | 4 | 5;
}) {
  if (higher.length === 0 && lower.length === 0) return null;
  const has = owner === "You" ? "You have" : `${owner} has`;
  const rows = [...higher, ...lower.slice().reverse()].map((d) => ({
    key: d.playerId,
    labelText: d.name,
    value: d.spots,
    display: d.spots > 0 ? `${d.spots} higher` : `${-d.spots} lower`,
  }));
  const top = higher[0] ?? null;
  const bottom = lower[0] ?? null;
  const parts: string[] = [];
  if (top) parts.push(`${top.name} is the biggest vote of confidence, ${top.spots} spots above ${subject}`);
  if (bottom) parts.push(`${bottom.name} the biggest fade, ${-bottom.spots} spots below`);
  const summary = `${has} ${higher.length} player${higher.length === 1 ? "" : "s"} higher than ${subject} and ${lower.length} lower in this chart. ${parts.join(", and ")}.`;

  return (
    <ChartFigure
      title={owner === "You" ? "Where you disagree most" : "Where this board disagrees most"}
      description={`Right of the line: ranked higher than ${subject} does. Left: lower.`}
      summary={summary}
      titleLevel={titleLevel}
      table={
        <table className="w-full min-w-[20rem] text-left text-xs">
          <caption className="sr-only">
            Biggest differences from {subject}, with both ranks
          </caption>
          <thead>
            <tr className="text-ink-subtle">
              <th scope="col" className="py-1 pr-3 font-medium">Player</th>
              <th scope="col" className="py-1 pr-3 font-medium">Board rank</th>
              <th scope="col" className="py-1 pr-3 font-medium">{subject} rank</th>
              <th scope="col" className="py-1 font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {[...higher, ...lower].map((d) => (
              <tr key={d.playerId} className="border-t border-line/60 text-ink-muted">
                <th scope="row" className="py-1 pr-3 font-medium text-ink">
                  {d.name}, {d.position}
                </th>
                <td className="py-1 pr-3 font-mono tabular-nums">{ordinal(d.readerRank)}</td>
                <td className="py-1 pr-3 font-mono tabular-nums">{ordinal(d.theirRank)}</td>
                <td className="py-1 font-mono tabular-nums">
                  {d.spots > 0 ? `${d.spots} higher` : `${-d.spots} lower`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <DivergingBars
        rows={rows}
        positiveClass="bg-brand-purple"
        negativeClass="bg-brand-cyan"
        labelWidthClass="sm:w-40"
      />
    </ChartFigure>
  );
}
