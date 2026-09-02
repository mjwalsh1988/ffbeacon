/**
 * What the Decisions page looks like before a league has played.
 *
 * A server component. Two parts: an honest statement of why there is nothing
 * here, and, when the ledger really is going to fill in, a worked example of
 * what it will look like when it does.
 *
 * ABSOLUTE RULE: THE EXAMPLE MUST BE UNMISTAKABLE, TO EVERY READER, BY MORE
 * THAN ONE SIGNAL AT ONCE.
 *   This is the only place in the product that puts invented numbers on a page
 *   about a real league, and the whole feature's claim is that every figure on
 *   it is checkable. So the example is fenced by five independent signals, and
 *   none of them is decoration that could be missed:
 *
 *     1. The team names ARE the label. "Example team A" cannot be read as a
 *        Sleeper handle, so a screenshot of the table alone still says so.
 *     2. A "Sample" badge above it, with the words in text rather than an icon.
 *     3. A heading that says these are not this league's numbers.
 *     4. The table's own <caption>, which is the first thing a screen reader
 *        hears when it enters the table, and which says it again.
 *     5. A dashed border and a lowered contrast, so it does not read as the
 *        same class of object as a real panel.
 *
 *   The badge and the border are the two a screen reader cannot use, which is
 *   exactly why the other three are words.
 *
 * WHY THE EXAMPLE IS NOT THE REAL `LedgerTable`
 *   Fidelity is not worth what it would cost here. `LedgerTable` is a client
 *   component whose rows expand into a full ledger and open a bottom sheet, so
 *   reusing it would mean inventing a whole season of weekly detail, waiver
 *   moves, trades and draft picks for four teams that do not exist, and then
 *   letting a reader open and explore all of it. A reader who can drill into
 *   invented data has been handed something that behaves exactly like the real
 *   thing. This is a flat, inert picture of the shape of the page, and the
 *   difference in behaviour is itself one more signal that it is not real.
 *
 * NOTHING IS HIDDEN AT ANY BREAKPOINT. The example carries every column at
 * every width and scrolls sideways inside its own container when it has to,
 * which is what the real table does. No responsive utility hides a column here.
 */

import { Panel } from "@/components/dashboard-panel";
import type { LedgerEmptyState } from "@/lib/league-manager-ledger-data";

/**
 * The four example managers.
 *
 * Chosen to tell the story the real page exists to tell rather than to look
 * plausible. Read down the last two columns: A is the best manager in the room
 * with the fourth best roster, and D has the best roster in the room and is the
 * worst manager of it. That contrast IS the feature, and a preview built from
 * four unremarkable rows would demonstrate the layout and none of the point.
 */
const EXAMPLE_ROWS = [
  {
    rank: 1,
    team: "Example team A",
    started: "91%",
    leftOnBench: "142.6",
    perWeek: "10.2",
    record: "10-4",
    bestLineup: "12-2",
    winsLeft: 2,
    pointsRank: 3,
  },
  {
    rank: 2,
    team: "Example team B",
    started: "87%",
    leftOnBench: "218.4",
    perWeek: "15.6",
    record: "11-3",
    bestLineup: "13-1",
    winsLeft: 2,
    pointsRank: 4,
  },
  {
    rank: 3,
    team: "Example team C",
    started: "84%",
    leftOnBench: "291.0",
    perWeek: "20.8",
    record: "7-7",
    bestLineup: "11-3",
    winsLeft: 4,
    pointsRank: 2,
  },
  {
    rank: 4,
    team: "Example team D",
    started: "78%",
    leftOnBench: "402.8",
    perWeek: "28.8",
    record: "5-9",
    bestLineup: "10-4",
    winsLeft: 5,
    pointsRank: 1,
  },
] as const;

/** The rank gap, in the same words and colours the real table uses. */
function gapWords(efficiencyRank: number, pointsRank: number): {
  short: string;
  spoken: string;
  className: string;
} {
  const gap = pointsRank - efficiencyRank;
  if (gap === 0) {
    return {
      short: "even",
      spoken: "the same rank on decisions as on points",
      className: "text-ink-muted",
    };
  }
  if (gap > 0) {
    return {
      short: `up ${gap}`,
      spoken: `${gap} place${gap === 1 ? "" : "s"} better on decisions than on points`,
      className: "text-signal-success",
    };
  }
  const down = Math.abs(gap);
  return {
    short: `down ${down}`,
    spoken: `${down} place${down === 1 ? "" : "s"} worse on decisions than on points`,
    className: "text-signal-danger",
  };
}

/**
 * The four ledgers, as a list of what is coming.
 *
 * Only rendered when the ledger is actually going to fill in, for the same
 * reason the example is: on a league that can never be graded this would be a
 * list of things that are never going to happen.
 */
