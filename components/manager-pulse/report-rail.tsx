/**
 * What sits in the Manager Pulse rail: the answers a reader wants before they
 * have read anything, and the report's own provenance.
 *
 * NOTHING HERE IS COMPUTED. Every figure is read straight off the report the
 * sections beside it render, through the same `underLens` and `perTypeSlice`
 * helpers those sections use, so the rail and the section can never disagree
 * about the same manager. A second implementation of "their win rate" is
 * exactly the failure every model in this codebase is written to avoid.
 *
 * Each card collapses (see rail-card.tsx). Four cards at 340px are taller than
 * a viewport, and a reader who wants the last one should not have to scroll
 * past three they have already read.
 *
 * Presentational server component.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RailCard, RailFigure } from "./rail-card";
import {
  formatCount,
  formatPercent,
  formatRate,
  formatRecord,
  formatSigned,
} from "./format";
import { underLens, perTypeSlice, lensLabel } from "@/components/manager-shell/lens";
import { formatEastern } from "@/lib/datetime";
import type { LeagueLens, ManagerReport } from "@/lib/manager-pulse/types";

export function ReportRail({
  report,
  lens,
  generatedAt,
}: {
  report: ManagerReport;
  lens: LeagueLens;
  generatedAt: string;
}) {
  return (
    <>
      <AtAGlance report={report} lens={lens} />
      <HowToDealRail report={report} />
      <PartnersRail report={report} lens={lens} />
      <CoverageRail report={report} generatedAt={generatedAt} />
    </>
  );
}

/* ------------------------------------------------------------- at a glance */

function AtAGlance({ report, lens }: { report: ManagerReport; lens: LeagueLens }) {
  const winRate = underLens(report.results.winRate, lens);
  const record = underLens(report.results.record, lens);
  const championships = underLens(report.results.championships, lens);
  const tradeCount = underLens(report.trading.tradeCount, lens);
  const movesPerWeek = underLens(report.rosterOps.movesPerWeek, lens);
  const lineupEfficiency = underLens(report.rosterOps.lineupEfficiency, lens);

  // The margin is value-priced, so it never pools. Under the All lens the rail
  // shows the dynasty side, which is the one a reader is almost always asking
  // about, and says so in the label rather than quietly averaging two scales.
  const marginType = lens === "redraft" ? "redraft" : "dynasty";
  const margin = perTypeSlice(report.trading.avgValueMargin, marginType);

  return (
    <RailCard
      title="At a glance"
      badge={winRate === null ? undefined : formatPercent(winRate)}
    >
      {/* The rail's own lead figure, big and accented, so a reader who never
          scrolls past the masthead still leaves with one number. Everything
          under it qualifies this one. */}
      <div className="mb-2 flex items-baseline gap-2">
        <span
          className={`font-mono text-4xl font-extrabold leading-none tabular-nums ${
            winRate === null ? "text-ink-subtle" : "text-brand-cyan"
          }`}
        >
          {winRate === null ? (
            <>
              {"--"}
              <span className="sr-only"> Not enough settled games</span>
            </>
          ) : (
            formatPercent(winRate)
          )}
        </span>
        <span className="text-xs text-ink-muted">win rate, {lensLabel(lens).toLowerCase()}</span>
      </div>
      <dl>
        <RailFigure
          label="Record"
          value={record === null ? null : formatRecord(record)}
          emptyReason="No settled games yet"
        />
        <RailFigure
          label="Championships"
          value={championships === null ? null : formatCount(championships)}
          emptyReason="No titles in this window"
        />
        <RailFigure
          label="Trades"
          value={tradeCount === null ? null : formatCount(tradeCount)}
          emptyReason="No trades in this window"
        />
        <RailFigure
          label={`Trade margin, ${lensLabel(marginType).toLowerCase()}`}
          value={margin === null ? null : formatSigned(margin, "%")}
          emptyReason="Not enough graded trades"
        />
        <RailFigure
          label="Moves per week"
          value={movesPerWeek === null ? null : formatRate(movesPerWeek)}
          emptyReason="Not enough measured weeks"
        />
        <RailFigure
          label="Lineup efficiency"
          value={lineupEfficiency === null ? null : formatPercent(lineupEfficiency)}
          emptyReason="No measured seasons yet"
        />
      </dl>
    </RailCard>
  );
}

/* ------------------------------------------------------------- how to deal */

