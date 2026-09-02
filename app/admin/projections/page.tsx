import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { formatEastern } from "@/lib/datetime";
import {
  loadProjectionScoreboardCached,
  SCOREBOARD_SCORING_BASES,
  SCOREBOARD_SCORING_LABELS,
  type ProjectionScoreboardRow,
  type ScoreboardScoringBase,
} from "@/lib/projection-scoreboard";

export const metadata: Metadata = { title: "Projections" };
export const dynamic = "force-dynamic";

/** Below this many graded weeks, a figure is flagged as thin evidence rather
 * than silently trusted the same as a well-sampled one. */
const THIN_EVIDENCE_WEEKS = 200;

function isScoring(value: string | undefined): value is ScoreboardScoringBase {
  return (SCOREBOARD_SCORING_BASES as readonly string[]).includes(value ?? "");
}

export default async function ProjectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ scoring?: string }>;
}) {
  await requireAdmin("/admin/projections");

  const { scoring: scoringParam } = await searchParams;
  const scoring: ScoreboardScoringBase = isScoring(scoringParam) ? scoringParam : "pts_ppr";

  const scoreboard = await loadProjectionScoreboardCached(scoring);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
          Values, Rankings, and Sources
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Projection scoreboard
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
          Every projection source we publish, graded against what players
          actually did. This is the evidence behind the phrase &quot;our
          projections&quot;: it is the same table this site would use to decide
          whether FF Beacon&apos;s own projections are ready to turn on.
        </p>
        <p className="mt-2 text-xs text-ink-subtle">
          Figures below are a computed snapshot, last calculated{" "}
          {formatEastern(scoreboard.computedAt)}. They refresh automatically
          after the next stats or projections sync.
        </p>
      </div>

      <section
        aria-labelledby="scoreboard-how-to-read"
        className="rounded-card border border-line bg-surface/60 p-5"
      >
        <h2
          id="scoreboard-how-to-read"
          className="text-lg font-semibold tracking-tight text-ink"
        >
          How to read this
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
          <li>
            <strong className="text-ink">Mean absolute error</strong> is the
            average size of the miss, in fantasy points, ignoring direction.
            Lower is better. A source with a mean absolute error of 4.2 is
            typically off by about 4.2 points a week, whether it was over or
            under.
          </li>
          <li>
            <strong className="text-ink">Mean error</strong> is the bias: the
            average of actual points minus projected points, keeping the sign.
            A number near zero means the source is not systematically wrong in
            either direction. A positive number means the source has been
            sandbagging, players are outscoring it. A negative number means it
            has been optimistic.
          </li>
          <li>
            <strong className="text-ink">Beat rate</strong> is the share of
            graded weeks where the player matched or beat his projection. Fifty
            percent is what a well-calibrated source should land near, not
            zero and not a hundred.
          </li>
          <li>
            <strong className="text-ink">Calibration slope</strong> regresses
            actual points on projected points within a position. A slope of
            1.0 means the source&apos;s spread matches reality. Below 1.0 means
            the source over-spreads: its high projections run too high and its
            low ones too low, which published research says is true of every
            projection source measured so far.
          </li>
          <li>
            <strong className="text-ink">Weeks graded</strong> is the sample
            size every other number on that row is built from. A row built on
            a few dozen weeks is being judged on far less evidence than one
            built on a few thousand, even when the two numbers look equally
            precise. Rows below {THIN_EVIDENCE_WEEKS} graded weeks are marked
            below so a thin row is never read with the same confidence as a
            deep one.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          A week only counts as graded once the game has been played and the
          source published a projection for it. Byes, injuries that kept a
          player off the field, and weeks nobody has played yet are excluded
          from every figure on this page: they are not counted as misses, and
          they do not drag a source down.
        </p>
      </section>

      <nav aria-label="Scoring basis" className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Scoring:
        </span>
        {SCOREBOARD_SCORING_BASES.map((basis) => {
          const active = basis === scoring;
          return (
            <Link
              key={basis}
              href={`/admin/projections?scoring=${basis}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                active
                  ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                  : "border-line bg-surface/60 text-ink-muted hover:border-brand-cyan/30 hover:text-ink"
              }`}
            >
              {SCOREBOARD_SCORING_LABELS[basis]}
            </Link>
          );
        })}
      </nav>

      {scoreboard.sources.length === 0 ? (
        <p className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
          No graded projections yet. This fills in once{" "}
          <code>player_weekly_projections</code> has rows for a season that
          has started playing games.
        </p>
      ) : (
        <div className="space-y-8">
          {scoreboard.seasons.length > 0 ? (
            <p className="text-xs text-ink-subtle">
              Seasons covered: {scoreboard.seasons.join(", ")}.
            </p>
          ) : null}
          {scoreboard.sources.map((source) => (
            <SourceSection
              key={source.source}
              source={source.source}
              pooled={source.pooled}
              byPosition={source.byPosition}
              scoringLabel={SCOREBOARD_SCORING_LABELS[scoring]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceSection({
  source,
  pooled,
  byPosition,
  scoringLabel,
}: {
  source: string;
  pooled: ProjectionScoreboardRow;
  byPosition: ProjectionScoreboardRow[];
  scoringLabel: string;
}) {
  const headingId = `source-${source}-heading`;
  const rows = [pooled, ...byPosition];
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
        {sourceDisplayName(source)}
      </h2>
      <div className="mt-3 overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {sourceDisplayName(source)} projection accuracy, {scoringLabel} scoring, pooled
            across every position and broken out by position
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="px-3 py-2">
                Position
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Weeks graded
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Players
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Mean absolute error
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Mean error (bias)
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Beat rate
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Calibration slope
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ScoreboardRow
                key={row.position}
                row={row}
                emphasize={row.position === "ALL"}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScoreboardRow({
  row,
  emphasize,
}: {
  row: ProjectionScoreboardRow;
  emphasize: boolean;
}) {
  const thin = row.weeksGraded > 0 && row.weeksGraded < THIN_EVIDENCE_WEEKS;
  return (
    <tr
      className={`border-b border-line/60 last:border-b-0 ${
        emphasize ? "bg-surface/40 font-semibold" : ""
      }`}
    >
      <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
        {row.position === "ALL" ? "All positions" : row.position}
      </th>
      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
        {row.weeksGraded.toLocaleString("en-US")}
        {thin ? (
          <span className="ml-1.5 inline-flex items-center rounded-full border border-signal-warning/40 bg-signal-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-signal-warning">
            Thin sample
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
        {row.playersScored.toLocaleString("en-US")}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink">
        {formatSigned(row.meanAbsoluteError, false)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink">
        {formatSigned(row.meanError, true)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink">
        {row.beatRate === null ? "n/a" : `${Math.round(row.beatRate * 1000) / 10}%`}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink">
        {row.calibrationSlope === null ? "not enough games yet" : row.calibrationSlope.toFixed(2)}
      </td>
    </tr>
  );
}

/** Formats a points figure. `signed` prepends a plus for positive values, so
 * the bias column's direction is legible without relying on color alone. */
function formatSigned(value: number | null, signed: boolean): string {
  if (value === null) return "n/a";
  const fixed = value.toFixed(2);
  if (signed && value > 0) return `+${fixed}`;
  return fixed;
}

function sourceDisplayName(source: string): string {
  if (source === "sleeper") return "Sleeper";
  if (source === "ffbeacon") return "FF Beacon";
  return source;
}
