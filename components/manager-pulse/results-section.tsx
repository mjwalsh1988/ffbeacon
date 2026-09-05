/**
 * Section 6.2: results.
 *
 * Every field on `ManagerResults` is scale-free (a rate, a percentile, a
 * count), so every field is a `PoolableStat` and every field reads through
 * `underLens`. Nothing here needs the per-type "show both" treatment the
 * value-priced sections do.
 *
 * Two labels are written to head off a misreading:
 *   - Average finish is a PERCENTILE of league size, not a raw rank, so 3rd in
 *     a 10-team league and 3rd in a 14-team league are told apart.
 *   - Points against is the OPPONENTS' scoring, so a high number is bad luck,
 *     not something the manager did. The label says so directly rather than
 *     trusting a reader to infer it from a rank sitting next to "points for".
 */

import { SectionFrame } from "./section-frame";
import { StatTile } from "./stat-tile";
import { formatPercent, formatCount, formatRecord, formatSample } from "./format";
import { underLens, lensLabel } from "@/components/manager-shell/lens";
import type { ManagerResults, LeagueLens } from "@/lib/manager-pulse/types";

export function ResultsSection({
  results,
  lens,
}: {
  results: ManagerResults;
  lens: LeagueLens;
}) {
  const sampleSize = underLens(results.sampleSize, lens);
  const winRate = underLens(results.winRate, lens);
  const championships = underLens(results.championships, lens);
  const runnerUps = underLens(results.runnerUps, lens);
  const playoffRate = underLens(results.playoffRate, lens);
  const lastPlaceFinishes = underLens(results.lastPlaceFinishes, lens);
  const avgFinishPercentile = underLens(results.avgFinishPercentile, lens);
  const pointsForRank = underLens(results.pointsForRank, lens);
  const pointsAgainstRank = underLens(results.pointsAgainstRank, lens);
  const record = underLens(results.record, lens);

  const sampleNote = formatSample(sampleSize, "league-season");

  return (
    <SectionFrame
      id="results"
      title="Results"
     
      accent="cyan"
      sampleNote={sampleNote || undefined}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* The section's one hero figure. A section where every tile is the
            same weight is a section with no answer in it. */}
        <StatTile
          label="Win rate"
          value={winRate === null ? null : formatPercent(winRate)}
          size="hero"
          sub={lensLabel(lens)}
          emptyReason="Not enough settled games"
        />
        <StatTile
          label="Championships"
          value={championships === null ? null : formatCount(championships)}
          tone="good"
          emptyReason="No titles in this window"
        />
        <StatTile
          label="Playoff rate"
          value={playoffRate === null ? null : formatPercent(playoffRate)}
          emptyReason="Not enough settled seasons"
        />
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <ResultRow
          label="Record"
          value={record === null ? null : formatRecord(record)}
          emptyReason="No settled games yet"
        />
        <ResultRow
          label="Runner-up finishes"
          value={runnerUps === null ? null : formatCount(runnerUps)}
          emptyReason="Not enough settled seasons"
        />
        <ResultRow
          label="Last-place finishes"
          value={lastPlaceFinishes === null ? null : formatCount(lastPlaceFinishes)}
          emptyReason="Not enough settled seasons"
        />
        <ResultRow
          label="Average finish, as a share of the league"
          value={avgFinishPercentile === null ? null : formatPercent(avgFinishPercentile)}
          emptyReason="Not enough settled seasons"
        />
        <ResultRow
          label="Points scored, ranked within their league"
          value={pointsForRank === null ? null : formatPercent(pointsForRank)}
          emptyReason="Not enough settled seasons"
        />
        <ResultRow
          label="Points scored against them, ranked within their league"
          value={pointsAgainstRank === null ? null : formatPercent(pointsAgainstRank)}
          sub="Their opponents' scoring. Not something the manager controlled."
          emptyReason="Not enough settled seasons"
        />
      </dl>
    </SectionFrame>
  );
}

/**
 * The dt/dd pair is a direct child of the wrapping `<div>`, matching
 * manager-masthead.tsx's `MastheadFigure`: a `<div>` inside a `<dl>` may only
 * contain `dt`/`dd` elements, so `sub` lives inside `dt` (flow content is
 * fine there) rather than in a second wrapping `<div>` around it. `dd` points
 * at `sub` with `aria-describedby` so the qualifier is tied to the value it
 * qualifies rather than left floating next to the label.
 */
function ResultRow({
  label,
  value,
  sub,
  emptyReason = "Not enough data",
}: {
  label: string;
  value: string | null;
  sub?: string;
  emptyReason?: string;
}) {
  const subId = sub ? `result-row-sub-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-base/40 px-3 py-2">
      <dt className="min-w-0 text-xs text-ink-muted">
        {label}
        {sub && (
          <p id={subId} className="mt-0.5 text-[11px] text-ink-subtle">
            {sub}
          </p>
        )}
      </dt>
      <dd
        className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink"
        aria-describedby={subId}
      >
        {value === null ? (
          <>
            {"--"}
            <span className="sr-only"> {emptyReason}</span>
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
