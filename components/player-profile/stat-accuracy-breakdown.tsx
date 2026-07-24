/**
 * Season per-stat accuracy breakdown: a compact grid of tiles, one per component
 * stat (rushing yards, receptions, passing TDs, ...), each showing how often the
 * player met or beat that stat's weekly projection this season and the average
 * differential. Styled like the projection hero tiles (near-black, big mono
 * numbers) so it drops cleanly under the accuracy point cards in both the
 * projections zone and the weekly game log. Pure and presentational: the caller
 * precomputes the StatAccuracy rows on the server, so no client work happens here
 * beyond rendering.
 *
 * Reading it in plain terms: the big percentage is "how often he hit the mark";
 * the green/red number is "on average, by how much he was over or under". A single
 * helper line spells this out so the grid needs no per-tile prose.
 */

import type { StatAccuracy } from "@/components/player-profile/stat-shaping";
import { fmtStatDelta, deltaTone } from "@/components/player-profile/stat-shaping";

/** Near-black tile so the bright numbers stand out (matches the hero cards). */
const TILE = "#0A0A12";

const TONE_CLASS = {
  good: "text-signal-success",
  bad: "text-signal-danger",
  neutral: "text-ink-muted",
} as const;

export function StatAccuracyBreakdown({
  stats,
  heading = "Per-stat accuracy",
  caption,
}: {
  stats: StatAccuracy[];
  /** Small heading above the grid. */
  heading?: string;
  /** Optional one-line, plain-language explainer. Falls back to a default. */
  caption?: string;
}) {
  if (stats.length === 0) return null;
  const help =
    caption ??
    "How often each stat landed at or above its weekly projection, and the average difference per game.";

  return (
    <section aria-label={heading} className="mt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-purple">
          {heading}
        </h4>
        <p className="text-[10px] leading-tight text-ink-subtle">{help}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((s) => {
          const avg = fmtStatDelta(s.avgDiff, s.digits);
          const tone = deltaTone(s.avgDiff, s.digits, s.lowerIsBetter);
          return (
            <div
              key={s.key}
              className="rounded-card border border-line px-3 py-2.5"
              style={{ backgroundColor: TILE }}
            >
              <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                {s.label}
              </dt>
              <dd className="mt-0.5">
                <span className="font-mono text-xl font-bold tabular-nums text-brand-cyan">
                  {s.beatPct}%
                </span>
                <span className="ml-1 text-[10px] text-ink-subtle">hit rate</span>
              </dd>
              {/* Two clearly separate lines: the fraction explains the percentage,
                  the average gap is its own labeled, colored value. Keeping them on
                  different lines stops "0 avg, 7 of 17" from reading as "0 of 7". */}
              <p className="mt-1 text-[10px] leading-tight text-ink-subtle">
                over in {s.beats} of {s.total} weeks
              </p>
              <p className="text-[10px] leading-tight text-ink-subtle">
                avg gap{" "}
                <span className={`font-mono font-semibold tabular-nums ${TONE_CLASS[tone]}`}>
                  {avg}
                </span>
              </p>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
