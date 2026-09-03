/**
 * How the week actually went: the result, whether the bench cost it, and which
 * players were responsible.
 *
 * THE ONE SENTENCE THIS PAGE EXISTS TO SAY, on a settled week, is "you lost a
 * game your own bench would have won". It is a claim about a real game that a
 * reader can check against the schedule one row at a time, and it is the same
 * quantity the Manager Ledger counts across a season as `winsLeftOnBench`. It
 * gets the loudest treatment on the page when it is true, and nothing at all
 * when it is not: a page that says "your bench would not have changed anything"
 * in the same size type has buried the finding.
 *
 * THE COMPARISON IS ONE-SIDED, exactly as the ledger's is. The opponent scored
 * what they scored and their bench is left alone, because a reader cannot set
 * their opponent's lineup.
 *
 * WHO CAME THROUGH AND WHO DID NOT is measured against each player's own
 * projection, not against his position or the league. A running back who was
 * projected for 6 and scored 14 had a better day than one projected for 18 who
 * scored 19, and ranking them by raw points would say the opposite.
 *
 * NOTHING HERE IS ADVICE. It is a report on a week that has finished, so there
 * are no verbs: no "should have", no "start him next week". The players who
 * missed are named because a manager wants to know, not because the page has a
 * view about what to do with them.
 *
 * Server component. Presentational only.
 */

import { ArrowDownRight, ArrowUpRight, Flame, Trophy, XCircle, MinusCircle } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { PlayerHeadshot } from "@/components/player-headshot";
import { fmtPoints, fmtSigned } from "@/components/league-schedule/format";
import type { PlayerSwing, WeekRecap } from "@/lib/league-lineups/recap";
import type { LineupOpponent } from "@/lib/league-lineups/types";

/** The result, as a badge and a sentence. Null outcomes are a real state. */
function resultTone(outcome: WeekRecap["outcome"]): {
  label: string;
  icon: React.ReactNode;
  chip: string;
} {
  if (outcome === "win") {
    return {
      label: "Won",
      icon: <Trophy aria-hidden="true" className="h-4 w-4" />,
      chip: "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan",
    };
  }
  if (outcome === "loss") {
    return {
      label: "Lost",
      icon: <XCircle aria-hidden="true" className="h-4 w-4" />,
      chip: "border-brand-purple/50 bg-brand-purple/10 text-brand-purple",
    };
  }
  return {
    label: "Tied",
    icon: <MinusCircle aria-hidden="true" className="h-4 w-4" />,
    chip: "border-line-accent bg-base/60 text-ink-muted",
  };
}

