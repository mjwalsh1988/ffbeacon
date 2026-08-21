import { CalendarClock, CalendarOff, TriangleAlert, UserMinus } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "@/components/dashboard-panel";
import { listWords } from "./format";

/**
 * The four ways this page can have nothing to show, each named.
 *
 * Server component. Written in the voice of
 * components/power-pulse/pre-draft-notice.tsx: say what is missing, say WHY it
 * is missing, and say what makes it appear. A blank panel and the word "empty"
 * tells a manager their league is broken. Naming the cause tells them whether
 * to wait, to check Sleeper, or to reload.
 *
 * THE MISSING WEEKS CASE IS THE ONE THAT MATTERS MOST
 *   A partial slate looks exactly like a complete one, and every conclusion
 *   drawn from its shape (who plays whom twice, which stretch is hardest, who
 *   has the easy run home) is wrong in a way nobody can see. So the weeks are
 *   named and the panel says outright that nothing may be concluded until they
 *   load, which is the same rule Power Pulse follows when it refuses to score a
 *   league whose fetch failed.
 */

export function ScheduleEmpty({
  kind,
  season,
  missingWeeks = [],
}: {
  kind: "no-schedule" | "no-projections" | "missing-weeks" | "unpaired";
  season: number | null;
  /** Only read for the "missing-weeks" case. Named in the copy, never counted. */
  missingWeeks?: number[];
}) {
  const seasonLabel = season === null ? "this season" : String(season);

  if (kind === "no-schedule") {
    return (
      <EmptyPanel
        eyebrow="Schedule"
        title="No schedule published yet"
        helper={`Sleeper has no games on file for ${seasonLabel}.`}
        icon={<CalendarOff aria-hidden="true" className="h-5 w-5" />}
      >
        <p>
          Sleeper publishes a whole season the moment a league is created for it, all
          eighteen weeks at once, which is why an empty slate almost never means "not yet
          scheduled". It means this league has not been created for {seasonLabel} yet.
        </p>
        <p>
          Once the commissioner rolls the league over, every week appears together and this
          page fills in on the next load.
        </p>
      </EmptyPanel>
    );
  }

  if (kind === "no-projections") {
    return (
      <EmptyPanel
        eyebrow="Schedule"
        title="Projections are still calculating"
        helper="Opponents, records and final scores are here. The forward-looking numbers are not."
        icon={<CalendarClock aria-hidden="true" className="h-5 w-5" />}
      >
        <p>
          The schedule itself comes straight from Sleeper, so who plays whom and what has
          already been scored are both accurate. Projected totals, win probability and
          strength of schedule come from Power Pulse, and it has not produced a row for this
          league yet.
        </p>
        <p>
          Power Pulse needs a drafted roster and a published slate before it will score
          anything, and it refuses to score a week it could not fetch rather than guess.
          Reload after the next sync and the projections appear alongside what is already
          here.
        </p>
      </EmptyPanel>
    );
  }

  if (kind === "missing-weeks") {
    const weeks = listWords(missingWeeks);
    const plural = missingWeeks.length === 1 ? "week" : "weeks";
    return (
      <EmptyPanel
        eyebrow="Schedule"
        title="The slate is incomplete"
        helper={
          missingWeeks.length === 0
            ? "Some weeks did not come back from Sleeper."
            : `Sleeper did not answer for ${plural} ${weeks}.`
        }
        icon={<TriangleAlert aria-hidden="true" className="h-5 w-5" />}
      >
        <p>
          {missingWeeks.length === 0
            ? "At least one week did not come back from Sleeper, so what is below is a partial schedule."
            : `Nothing came back for ${plural} ${weeks}, so what is below is a partial schedule rather than the whole one.`}
        </p>
        <p>
          Nothing about its shape can be concluded until those weeks load: who a team plays
          twice, which stretch is hardest, and how the run into the playoffs looks all
          depend on the games that are missing. A failed fetch is not evidence about a
          league, so this page shows what it has and says what it does not.
        </p>
      </EmptyPanel>
    );
  }

  return (
    <EmptyPanel
      eyebrow="Schedule"
      title="No opponent this week"
      helper="This roster is unpaired, so there is no matchup to open."
      icon={<UserMinus aria-hidden="true" className="h-5 w-5" />}
    >
      <p>
        Sleeper leaves a roster unpaired when a league has an odd number of teams, and it
        leaves the pairing key empty when it does. One team sits out each week as a result,
        and this is that week for this team.
      </p>
      <p>
        Every other week on this schedule is unaffected. Pick another week from the control
        bar above, or switch to the week view to see the games that are being played.
      </p>
    </EmptyPanel>
  );
}

/**
 * The shared shell. An icon that is paired with a heading rather than standing
 * in for one, so nothing here depends on recognising a glyph.
 */
function EmptyPanel({
  eyebrow,
  title,
  helper,
  icon,
  children,
}: {
  eyebrow: string;
  title: string;
  helper: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel eyebrow={eyebrow} title={title} helper={helper}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed text-ink-muted">
          {children}
        </div>
      </div>
    </Panel>
  );
}
