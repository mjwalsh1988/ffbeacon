/**
 * Transaction volume: one bar per team, busiest first.
 *
 * The form is a horizontal bar chart because the job is comparing magnitude
 * across a dozen nominal categories, and the categories are team names, which
 * need horizontal room to be read. Every bar is the SAME hue: teams have no
 * natural order, so shading each bar darker where it is longer would encode bar
 * length twice and spend the only free channel on something the length already
 * says. The one exception is the reader's own team, drawn in brand purple with
 * a "You" chip beside it, so the difference never rests on colour alone.
 *
 * NOT AN <svg>. Every team name and every count is real text in the document,
 * which is what a screen reader reads and what a keyboard user can select. The
 * bars themselves are aria-hidden: they draw a number that is already printed
 * next to them. Same reasoning as the note in components/chart-kit.tsx about
 * why DOM-based charts are not wrapped in role="img".
 *
 * Server component. No hooks, no client bundle.
 */

import Link from "next/link";
import { Panel } from "@/components/dashboard-panel";
import type {
  TransactionVolume,
  TransactionVolumeTeam,
} from "@/lib/league-transaction-volume";

/**
 * Past this share of the widest bar the count no longer fits in the space to
 * the right of the tip, so it moves inside the bar end and switches to dark
 * text.
 *
 * Keyed to the DIGIT COUNT rather than fixed, because the narrowest track this
 * panel draws is about 120px (half of the overview's main column at xl, minus
 * the label column) and a four-digit count is a quarter of that. A single
 * threshold either clips "1562" on a busy league or pushes a two-digit count
 * inside a bar that had room for it. The panel is overflow-hidden, so a label
 * that does not fit is a label with its last character cut off.
 */
function labelInsideAbove(value: number): number {
  const digits = String(value).length;
  if (digits >= 4) return 66;
  if (digits >= 3) return 73;
  return 80;
}

/** The conclusion, read before the bars rather than instead of them. */
function summarize(teams: TransactionVolumeTeam[], leagueTotal: number): string {
  const busiest = teams[0];
  const quietest = teams[teams.length - 1];
  const lead = `${busiest.teamName} has been the busiest team with ${busiest.total} move${
    busiest.total === 1 ? "" : "s"
  }.`;
  if (!quietest || quietest.sleeperRosterId === busiest.sleeperRosterId) return lead;
  return `${lead} ${quietest.teamName} has the fewest with ${quietest.total}. ${leagueTotal} completed transactions in this league so far.`;
}

/**
 * One league-wide figure above the chart.
 *
 * These count ROWS, not sides, so they answer a different question from the
 * bars below: how much has happened in this league, and of what kind. The bars
 * answer who did it. The helper text under the heading says which is which,
 * because the two sets of numbers do not add up to each other and a reader who
 * tries will think something is broken.
 */
function LeagueStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-base/50 px-2.5 py-2">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function TypeCell({ value }: { value: number }) {
  return (
    <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">
      {value === 0 ? <span className="text-ink-subtle">0</span> : value}
    </td>
  );
}