/**
 * The first few narrative sentences, verbatim, with a jump to the section that
 * holds all of them. Truncating a sentence would change what it claims, so the
 * cut is between sentences and the link says how many are left.
 */
function HowToDealRail({ report }: { report: ManagerReport }) {
  const sentences = report.narrative.sentences;
  if (sentences.length === 0) return null;
  const shown = sentences.slice(0, 3);
  const remaining = sentences.length - shown.length;

  return (
    <RailCard title="How to deal with them" badge={formatCount(sentences.length)}>
      <ul className="space-y-2.5">
        {shown.map((sentence) => (
          <li key={sentence.templateId} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-cyan"
            />
            <span className="text-xs leading-relaxed text-ink">{sentence.text}</span>
          </li>
        ))}
      </ul>
      <Link
        href="#narrative"
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {remaining > 0
          ? `Read all ${sentences.length}, ${remaining} more below`
          : "Go to the full section"}
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </RailCard>
  );
}

/* -------------------------------------------------------------- partners */

function PartnersRail({ report, lens }: { report: ManagerReport; lens: LeagueLens }) {
  const type = lens === "redraft" ? "redraft" : "dynasty";
  const partners = perTypeSlice(report.trading.mostTradedWith, type) ?? [];
  if (partners.length === 0) return null;

  return (
    <RailCard title="Trades most with" badge={lensLabel(type)} defaultOpen={false}>
      <ul className="space-y-1">
        {partners.slice(0, 6).map((entry) => (
          <li
            key={entry.sleeperUserId}
            className="flex items-baseline justify-between gap-2 border-b border-line/50 py-1.5 text-xs last:border-b-0"
          >
            <span className="min-w-0 truncate text-ink">
              {entry.handle ?? "Unknown Sleeper user"}
            </span>
            <span className="shrink-0 font-mono tabular-nums text-ink-muted">
              {entry.tradeCount}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="#trading"
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Every trade partner
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </RailCard>
  );
}

/* -------------------------------------------------------------- coverage */

/**
 * Where the report came from and what it could not measure.
 *
 * The limits used to sit alone at the very bottom of an eight-section page,
 * which is the one place a reader who has just been shown a dash has already
 * stopped looking. They belong next to the figures they explain.
 */
function CoverageRail({
  report,
  generatedAt,
}: {
  report: ManagerReport;
  generatedAt: string;
}) {
  const { limits } = report;
  const notes: string[] = [];

  if (limits.leagueSeasonsSkipped > 0) {
    notes.push(
      `${formatCount(limits.leagueSeasonsSkipped)} league-season${limits.leagueSeasonsSkipped === 1 ? " was" : "s were"} skipped because this lookup has a limit on how many it reads.`,
    );
  }
  if (limits.leagueSeasonsWithoutLedger > 0) {
    notes.push(
      `Lineup efficiency has no reading for ${formatCount(limits.leagueSeasonsWithoutLedger)} league-season${limits.leagueSeasonsWithoutLedger === 1 ? "" : "s"}. Those leagues have not been opened in League Pulse yet.`,
    );
  }
  if (limits.seasonsWithoutDraftObservations > 0) {
    notes.push(
      `No per-pick draft timing yet for ${formatCount(limits.seasonsWithoutDraftObservations)} season${limits.seasonsWithoutDraftObservations === 1 ? "" : "s"}.`,
    );
  }

  // OPEN WHEN THERE IS SOMETHING TO DISCLOSE. `limits-note.tsx`, which this
  // card replaced, said it out loud: a gap this names is one a reader would
  // otherwise have to infer from a dash somewhere else on the page, so it is
  // not a footnote to fold away. With nothing to disclose the card is just the
  // window and the build time, and that can start closed.
  return (
    <RailCard
      title="What this report covers"
      badge={notes.length > 0 ? `${notes.length} gap${notes.length === 1 ? "" : "s"}` : undefined}
      defaultOpen={notes.length > 0}
    >
      <dl>
        <RailFigure
          label="Seasons read"
          value={`${report.window.seasonFrom} to ${report.window.seasonTo}`}
        />
        <RailFigure
          label="League-seasons"
          value={formatCount(report.counts.leagueSeasons)}
        />
        <RailFigure label="Built" value={formatEastern(generatedAt)} />
      </dl>
      {notes.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold text-ink">
            What it could not measure
          </h3>
          <ul className="mt-1.5 space-y-1.5">
            {notes.map((note) => (
              <li key={note} className="text-[11px] leading-relaxed text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
        </>
      )}
    </RailCard>
  );
}
