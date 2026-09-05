/**
 * Section 6.1 as the report's own masthead: who this is, at the top of the
 * page, in one band.
 *
 * It replaces what used to be a bare "Manager Pulse / handle" heading followed
 * by a full-width card whose entire job was to print one number. Both said the
 * same thing twice, and between them they spent the first screen of a report
 * on a name and a count.
 *
 * The band carries the avatar, the handle, the window sentence, and every
 * league-season figure the old card held, laid out across the width instead of
 * down it. `id="identity"` and `scroll-mt-24` live here, because the rail's
 * Overview row anchors at this section and there is no longer a card below to
 * anchor to.
 *
 * Used by the real report and by the guest sample, so a layout that breaks in
 * one breaks in the other. `headingLevel` is the one difference: the report
 * page has no other `<h1>`, and the sample sits under the entry page's.
 *
 * Presentational server component.
 */

import type { ReactNode } from "react";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { formatCount } from "./format";
import type { ManagerIdentity } from "@/lib/manager-pulse/types";

/**
 * The window sentence.
 *
 * It used to read "2 seasons, 60 league-seasons, 2023 to 2026", which states a
 * season count and a season range that contradict each other: the range is the
 * window we LOOKED IN, the count is the seasons we FOUND anything in, and a
 * reader has no way to tell those apart from a comma. Said in words instead.
 */
export function windowSentence(
  identity: ManagerIdentity,
  window?: { seasonFrom: number; seasonTo: number },
): string {
  const leaguesWord = identity.leagueSeasonsFound === 1 ? "league-season" : "league-seasons";
  const seasonsWord = identity.seasonsCovered === 1 ? "season" : "seasons";
  const base = `${formatCount(identity.leagueSeasonsFound)} ${leaguesWord} across ${identity.seasonsCovered} ${seasonsWord}`;
  if (window) return `${base}, found inside a ${window.seasonFrom} to ${window.seasonTo} window.`;
  if (identity.firstSeasonSeen !== null) return `${base}, since ${identity.firstSeasonSeen}.`;
  return `${base}.`;
}

export function ManagerMasthead({
  identity,
  window,
  headingLevel = 1,
  isSample,
  controls,
  note,
}: {
  identity: ManagerIdentity;
  /** The report's requested season window, when the caller has it. */
  window?: { seasonFrom: number; seasonTo: number };
  headingLevel?: 1 | 2;
  /** True on the guest sample. Folds the disclaimer into the heading itself. */
  isSample?: boolean;
  /** The lens switch, and anything else that filters the whole report. */
  controls?: ReactNode;
  /** A short status line, e.g. the stale-report notice. */
  note?: ReactNode;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const hasData = identity.leagueSeasonsFound > 0;
  const { dynasty, redraft, bestBallDynasty, bestBallRedraft } = identity.splits;

  return (
    <section
      id="identity"
      aria-labelledby="manager-masthead-heading"
      className="relative scroll-mt-24 overflow-hidden rounded-modal border border-line bg-surface-elevated/60"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-center gap-4">
            <ImageWithFallback
              src={identity.avatarUrl}
              alt={`${identity.handle}'s avatar`}
              size={64}
              className="shrink-0 ring-1 ring-line"
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                Manager Pulse
              </p>
              <Heading
                id="manager-masthead-heading"
                className="mt-0.5 truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl"
              >
                {identity.handle}
                {isSample && (
                  <span className="ml-2 align-middle text-xs font-semibold text-brand-cyan">
                    (Sample data, not a real manager)
                  </span>
                )}
              </Heading>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {identity.firstSeasonSeen !== null && (
                  <>First seen in {identity.firstSeasonSeen}. </>
                )}
                {windowSentence(identity, window)}
              </p>
            </div>
          </div>

          {controls && <div className="min-w-0">{controls}</div>}
        </div>

        {hasData && (
          <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <MastheadFigure
              label="League-seasons"
              value={formatCount(identity.leagueSeasonsFound)}
              lead
            />
            <MastheadFigure label="Dynasty" value={formatCount(dynasty)} />
            <MastheadFigure label="Redraft" value={formatCount(redraft)} />
            <MastheadFigure label="Best ball dynasty" value={formatCount(bestBallDynasty)} />
            <MastheadFigure label="Best ball redraft" value={formatCount(bestBallRedraft)} />
          </dl>
        )}

        {note && <div className="mt-3">{note}</div>}
      </div>
    </section>
  );
}

function MastheadFigure({
  label,
  value,
  lead = false,
}: {
  label: string;
  value: string;
  lead?: boolean;
}) {
  return (
    <div
      className={`rounded-card border px-3 py-2 ${
        lead ? "border-brand-cyan/40 bg-brand-cyan/5" : "border-line bg-base/40"
      }`}
    >
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-mono text-xl font-extrabold tabular-nums ${
          lead ? "text-brand-cyan" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
