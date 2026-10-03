/**
 * The projection report: how the projection has done this season.
 *
 * THE HEADING NAMES THE ENGINE. Every figure here grades one projection
 * engine's own published number against what happened, and the caller passes
 * the resolved engine's display name (CLAUDE.md, Projection Engine Source). A
 * card that says one engine's name over another's numbers is a mistake nobody
 * on the page could catch.
 *
 * WHAT A BEAT IS. A player met or beat the number published for him that week.
 * Only weeks he played count, so an injury is not a miss by the projection.
 * The same rule lib/projection-scoreboard.ts grades by.
 *
 * Every bar has its figure printed beside it, and the by-position block is a
 * real table. The bars are decoration on numbers that are already there.
 *
 * Server component.
 */

import { positionNoun } from "@/lib/site";
import type { PositionGrade, ProjectionReport, ReliabilityRow } from "@/lib/season-pulse/types";
import { DiffChip, PlayerAvatar, PlayerName, PositionBadge, TeamTag, signed } from "./bits";

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}

function positionLabel(position: PositionGrade["position"]): string {
  if (position === "ALL") return "Every position";
  const noun = positionNoun(position, "plural");
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function RateBar({ rate }: { rate: number | null }) {
  const width = rate === null ? 0 : Math.round(rate * 100);
  return (
    <span aria-hidden="true" className="relative block h-2.5 w-full overflow-hidden rounded-full bg-ink/10">
      <span
        className="block h-full rounded-full"
        style={{ width: `${width}%`, backgroundImage: "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)" }}
      />
      {/* The halfway mark: a projection that is right on average is beaten half the time. */}
      <span className="absolute inset-y-0 left-1/2 w-px bg-ink/40" />
    </span>
  );
}

function ReliabilityList({
  id,
  title,
  blurb,
  rows,
  empty,
}: {
  id: string;
  title: string;
  blurb: string;
  rows: ReliabilityRow[];
  empty: string;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-line bg-base/40 p-4">
      <h3 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{blurb}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ol role="list" className="mt-1 divide-y divide-line/60">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-2.5">
              <span className="mt-1.5">
                <PlayerAvatar position={r.position} sleeperId={r.sleeperId} team={r.team} size={36} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2">
                  <PlayerName slug={r.slug} name={r.name} />
                  <PositionBadge position={r.position} size="sm" />
                </p>
                <p className="-mt-1.5 text-xs">
                  <TeamTag team={r.team} size={14} />
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-bold tabular-nums text-ink">
                  {r.beats} of {r.graded}
                  <span className="sr-only"> weeks beat</span>
                </p>
                <p className="mt-0.5 text-[11px] text-ink-subtle">Projected {r.averageProjected.toFixed(1)} a week</p>
                <p className="mt-0.5">
                  <DiffChip value={r.averageDiff} context="a week against the projection, on average" />
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ProjectionReportPanel({
  report,
  scoringLabel,
  idPrefix,
}: {
  report: ProjectionReport;
  scoringLabel: string;
  idPrefix: string;
}) {
  const pooled = report.season.find((s) => s.position === "ALL") ?? null;
  const positions = report.season.filter((s) => s.position !== "ALL" && s.graded > 0);
  const bestWeek = [...report.byWeek].sort((a, b) => (b.beatRate ?? 0) - (a.beatRate ?? 0))[0];

  return (
    <div className="space-y-4">
      {pooled && pooled.beatRate !== null && (
        <p className="text-sm leading-relaxed text-ink-muted">
          Across {pooled.graded.toLocaleString("en-US")} player weeks this season, players met or beat their{" "}
          {report.sourceName} projection <strong className="font-semibold text-ink">{percent(pooled.beatRate)}</strong> of
          the time. The average miss was {pooled.averageMiss?.toFixed(1)} points, and the projection ran{" "}
          {pooled.lean === null || pooled.lean === 0
            ? "level"
            : pooled.lean > 0
              ? `${pooled.lean.toFixed(1)} points low`
              : `${Math.abs(pooled.lean).toFixed(1)} points high`}{" "}
          on average. {scoringLabel} scoring.
        </p>
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div
          role="region"
          aria-label={`${report.sourceName} projection accuracy by position`}
          tabIndex={0}
          className="beacon-scroll overflow-x-auto rounded-2xl border border-line bg-base/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <table className="w-full min-w-[26rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              {`How the ${report.sourceName} projection has done by position this season. Beat rate is the share of weeks a player met or beat his projection. Average miss is how far off it was either way. Lean is positive when players outscored it.`}
            </caption>
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Position
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Beat rate
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Average miss
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Lean
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Weeks graded
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {positions.map((g) => (
                <tr key={g.position}>
                  <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left text-sm font-medium text-ink">
                    {positionLabel(g.position)}
                  </th>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className="w-10 shrink-0 font-mono text-sm font-bold tabular-nums text-ink">
                        {percent(g.beatRate)}
                      </span>
                      <span className="min-w-[5rem] flex-1">
                        <RateBar rate={g.beatRate} />
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-muted">
                    {g.averageMiss === null ? "n/a" : g.averageMiss.toFixed(1)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-muted">
                    {g.lean === null ? "n/a" : signed(g.lean)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-muted">{g.graded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section aria-labelledby={`${idPrefix}-weeks`} className="rounded-2xl border border-line bg-base/40 p-4">
          <h3 id={`${idPrefix}-weeks`} className="text-sm font-semibold text-ink">
            Beat rate by week
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {bestWeek && report.byWeek.length > 1
              ? `Week ${bestWeek.week} was the kindest to the projection so far, at ${percent(bestWeek.beatRate)}.`
              : "One bar for each week played."}
          </p>
          <ol role="list" className="mt-4 flex items-end gap-2">
            {report.byWeek.map((w) => (
              <li key={w.week} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="font-mono text-xs font-semibold tabular-nums text-ink">{percent(w.beatRate)}</span>
                <span aria-hidden="true" className="flex h-24 w-full max-w-[2.75rem] items-end rounded-md bg-ink/[0.06]">
                  <span
                    className="block w-full rounded-md bg-beacon"
                    style={{ height: `${Math.max(4, Math.round((w.beatRate ?? 0) * 100))}%` }}
                  />
                </span>
                <span className="text-[11px] text-ink-subtle">
                  <span className="sr-only">in </span>Week {w.week}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <ReliabilityList
          id={`${idPrefix}-reliable`}
          title="Beat it most often"
          blurb="Players projected for at least 6 points a week, with two or more graded weeks."
          rows={report.mostReliable}
          empty="Not enough graded weeks yet."
        />
        <ReliabilityList
          id={`${idPrefix}-unreliable`}
          title="Fell short most often"
          blurb="Players projected for at least 8 points a week, with two or more graded weeks."
          rows={report.leastReliable}
          empty="Not enough graded weeks yet."
        />
      </div>
    </div>
  );
}