export function TransactionVolumePanel({
  volume,
  viewerRosterId,
  transactionsHref,
}: {
  volume: TransactionVolume;
  /** The reader's own roster, when the URL identified one. */
  viewerRosterId: number | null;
  transactionsHref: string;
}) {
  const { teams, leagueTotal, leagueByType, excludedFailed } = volume;
  const max = teams.reduce((m, t) => Math.max(m, t.total), 0);
  const extras = teams.reduce((n, t) => n + t.byType.commissioner + t.byType.other, 0);

  // Says what the two sets of numbers are before the reader tries to reconcile
  // them. The tiles count moves; the bars count the teams in them, so a trade
  // is one move and two bars.
  const helper =
    "League totals up top. The bars count per team, so a trade counts for both sides." +
    (excludedFailed > 0
      ? ` ${excludedFailed} failed waiver claim${
          excludedFailed === 1 ? " is" : "s are"
        } left out.`
      : "");

  return (
    <Panel
      eyebrow="Activity"
      title="Transactions by team"
      helper={helper}
      action={
        <Link
          href={transactionsHref}
          className="relative inline-flex items-center gap-1 rounded-card border border-brand-cyan/45 bg-brand-cyan/10 px-2 py-1 text-[11px] font-semibold text-brand-cyan transition-colors after:absolute after:inset-x-0 after:-inset-y-3 after:content-[''] hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:px-3 sm:py-1.5 sm:text-xs sm:after:hidden"
        >
          Full feed
          <span aria-hidden="true">&rarr;</span>
        </Link>
      }
    >
      {/* THE TYPE TILES HAVE TO ADD UP TO "MOVES", or the row reads as a bug.
          The three a manager makes are always shown, zero included, because "no
          trades all season" is worth knowing. Commissioner moves and anything
          Sleeper adds later appear only when they exist, which is rare, and
          leaving them out when they do exist is what breaks the arithmetic:
          one synced league carries 47 of them against 1,521 of everything
          else.

          Two columns at every width. This panel is half of the overview's main
          column, so a third track leaves about 118px per tile even at 2xl, and
          the label "Commissioner" needs about 115 of them. Measured: at three
          columns it renders as "COMMI...", which is a tile whose own label is
          unreadable. */}
      <dl className="mb-4 grid grid-cols-2 gap-2">
        <LeagueStat label="Moves" value={leagueTotal} />
        <LeagueStat label="Trades" value={leagueByType.trade} />
        <LeagueStat label="Waivers" value={leagueByType.waiver} />
        <LeagueStat label="Free agents" value={leagueByType.freeAgent} />
        {leagueByType.commissioner > 0 && (
          // "Commish", not "Commissioner". The full word measures about 95px
          // in this label's size and tracking, and a tile in the narrowest
          // column has about 91px for it, so the long form renders as
          // "COMMISSIO..." on a 1280 screen. It is one word, so it cannot wrap
          // out of the problem.
          <LeagueStat label="Commish" value={leagueByType.commissioner} />
        )}
        {leagueByType.other > 0 && <LeagueStat label="Other" value={leagueByType.other} />}
      </dl>

      <p className="sr-only">{summarize(teams, leagueTotal)}</p>

      <ul role="list" className="space-y-2">
        {teams.map((team) => {
          const pct = max > 0 ? (team.total / max) * 100 : 0;
          const inside = pct > labelInsideAbove(team.total);
          const isViewer =
            viewerRosterId !== null && team.sleeperRosterId === viewerRosterId;
          const fill = isViewer ? "bg-brand-purple" : "bg-brand-cyan";
          const label = team.ownerLine
            ? `${team.teamName} ${team.ownerLine}`
            : team.teamName;

          return (
            <li
              key={team.sleeperRosterId}
              // Below sm the name takes its own line so the bar keeps the full
              // width of a phone. From sm up it is a left column, which is what
              // gives the bars one shared baseline to read from.
              //
              // A CLAMP, not a rem width and not a bare percentage. This panel
              // lives in half of the overview's main column, which is about
              // 250px at xl and about 1150px when it has the column to itself,
              // and Tailwind's breakpoints track the viewport rather than the
              // container, so no breakpoint can tell those apart. A fixed rem
              // width is comfortable at one and wrong at the other. A bare 40%
              // leaves 98px for a team name at the narrow end, which turns
              // "Seattle Seahawks" into "Seattle Seahaw..."; the 7rem floor
              // buys that back out of the track, and the 18rem ceiling stops
              // the name column swallowing half the panel at the wide end.
              className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[clamp(7rem,40%,18rem)_minmax(0,1fr)]"
            >
              <p className="flex min-w-0 items-baseline gap-1.5" title={label}>
                <span className="truncate text-xs font-medium text-ink">
                  {team.teamName}
                </span>
                {isViewer && (
                  <span className="shrink-0 rounded-card border border-brand-purple/50 bg-brand-purple/10 px-1 text-[9px] font-bold uppercase tracking-wide text-brand-purple">
                    You
                  </span>
                )}
              </p>

              <div className="relative h-6 min-w-0">
                {/* The track. Shows the full scale, and keeps a team that has
                    made no moves as a visible row rather than a blank line. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-1 h-4 rounded-r-[4px] bg-line/60"
                />
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-0 top-1 h-4 rounded-r-[4px] ${fill}`}
                  style={{ width: `${pct}%` }}
                />
                {inside ? (
                  // Inside the bar end, in near-black. Both fills clear AA
                  // against #07070D at this weight (cyan about 11:1, purple
                  // about 5.7:1).
                  <span
                    className="absolute left-0 top-0 flex h-6 items-center justify-end pr-1.5 text-[11px] font-bold tabular-nums text-[#07070D]"
                    style={{ width: `${pct}%` }}
                  >
                    {team.total}
                  </span>
                ) : (
                  <span
                    className="absolute top-0 flex h-6 items-center pl-1.5 text-[11px] font-semibold tabular-nums text-ink"
                    style={{ left: `${pct}%` }}
                  >
                    {team.total}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* The split behind each bar. Kept out of the chart on purpose: four
          stacked segments in a column this narrow would be unreadable, and the
          question the chart answers is who moves the most, not what kind. */}
      <details className="mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          View the numbers behind this chart
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[22rem] border-collapse text-left text-xs">
            <caption className="sr-only">
              Completed transactions per team, split by type. A trade is counted
              once for every team named in it.
            </caption>
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  Team
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  Total
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  Trades
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  Waivers
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  Free agents
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {teams.map((team) => (
                <tr key={team.sleeperRosterId}>
                  <th scope="row" className="py-1.5 pr-3 font-medium text-ink">
                    {team.teamName}
                    {team.ownerLine && (
                      <span className="ml-1 font-normal text-ink-subtle">
                        {team.ownerLine}
                      </span>
                    )}
                  </th>
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-ink">
                    {team.total}
                  </td>
                  <TypeCell value={team.byType.trade} />
                  <TypeCell value={team.byType.waiver} />
                  <TypeCell value={team.byType.freeAgent} />
                </tr>
              ))}
            </tbody>
          </table>
          {/* Commissioner moves are rare and are not a manager acting, so they
              get a footnote rather than a fifth column reading 0 the whole way
              down. They are still inside every Total above.

              No figure in this sentence on purpose. The only count that belongs
              beside a per-team Total is a per-team one, and the number a reader
              would want to check it against is the league count on the Commish
              tile, which is a different quantity. Naming one number here would
              invite comparing it with the other. */}
          {extras > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
              Totals also count moves a commissioner made, which are not broken
              out here.
            </p>
          )}
        </div>
      </details>
    </Panel>
  );
}
