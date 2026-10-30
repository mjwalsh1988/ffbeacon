/**
 * The letterhead at the top of the sheet: who wrote it (FF Beacon), what it
 * is (a Team Blueprint), who it is about (the team, the manager, the league),
 * the report details as a form with dotted leaders, and the overall grade in
 * a grade box, the way a report card leads with the mark.
 *
 * Everything here comes from the stored view plus the league row, so the
 * letterhead and the body were written from the same numbers at the same
 * moment; the "Prepared" line is the view's own generatedAt.
 */

import type { ReactNode } from "react";
import { formatEastern } from "@/lib/datetime";
import { recordLabel } from "@/components/league-schedule/format";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import { Leader } from "./sheet";

export const BLUEPRINT_TITLE_ID = "blueprint-title";

function GradeBox({ overall }: { overall: number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border-2 border-line-accent bg-base/40 px-6 py-5 text-center sm:w-48">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">Overall grade</p>
      <p className="mt-2 bg-beacon bg-clip-text font-mono text-6xl font-black leading-none tabular-nums text-transparent sm:text-7xl">
        {overall.toFixed(1)}
      </p>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink-subtle">of 10</p>
    </div>
  );
}

export function Letterhead({
  view,
  leagueName,
  children,
}: {
  view: BlueprintView;
  leagueName: string;
  /** The share strip, placed under the details. */
  children?: ReactNode;
}) {
  const h = view.header;
  const status = view.standing.status;
  return (
    <header className="px-5 pb-6 pt-7 sm:px-8 sm:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="flex items-center gap-2.5">
          {/* The site's own mark, decorative: the words beside it name the author. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/ff-beacon-mark-96.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0" />
          <span className="text-sm font-semibold text-ink">FF Beacon</span>
          <span aria-hidden="true" className="h-3.5 w-px bg-line-accent" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Team Blueprint</span>
        </p>
        <p className="font-mono text-[11px] uppercase tracking-wide text-ink-subtle">{view.season} season report</p>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h2 id={BLUEPRINT_TITLE_ID} className="break-words text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">
            {h.teamName}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {h.ownerHandle ? `Prepared for @${h.ownerHandle} in ${leagueName}` : `Prepared for the manager of this team in ${leagueName}`}
            : where the team stands, what it is built from, and the moves worth making, from the league&apos;s own numbers.
          </p>
          <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
            <Leader label="Record">{recordLabel(h.record)}</Leader>
            <Leader label="Points for">
              {h.record.pointsFor.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </Leader>
            <Leader label="Standing">{status ? status.label : "Not computed yet"}</Leader>
            <Leader label="League">{`${h.teamCount} teams`}</Leader>
            <Leader label="Format">{h.formatDisplay}</Leader>
            <Leader label="Values">{h.sourceDisplay}</Leader>
            <Leader label="Prepared">{formatEastern(view.generatedAt)}</Leader>
            {h.pickSourceDisplay && <Leader label="Pick values">{h.pickSourceDisplay}</Leader>}
          </dl>
          {h.formatTags.length > 0 && (
            <ul role="list" aria-label="League format" className="mt-3 flex flex-wrap gap-1.5">
              {h.formatTags.map((t) => (
                <li
                  key={t.key}
                  className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {t.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <GradeBox overall={view.standing.overall} />
      </div>
      {children && <div className="mt-6">{children}</div>}
    </header>
  );
}