export function WeekRecapPanel({
  recap,
  opponent,
  week,
  decisionsHref,
}: {
  recap: WeekRecap;
  opponent: LineupOpponent | null;
  week: number;
  /** Where the season-long version of this lives. */
  decisionsHref: string;
}) {
  const hasResult = recap.outcome !== null && opponent !== null;
  const tone = resultTone(recap.outcome);

  return (
    <Panel
      id="lineup-recap"
      eyebrow="The result"
      title={`How week ${week} went`}
      helper="What your lineup did, measured against what each player was projected for."
      headingLevel={2}
      glow
    >
      {/* THE SCORELINE. The two totals side by side, because a result is a
          comparison and printing one number would make a reader hunt for the
          other. */}
      {hasResult ? (
        <div className="rounded-card border border-line bg-base/50 px-4 py-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${tone.chip}`}
            >
              {tone.icon}
              {tone.label}
            </span>
            <span className="font-mono text-2xl font-extrabold tabular-nums text-ink sm:text-3xl">
              {fmtPoints(recap.scored ?? 0)}
              <span className="sr-only"> points, your team,</span>
            </span>
            {/* NOT aria-hidden. It is visible text, and hiding it sends a
                pointer landing on it back to the whole paragraph. It also reads
                correctly between the two sr-only clauses. */}
            <span className="text-sm text-ink-subtle">to</span>
            <span className="font-mono text-2xl font-bold tabular-nums text-ink-muted sm:text-3xl">
              {fmtPoints(opponent.actual ?? 0)}
              <span className="sr-only"> points, {opponent.teamName}</span>
            </span>
          </p>
          {/* A SENTENCE, and the opponent named once. The line above already
              says who they are, so repeating the name here left a fragment
              ("against Team B, by 17.8 points") standing on its own. */}
          <p className="mt-1 text-xs text-ink-muted">
            {recap.margin === null
              ? `Played ${opponent.teamName}.`
              : `You ${recap.outcome === "win" ? "beat" : recap.outcome === "loss" ? "lost to" : "tied"} ${opponent.teamName} by ${fmtPoints(Math.abs(recap.margin))} ${Math.abs(recap.margin) === 1 ? "point" : "points"}.`}
          </p>
        </div>
      ) : (
        <p className="rounded-card border border-line bg-base/50 px-4 py-3 text-sm leading-relaxed text-ink-muted">
          {recap.scored === null
            ? "This week has not settled, so there is no final score yet."
            : `You scored ${fmtPoints(recap.scored)}. Sleeper published no opponent for this week, so there is no result to report.`}
        </p>
      )}

      {/* THE FINDING, and it only appears when there is one. */}
      {recap.costTheGame && (
        <div
          className="mt-3 flex items-start gap-3 rounded-card border border-brand-purple/50 px-4 py-3"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.18) 0%, transparent 65%)",
          }}
        >
          <Flame aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-purple" />
          <p className="text-sm leading-relaxed text-ink">
            <span className="font-bold">Your bench would have won this game.</span>{" "}
            <span className="text-ink-muted">
              The best legal lineup out of the same players scored{" "}
              {fmtPoints(recap.bestPossible ?? 0)}, against their{" "}
              {fmtPoints(opponent?.actual ?? 0)}. Their lineup is left exactly as they set
              it: this is a comparison you could have controlled.
            </span>
          </p>
        </div>
      )}

      {recap.outcome === "loss" && !recap.costTheGame && recap.bestPossible !== null && (
        <p className="mt-3 rounded-card border border-line bg-base/40 px-4 py-3 text-sm leading-relaxed text-ink-muted">
          Your best possible lineup scored {fmtPoints(recap.bestPossible)}, which still would
          not have caught {opponent?.teamName ?? "your opponent"}. This one was not about the
          lineup.
        </p>
      )}

      {/* WHO DID IT. Two lists, and each names a player against his own number. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SwingList
          title="Came through"
          empty="Nobody beat their projection by more than a couple of points."
          tone="up"
          swings={recap.overperformers}
        />
        <SwingList
          title="Let you down"
          empty="Nobody missed their projection by more than a couple of points."
          tone="down"
          swings={recap.underperformers}
        />
      </div>

      {recap.measuredCount > 0 && (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          {recap.beatCount} of your {recap.measuredCount} measurable starters beat the number
          they were projected for.{" "}
          <a
            href={decisionsHref}
            className="font-semibold text-brand-cyan underline-offset-2 transition-colors hover:text-brand-purple hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            See every manager&apos;s season on the Decisions page
          </a>
          .
        </p>
      )}
    </Panel>
  );
}

function SwingList({
  title,
  empty,
  tone,
  swings,
}: {
  title: string;
  empty: string;
  tone: "up" | "down";
  swings: PlayerSwing[];
}) {
  const headingId = `swing-${tone}`;
  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        {tone === "up" ? (
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
        ) : (
          <ArrowDownRight aria-hidden="true" className="h-3.5 w-3.5 text-signal-warning" />
        )}
        {title}
      </h3>
      {swings.length === 0 ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">{empty}</p>
      ) : (
        <ul role="list" className="mt-1.5 space-y-1.5">
          {swings.map((swing) => (
            <li
              key={swing.player.sleeperId}
              className="flex items-center gap-2.5 rounded-card border border-line bg-base/50 px-3 py-2"
            >
              <span aria-hidden="true" className="shrink-0">
                <PlayerHeadshot sleeperId={swing.player.sleeperId} name="" size={28} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">
                  {swing.player.name}
                </span>
                <span className="block truncate font-mono text-[11px] tabular-nums text-ink-muted">
                  {fmtPoints(swing.actual)}
                  <span className="sr-only"> points scored,</span>
                  <span aria-hidden="true"> from </span>
                  {fmtPoints(swing.projected)}
                  <span aria-hidden="true"> proj</span>
                  <span className="sr-only"> projected</span>
                </span>
              </span>
              <span
                className={`shrink-0 font-mono text-sm font-extrabold tabular-nums ${
                  tone === "up" ? "text-brand-cyan" : "text-signal-warning"
                }`}
              >
                {fmtSigned(swing.diff)}
                <span className="sr-only">
                  {" "}
                  points {tone === "up" ? "above" : "below"} his projection
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
