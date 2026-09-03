/**
 * What this week did to the year.
 *
 * A single week is a story; a season is the point. This is the bridge: the
 * record as it stands, the record the best lineups would have produced, and how
 * this manager ranks on decisions against how their roster ranks on points.
 *
 * EVERY FIGURE IS THE MANAGER LEDGER'S, READ AND NOT RECOMPUTED. The Decisions
 * page owns "how good is this manager" and its cache already holds all of it
 * per roster (lib/manager-ledger/). A second implementation on this page would
 * drift from it, and two League Pulse pages disagreeing about the same
 * manager's efficiency is exactly the class of bug the shared-primitive rule
 * exists to prevent. `components/manager-ledger/format.ts` supplies the wording
 * too, so a figure is spelled the same way on both pages.
 *
 * THE THREE RANKS ANSWER DIFFERENT QUESTIONS and the page says so, because
 * putting them side by side without the distinction is how a reader concludes
 * they are bad at fantasy when they have simply had a rough schedule:
 *
 *   SCORING RANK      the roster. What it produced.
 *   EFFICIENCY RANK   the manager. How much of it they started.
 *   (the schedule)    luck, and it lives on the Schedule page.
 *
 * Server component. Presentational only.
 */

import Link from "next/link";
import { ArrowRight, Gauge, ListChecks, Trophy } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { NOT_MEASURED, games, pct, pts, rankWords, record } from "@/components/manager-ledger/format";
import type { SeasonLedgerSummary } from "@/lib/league-lineups/season-data";

export function SeasonContextPanel({
  ledger,
  teamName,
  decisionsHref,
}: {
  /** Null when the ledger has not been built for this league yet. */
  ledger: SeasonLedgerSummary | null;
  teamName: string;
  decisionsHref: string;
}) {
  if (!ledger || ledger.weeksGraded === 0) {
    return (
      <Panel
        eyebrow="The season"
        title="Where this leaves your year"
        helper="Fills in after your first settled week."
        headingLevel={2}
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          No week of this season has settled yet, so there is no season to put this week
          into. Once one has, this shows your record, the record your best lineups would
          have produced, and where you rank on decisions against where your roster ranks on
          points.
        </p>
      </Panel>
    );
  }

  const gap =
    ledger.efficiencyRank !== null && ledger.scoringRank !== null
      ? ledger.efficiencyRank - ledger.scoringRank
      : null;

  return (
    <Panel
      eyebrow="The season"
      title="Where this leaves your year"
      helper={`${ledger.weeksGraded} settled ${ledger.weeksGraded === 1 ? "week" : "weeks"}, graded on what actually happened.`}
      headingLevel={2}
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure
          term="Your record"
          value={record(ledger.actualRecord)}
          words={`${spokenRecord(ledger.actualRecord)}, as they stand`}
          icon={<Trophy aria-hidden="true" className="h-4 w-4" />}
          emphasis
        />
        <Figure
          term="Best lineups"
          value={record(ledger.bestLineupRecord)}
          words={`${spokenRecord(ledger.bestLineupRecord)} from your best legal lineups, against the same opponents`}
          icon={<ListChecks aria-hidden="true" className="h-4 w-4" />}
        />
        <Figure
          term="Lineup efficiency"
          value={pct(ledger.efficiency)}
          words="of your own roster's points started across the season"
          icon={<Gauge aria-hidden="true" className="h-4 w-4" />}
        />
      </dl>

      {ledger.winsLeftOnBench > 0 && (
        <p className="mt-3 rounded-card border border-brand-purple/40 bg-brand-purple/5 px-3 py-2.5 text-sm leading-relaxed text-ink">
          <span className="font-semibold">
            {games(ledger.winsLeftOnBench)} left on the bench this season.
          </span>{" "}
          <span className="text-ink-muted">
            That many losses would have been wins from the best legal lineup out of the same
            roster, against the score the opponent actually put up.
          </span>
        </p>
      )}

      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {teamName} has left {pts(ledger.pointsLeft)} points on the bench in total.{" "}
        {ledger.scoringRank !== null && ledger.efficiencyRank !== null ? (
          <>
            The roster ranks {rankWords(ledger.scoringRank, ledger.teamCount)} on points
            scored, and the manager ranks {rankWords(ledger.efficiencyRank, ledger.teamCount)}{" "}
            on decisions.{" "}
            {gap !== null && gap >= 4
              ? "The roster is doing more of the work than the lineup card is."
              : gap !== null && gap <= -4
                ? "More is being got out of this roster than it produces on paper."
                : "Those two sit close together, so the roster and the decisions are pulling the same way."}
          </>
        ) : (
          "Ranks fill in once enough weeks have settled to compare teams fairly."
        )}
      </p>

      <p className="mt-3">
        <Link
          href={decisionsHref}
          className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[32px]"
        >
          Every manager in this league, graded
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </p>
    </Panel>
  );
}

/**
 * "6 wins, 3 losses". A record read aloud as digits and a dash makes a reader
 * reconstruct which number is which, and the tile beside it never said.
 */
function spokenRecord(r: { wins: number; losses: number; ties: number }): string {
  const parts = [
    `${r.wins} win${r.wins === 1 ? "" : "s"}`,
    `${r.losses} loss${r.losses === 1 ? "" : "es"}`,
  ];
  if (r.ties > 0) parts.push(`${r.ties} tie${r.ties === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/**
 * One labelled figure.
 *
 * The visible value is a real text node with the meaning appended beside it,
 * never an aria-hidden number with a spoken twin: pointing at "6-3" has to say
 * "6-3, wins losses and ties as they stand" rather than falling back to the
 * whole card.
 */
function Figure({
  term,
  value,
  words,
  icon,
  emphasis = false,
}: {
  term: string;
  value: string;
  words: string;
  icon: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border px-4 py-3 ${
        emphasis ? "border-line-accent bg-base/60" : "border-line bg-base/40"
      }`}
    >
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        <span className="text-brand-cyan">{icon}</span>
        {term}
      </dt>
      <dd className="mt-1">
        <span
          className={`block font-mono tabular-nums text-ink ${
            emphasis ? "text-3xl font-extrabold sm:text-4xl" : "text-2xl font-bold sm:text-3xl"
          }`}
        >
          {value}
          {/* The dash these formatters return for a missing figure is swallowed
              at a screen reader's default punctuation level, so without this the
              value announces as nothing and the words after it begin mid-air. */}
          <span className="sr-only">{value === "--" ? NOT_MEASURED : `, ${words}`}</span>
        </span>
      </dd>
    </div>
  );
}
