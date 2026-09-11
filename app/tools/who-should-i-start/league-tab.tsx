/**
 * The "Your lineup" tab (formerly "Your league").
 *
 * This answers the only question a generic comparison structurally cannot: what
 * each of these two-to-eight players would actually do to THIS roster, over the
 * weeks this reader has left, under the rules this league actually plays.
 *
 * The headline is points added to the optimal starting lineup per week, after
 * whatever cut making room would require. That number can be zero for a player
 * everybody agrees is excellent, and when it is, the tab says so in words rather
 * than dressing it up as a small positive. The headline's actual WORDING
 * decision lives in league-tab-headline.ts as plain data, so it can be unit
 * tested without a DOM; this file only turns that decision into JSX.
 *
 * N equals 2 is not a special case anywhere else in this file: every other
 * function below takes the full `sides` list and the two-player behaviour
 * falls out of that list happening to have two entries.
 */

import { ShieldCheck, Trophy, Users } from "lucide-react";
import type { LeagueImpactReport } from "@/lib/breakdown/league-impact";
import { ChartEmpty, ChartFigure, DataTable, Td, Th } from "@/components/chart-kit";
import {
  describeLeagueTabHeadline,
  isMeasured,
  listNames,
  type MeasuredSide,
  type Side,
} from "./league-tab-headline";

export type { Side } from "./league-tab-headline";

function pct(v: number | null | undefined, digits = 1): string {
  return v == null ? "-" : `${(v * 100).toFixed(digits)}%`;
}

function signed(v: number | null | undefined, digits = 1): string {
  if (v == null) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

export function LeagueTab({
  sides,
  report,
}: {
  sides: Side[];
  report: LeagueImpactReport;
}) {
  const measured = sides.filter(isMeasured);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl">
          <Users aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          Where each one fits on {report.team.name}
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          {report.league.name}, {report.league.season}. Weeks {report.league.currentWeek} through{" "}
          {report.league.lastRegularWeek}, scored as {report.league.scoringDescription}.
        </p>
      </div>

      {report.notices.length > 0 && (
        <ul role="list" className="space-y-2">
          {report.notices.map((notice) => (
            <li
              key={notice}
              className="rounded-card border border-dashed border-line bg-surface/60 px-3 py-2 text-xs leading-relaxed text-ink-muted"
            >
              {notice}
            </li>
          ))}
        </ul>
      )}

      {measured.length === 0 ? (
        <ChartEmpty>
          We could not measure any of these players against this roster. That happens when we
          hold no weekly projections for them from here on.
        </ChartEmpty>
      ) : (
        <>
          <Headline sides={sides} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sides.map((side) => (
              <ImpactCard key={side.player.slug} side={side} measured={measured} />
            ))}
          </div>

          <WeeklyStartGrid sides={sides} />
        </>
      )}

      <p className="text-xs leading-relaxed text-ink-subtle">
        Nothing here is written to your league. We build your best possible lineup for every
        remaining week without the player, build it again with that player, and take the difference. It
        is the same calculation the FAAB calculator prices a bid from.
      </p>
    </div>
  );
}

