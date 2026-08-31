"use client";

/**
 * What the "who to pick" view becomes once there is nobody left to pick.
 *
 * THE PROBLEM
 * The recommendation surface kept rendering after the last pick: two spotlight
 * cards reasoning about a board with nothing on it, under a heading that says
 * "Who to pick right now". It reads as broken, and it leaves the reader at a
 * dead end at the exact moment they are most engaged with their team.
 *
 * WHAT IT DOES INSTEAD
 * Reports the draft, then hands the reader to League Pulse. That handoff is the
 * point of the screen, not decoration on it: the roster they just spent two
 * hours building becomes a real team the moment the draft locks, and League
 * Pulse is where that team lives all season. A drafter who closes this tab and
 * never comes back was ours to keep.
 *
 * EVERY NUMBER HERE IS ALREADY COMPUTED. The grade, the rank, the Draft Pulse
 * score, the best and worst pick all come from the props the cockpit already
 * holds. Nothing here fetches, and nothing here recomputes: a completed draft is
 * frozen by design (lib/on-the-clock/draft-snapshot.ts) and this must not be the
 * thing that thaws it.
 */

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Repeat,
  Trophy,
  TrendingUp,
} from "lucide-react";
import type { DraftGrade } from "@/lib/on-the-clock/draft-grade";
import type { DraftPulseTeam } from "@/lib/on-the-clock/draft-pulse";

/** The views this screen links out to. Must exist in the cockpit's VIEWS list. */
export type DraftCompleteView = "grades" | "rankings" | "rosters" | "history";

export interface DraftCompleteProps {
  leagueName: string;
  season: number | string;
  /** Sleeper league id, for the League Pulse links. */
  sleeperLeagueId: string | null;
  /** The reader's own grade, when we know which roster is theirs. */
  myGrade: DraftGrade | null;
  /** The reader's own Draft Pulse row. */
  myPulse: DraftPulseTeam | null;
  /** How many teams were in the room, for the rank sentences. */
  teamCount: number;
  /**
   * Move the cockpit to another view. Typed as the cockpit's own View union via
   * the caller rather than redeclared here, so a renamed view is a compile
   * error instead of a dead button.
   */
  onGoToView: (view: DraftCompleteView) => void;
  /**
   * How many of the reader's players have picked up a new injury designation
   * since the draft locked. Null when we cannot tell, which is not zero.
   */
  changedSinceDraft: number | null;
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** One headline figure. Reads as a sentence to a screen reader, not a fragment. */
function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string | null;
}) {
  return (
    <div className="rounded-card border border-line bg-surface/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</p>
      ) : null}
    </div>
  );
}

export function DraftComplete({
  leagueName,
  season,
  sleeperLeagueId,
  myGrade,
  myPulse,
  teamCount,
  onGoToView,
  changedSinceDraft,
}: DraftCompleteProps) {
  const leagueHref = sleeperLeagueId ? `/leagues/${sleeperLeagueId}` : null;

  return (
    <section aria-labelledby="otc-draft-complete-title" className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          That is a wrap
        </p>
        <h2
          id="otc-draft-complete-title"
          className="mt-2 text-xl font-bold tracking-tight text-ink sm:text-2xl"
        >
          Your draft is complete
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {leagueName}, {season}. There is nobody left to pick, so here is how
          it went.
        </p>
      </div>

      {/* The three figures a drafter wants first. Anything we do not know is
          left out rather than shown as a dash: a missing grade means the room
          could not be graded, and an em dash would imply a zero. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {myGrade ? (
          <Tile
            label="Your grade"
            value={myGrade.letter}
            detail={`${ordinal(myGrade.rank)} of ${teamCount} in the room.`}
          />
        ) : null}
        {myPulse ? (
          <Tile
            label="Your lineup"
            value={`${myPulse.meanStartingPoints.toFixed(1)} a week`}
            detail={`${ordinal(myPulse.rank)} by projected starting points.`}
          />
        ) : null}
        {myGrade?.bestPick ? (
          <Tile
            label="Your best pick"
            value={myGrade.bestPick.playerName}
            detail={`Taken at ${myGrade.bestPick.pickNo}, ahead of what the market said that slot was worth.`}
          />
        ) : null}
      </div>

      {myGrade?.review ? (
        <p className="rounded-card border border-line bg-base/50 p-4 text-sm leading-relaxed text-ink-muted">
          {myGrade.review}
        </p>
      ) : null}

      {/* The links out, as real cards rather than a row of tabs nobody presses.
          Grades first: it is the thing the reader came back for. */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink-subtle">
          Look back at the draft
        </h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                view: "grades",
                label: "Full grades",
                detail: "Every team, every component.",
                Icon: BarChart3,
              },
              {
                view: "rankings",
                label: "Awards",
                detail: "Who won what in the room.",
                Icon: Trophy,
              },
              {
                view: "rosters",
                label: "Rosters",
                detail: "The whole league, side by side.",
                Icon: TrendingUp,
              },
              {
                view: "history",
                label: "Trade history",
                detail: "Every deal that changed hands.",
                Icon: Repeat,
              },
            ] as const
          ).map(({ view, label, detail, Icon }) => (
            <button
              key={view}
              type="button"
              onClick={() => onGoToView(view)}
              className="flex min-h-11 items-center gap-3 rounded-card border border-line bg-surface/60 px-4 py-3 text-left transition-colors hover:border-brand-cyan/50 hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <Icon
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-brand-cyan"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  {label}
                </span>
                <span className="block text-xs text-ink-muted">{detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* THE HANDOFF. The reason this screen exists. */}
      {leagueHref ? (
        <div className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/50 p-5">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.14) 0%, transparent 62%)",
            }}
          />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              What happens next
            </p>
            <h3 className="mt-2 text-lg font-bold tracking-tight text-ink">
              Your draft board just became a season
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              League Pulse picks up where this leaves off. It reads the same
              projections you drafted against and follows your team every week.
            </p>

            <ul
              role="list"
              className="mt-4 grid gap-2 text-sm text-ink-muted sm:grid-cols-2"
            >
              {[
                "Projected record, playoff odds and a title chance for every team",
                "Which positions are worth spending on in your league, not in general",
                "Trades graded on wins and on value, because they disagree",
                "A weekly board that says who to start and what it costs you to be wrong",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {/* Says what changed since the draft, when we can tell. This is the
                sentence that earns the click: a reader who knows one of their
                players is now on IR has a reason to open the page today rather
                than in September. */}
            {changedSinceDraft !== null && changedSinceDraft > 0 ? (
              <p className="mt-4 flex items-start gap-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 p-3 text-sm text-ink">
                <CalendarDays
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  {changedSinceDraft} of your players{" "}
                  {changedSinceDraft === 1 ? "has" : "have"} a new injury
                  designation since you drafted. League Pulse already accounts
                  for it.
                </span>
              </p>
            ) : null}

            <Link
              href={leagueHref}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-card border border-brand-cyan/60 bg-brand-cyan/10 px-4 py-2.5 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Open {leagueName} in League Pulse
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