const LEDGERS = [
  {
    name: "Lineups",
    line: "How much of your roster's points you started, and the losses your bench would have won.",
  },
  {
    name: "Waivers",
    line: "What each pickup went on to score for you, against what you paid.",
  },
  {
    name: "Trades",
    line: "What came in, against what the players you sent scored elsewhere.",
  },
  {
    name: "Draft",
    line: "Each pick against what the room took in the same round.",
  },
] as const;

export function LedgerEmpty({ state }: { state: LedgerEmptyState }) {
  return (
    <div className="space-y-6">
      <Panel title={state.title} headingLevel={2}>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{state.body}</p>
        {state.next ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{state.next}</p>
        ) : null}

        {state.showPreview ? (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {LEDGERS.map((ledger) => (
              <li
                key={ledger.name}
                className="rounded-card border border-line bg-surface px-3.5 py-3"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
                  {ledger.name}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{ledger.line}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {state.showPreview ? <LedgerPreview /> : null}
    </div>
  );
}

function LedgerPreview() {
  return (
    <section
      aria-labelledby="ledger-preview-heading"
      className="relative overflow-hidden rounded-modal border border-dashed border-line-accent bg-surface/40 p-5 sm:p-6"
    >
      {/* Decorative, and pointer-events-none so it never becomes the thing a
          hovering screen reader finds instead of the content under it. Same
          treatment the page's own intro section uses, dimmed, so this reads as
          a quieter relative of a real panel rather than a different species. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <p className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
        Sample
      </p>

      <h2
        id="ledger-preview-heading"
        className="mt-3 text-lg font-semibold text-ink sm:text-xl"
      >
        What this looks like once games have been played
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        These four teams are made up, and so is every number beside them. Your
        league&apos;s own managers replace them once a week finishes.
      </p>

      <div className="mt-4 overflow-x-auto">
        {/* Lower contrast than a real table, and dashed above, so this does not
            read as the same class of object as the leaderboard it stands in
            for. The words do the work for anyone who cannot see either. */}
        <table className="w-full text-sm opacity-90">
          <caption className="sr-only">
            A made-up example, not your league. Columns: rank, team, the share
            of their own points the manager started, points left on the bench,
            their record, the record their best lineup would have produced,
            losses the bench would have won, and their rank on points scored.
          </caption>
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-center">
                <span aria-hidden="true">#</span>
                <span className="sr-only">Rank</span>
              </th>
              <th scope="col" className="px-2 py-2">
                Team
              </th>
              <th scope="col" className="px-2 py-2 text-center">
                Started
              </th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">
                Left behind
              </th>
              <th scope="col" className="px-2 py-2 text-center">
                Record
              </th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-center">
                Best lineup
              </th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-center">
                Wins left
              </th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">
                Points rank
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {EXAMPLE_ROWS.map((row) => {
              const gap = gapWords(row.rank, row.pointsRank);
              return (
                <tr key={row.team}>
                  <td className="whitespace-nowrap px-2 py-2.5 text-center font-mono text-sm font-bold tabular-nums text-ink-muted">
                    {row.rank}
                  </td>
                  <th scope="row" className="px-2 py-2.5 text-left font-medium text-ink">
                    {row.team}
                  </th>
                  <td className="px-2 py-2.5 text-center font-mono text-base font-extrabold tabular-nums text-ink">
                    {row.started}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-xs tabular-nums text-ink-muted">
                    {row.leftOnBench}
                    <span className="block text-[10px] text-ink-subtle">
                      {row.perWeek}
                      <span aria-hidden="true">/wk</span>
                      <span className="sr-only"> per week</span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted">
                    {row.record}
                  </td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs tabular-nums text-ink">
                    {row.bestLineup}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="font-mono text-sm font-bold tabular-nums text-brand-purple">
                      <span aria-hidden="true">{row.winsLeft}</span>
                      <span className="sr-only">
                        {row.winsLeft} games lost that the bench would have won
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span className="inline-flex flex-col items-end leading-tight">
                      <span className="font-mono text-xs tabular-nums text-ink">
                        <span aria-hidden="true">{row.pointsRank}</span>
                        <span className="sr-only">
                          {row.pointsRank} of 4 on points scored
                        </span>
                      </span>
                      <span
                        className={`font-mono text-[10px] font-semibold tabular-nums ${gap.className}`}
                      >
                        <span aria-hidden="true">{gap.short}</span>
                        <span className="sr-only">{gap.spoken}</span>
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
        The last two columns together are the point. Example team A has the
        third best roster here and gets the most out of it. Example team D
        scored more than anyone and left five winnable games on the bench.
      </p>

      <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
        Opening a real manager gives their week by week season, every pickup,
        every trade and every draft pick.
      </p>
    </section>
  );
}