/** The one or two sentences the whole tab exists to produce. */
function Headline({ sides }: { sides: Side[] }) {
  const plan = describeLeagueTabHeadline(sides);

  switch (plan.kind) {
    case "empty":
      return null;

    case "single":
      return (
        <p className="rounded-modal border border-line bg-surface/60 p-4 text-sm leading-relaxed text-ink">
          {plan.name} adds {signed(plan.net)} points a week to your starting lineup, starting for
          you in {plan.weeksStarting} of {plan.weeksConsidered} weeks.
        </p>
      );

    case "all-bench":
      return (
        <div className="rounded-modal border border-line bg-surface/60 p-4 sm:p-5">
          <p className="text-sm leading-relaxed text-ink sm:text-base">
            {plan.pairwise ? (
              <>
                Neither {listNames(plan.names)} cracks your starting lineup in any remaining
                week. On this roster they are both insurance rather than an upgrade.
              </>
            ) : (
              <>
                None of {listNames(plan.names)} cracks your starting lineup in any remaining
                week. On this roster they are all insurance rather than an upgrade.
              </>
            )}
          </p>
        </div>
      );

    case "pair-even":
      return (
        <div className="rounded-modal border border-line bg-surface/60 p-4 sm:p-5">
          <p className="text-sm leading-relaxed text-ink sm:text-base">
            For your lineup they are effectively the same player: {signed(plan.leaderNet)}{" "}
            against {signed(plan.trailerNet)} points a week. Decide it on the rest of the
            breakdown.
          </p>
        </div>
      );

    case "pair-lead":
      return (
        <div className="rounded-modal border border-line bg-surface/60 p-4 sm:p-5">
          <p className="text-sm leading-relaxed text-ink sm:text-base">
            <span className="font-semibold">{plan.leaderName}</span> is worth{" "}
            {plan.gap.toFixed(1)} more points a week to this roster: {signed(plan.leaderNet)}{" "}
            against {plan.trailerName} at {signed(plan.trailerNet)}. That player starts for you in{" "}
            {plan.leaderWeeksStarting} of {plan.leaderWeeksConsidered} weeks, {plan.trailerName}{" "}
            in {plan.trailerWeeksStarting}.
          </p>
        </div>
      );

    case "group-even":
      return (
        <div className="rounded-modal border border-line bg-surface/60 p-4 sm:p-5">
          <p className="text-sm leading-relaxed text-ink sm:text-base">
            The top of this group is effectively even:{" "}
            <span className="font-semibold">{plan.leaderName}</span> and {plan.secondName} are
            both worth about {signed(plan.net)} points a week to this roster. Decide between them
            on the rest of the breakdown.
          </p>
        </div>
      );

    case "group-lead":
      return (
        <div className="rounded-modal border border-line bg-surface/60 p-4 sm:p-5">
          <p className="text-sm leading-relaxed text-ink sm:text-base">
            <span className="font-semibold">{plan.leaderName}</span> is worth the most to this
            roster, {signed(plan.leaderNet)} points a week, starting for you in{" "}
            {plan.leaderWeeksStarting} of {plan.leaderWeeksConsidered} weeks. {plan.secondName} is
            next at {signed(plan.secondNet)}.
          </p>
        </div>
      );

    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

function ImpactCard({ side, measured }: { side: Side; measured: MeasuredSide[] }) {
  const { player, impact } = side;

  if (!impact) {
    return (
      <section
        aria-label={`${player.name} league impact`}
        className="rounded-card border border-line bg-base/40 p-4"
      >
        <p className="text-sm font-semibold text-ink">{player.name}</p>
        <p className="mt-2 text-sm text-ink-muted">
          No weekly projections on file from here on, so we cannot place that player in your lineup.
        </p>
      </section>
    );
  }

  const bestNet = Math.max(...measured.map((s) => s.impact.netPointsPerWeek));
  const isBest = measured.length > 1 && Math.abs(impact.netPointsPerWeek - bestNet) < 0.05;

  const oddsDelta =
    impact.playoffOddsBefore != null && impact.playoffOddsAfter != null
      ? (impact.playoffOddsAfter - impact.playoffOddsBefore) * 100
      : null;

  return (
    <section
      aria-label={`${player.name} league impact`}
      className={`rounded-card border p-4 ${isBest ? "border-brand-cyan/40" : "border-line"} bg-base/40`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={`text-sm font-semibold ${isBest ? "text-brand-cyan" : "text-ink"}`}>
          {player.name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {isBest && (
            <span className="rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
              Best fit
            </span>
          )}
          {impact.onYourRoster && (
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              On your roster
            </span>
          )}
          {!impact.onYourRoster && impact.rosteredBy && (
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-muted">
              Rostered by {impact.rosteredBy}
            </span>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Stat
          label={impact.onYourRoster ? "Worth to your lineup" : "Adds to your lineup"}
          value={`${signed(impact.netPointsPerWeek)}/wk`}
          tone={impact.netPointsPerWeek > 0.1 ? "good" : undefined}
        />
        <Stat
          label="Weeks started"
          value={`${impact.weeksStarting} of ${impact.weeksConsidered}`}
        />
        <Stat
          label="In weeks started"
          value={`${signed(impact.pointsPerStartedWeek)}/wk`}
        />
        <Stat
          label="Playoff odds"
          value={
            impact.playoffOddsAfter != null
              ? pct(impact.playoffOddsAfter)
              : "no schedule"
          }
          hint={oddsDelta != null ? `${signed(oddsDelta)} points` : undefined}
          tone={oddsDelta == null ? undefined : oddsDelta >= 0 ? "good" : "bad"}
        />
      </dl>

      {impact.isBenchOnly && (
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
          This player never cracks your starting lineup in a remaining week. That makes this player depth, not an
          upgrade.
        </p>
      )}

      {impact.dropName && (
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
          Room made by cutting {impact.dropName}, which costs you{" "}
          {impact.dropCostPerWeek != null ? impact.dropCostPerWeek.toFixed(1) : "0.0"} points a
          week.
        </p>
      )}

      {impact.expectedWinsAdded != null && Math.abs(impact.expectedWinsAdded) >= 0.05 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
          <Trophy aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
          Worth about {signed(impact.expectedWinsAdded, 2)} wins across the rest of the season.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-signal-success" : tone === "bad" ? "text-signal-danger" : "text-ink";
  return (
    <div className="rounded-card border border-line/60 bg-surface/40 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${toneClass}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-[10px] tabular-nums text-ink-subtle">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week-by-week: does the player start, and what is added. One row per side. */
/* ------------------------------------------------------------------ */

function WeeklyStartGrid({ sides }: { sides: Side[] }) {
  const rows = sides.filter(
    (s): s is MeasuredSide => s.impact !== null && s.impact.weeks.length > 0,
  );
  if (rows.length === 0) return null;

  const allWeeks = [...new Set(rows.flatMap((s) => s.impact.weeks.map((w) => w.week)))].sort(
    (x, y) => x - y,
  );

  const summary = rows
    .map(
      (s) =>
        `${s.player.name} starts for you in ${s.impact.weeksStarting} of ${s.impact.weeksConsidered} remaining weeks`,
    )
    .join(". ");

  return (
    <ChartFigure
      title="Week by week, would this player be in your lineup?"
      description="A filled cell is a week the player makes your optimal starting lineup, with the points added that week."
      summary={`${summary}.`}
      table={
        <DataTable
          caption="Weekly lineup impact"
          head={
            <>
              <Th>Player</Th>
              <Th>Week</Th>
              <Th>Starts</Th>
              <Th numeric>Points added</Th>
            </>
          }
        >
          {rows.flatMap((s) =>
            s.impact.weeks.map((w) => (
              <tr key={`${s.player.slug}-${w.week}`}>
                <Td>{s.player.name}</Td>
                <Td>{w.week}</Td>
                <Td>{w.startsForYou ? "Yes" : "No"}</Td>
                <Td numeric>{signed(w.pointsAdded)}</Td>
              </tr>
            )),
          )}
        </DataTable>
      }
    >
      <div className="space-y-3">
        {rows.map((s) => {
          const byWeek = new Map(s.impact.weeks.map((w) => [w.week, w]));
          return (
            <div key={s.player.slug}>
              <p className="text-[11px] font-semibold text-ink">{s.player.name}</p>
              {/* Scrolls rather than shrinking, so a full slate stays legible
                  on a phone instead of collapsing into slivers, no matter how
                  many rows are on screen. tabindex="0" because a scroll
                  container with no focusable children cannot be scrolled from
                  the keyboard in Chrome otherwise, which would strand the
                  later weeks (WCAG 2.1.1). */}
              <div
                className="mt-1 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                tabIndex={0}
                role="group"
                aria-label={`${s.player.name} week by week lineup impact, scrollable`}
              >
                <ul role="list" className="flex min-w-max gap-1">
                  {allWeeks.map((week) => {
                    const w = byWeek.get(week);
                    const starts = Boolean(w?.startsForYou);
                    return (
                      <li
                        key={week}
                        className={`flex w-12 shrink-0 flex-col items-center rounded-sm border py-1 text-center ${
                          starts
                            ? "border-brand-cyan/50 bg-brand-cyan/15"
                            : "border-line/60 bg-base/40"
                        }`}
                      >
                        <span className="text-[9px] font-semibold text-ink-subtle">W{week}</span>
                        <span className="text-[10px] font-bold text-ink">
                          {starts ? "Start" : w ? "Bench" : "Bye"}
                        </span>
                        <span className="text-[9px] tabular-nums text-ink-muted">
                          {w ? signed(w.pointsAdded) : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </ChartFigure>
  );
}
