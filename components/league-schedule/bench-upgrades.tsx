import { Repeat } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import type { BenchUpgrade, MatchupSide } from "@/lib/league-schedule/types";
import { BENCH_CHIP_THRESHOLD, CHIP, fmtPoints, fmtSigned } from "./format";

/**
 * What this lineup left behind.
 *
 * Server component. Everything on it is already computed on the MatchupSide;
 * this file decides only what words go around the numbers.
 *
 * WHY THE SWAPS AND THE TOTAL ARE LABELLED SEPARATELY
 *   Each swap is worth what it is worth on its own, against the lineup exactly
 *   as it stands. Take the first one and the second one is worth something
 *   different, because the player it was going to replace is now somewhere else
 *   or gone from the lineup. So the swaps do not sum to the gap, and the panel
 *   says so in a sentence rather than leaving a reader to add four numbers and
 *   find they do not reach the total. The gap comes from the optimal lineup;
 *   the swaps are the route to it.
 *
 * WHY AN EMPTY LIST IS NEVER SHIPPED
 *   A panel with a heading and nothing under it reads as a feature that broke.
 *   "This is the best lineup available this week" is the same finding, stated,
 *   and it is the more useful of the two things this panel can say.
 *
 * WHY A MISSING NUMBER IS NOT A ZERO
 *   pointsLeftOnBench comes back null when there is nothing to project against,
 *   which is not the same as leaving nothing on the bench. Telling a manager
 *   they have a perfect lineup when we simply could not check is worse than
 *   telling them we could not check.
 */

export function BenchUpgrades({
  side,
  isFinal,
  week,
  isViewer = false,
  headingLevel = 2,
}: {
  side: MatchupSide;
  isFinal: boolean;
  /** Lets the retrospective wording name the week. Omitted, it says "this week". */
  week?: number;
  /**
   * True when this side belongs to the reader, which switches the copy to the
   * second person. Default false, so the opponent panel never tells somebody
   * about "your" bench.
   */
  isViewer?: boolean;
  /**
   * Where this panel sits in the page outline. Default 2, because the panel is
   * a peer of the lineup table rather than a part of it, and only the page
   * knows whether it is nested under anything. A hardcoded 3 reads as a
   * subsection of whatever h2 happens to precede it.
   */
  headingLevel?: 2 | 3 | 4;
}) {
  const gap = side.pointsLeftOnBench;
  const hasGap = gap !== null && gap >= BENCH_CHIP_THRESHOLD;
  const upgrades = side.benchUpgrades;
  // A JS string, not JSX text, so the apostrophe is written straight: React
  // escapes the value on the way in and an entity here would render literally.
  const owner = isViewer ? "Your" : `${side.teamName}'s`;
  const weekPhrase = week === undefined ? "this week" : `week ${week}`;

  const helper = (() => {
    if (gap === null) {
      return "Projections are not available for this week, so there is nothing to compare against.";
    }
    if (!hasGap) {
      return isFinal
        ? "Nothing on the bench would have scored more."
        : "Nothing on the bench beats the lineup as it stands.";
    }
    return isFinal
      ? `${fmtPoints(gap)} points sat on the bench in ${weekPhrase}.`
      : `${fmtPoints(gap)} projected points are sitting on the bench.`;
  })();

  return (
    <Panel
      eyebrow="Lineup check"
      title={`${side.teamName} bench upgrades`}
      helper={helper}
      headingLevel={headingLevel}
    >
      {gap === null ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          No projections came back for this roster in {weekPhrase}, so no comparison is
          possible. That happens on a bye-heavy week, on a roster full of players Sleeper
          publishes no projection for, and before Power Pulse has scored the league at
          all.
        </p>
      ) : upgrades.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink">
          {isFinal
            ? `This was the best lineup available in ${weekPhrase}. Nothing on the bench, injured reserve, or the taxi squad would have scored more.`
            : "This is the best lineup available this week. Nothing on the bench, injured reserve, or the taxi squad projects higher than what is already starting."}
        </p>
      ) : (
        <>
          <ul role="list" className="space-y-2.5">
            {upgrades.map((upgrade, index) => (
              <li
                key={`${upgrade.inPlayer.sleeperId}-${upgrade.outPlayer.sleeperId}-${index}`}
                className="rounded-card border border-line bg-base/50 px-3 py-2.5"
              >
                <UpgradeSentence
                  upgrade={upgrade}
                  isFinal={isFinal}
                  isViewer={isViewer}
                />
              </li>
            ))}
          </ul>

          {side.optimalTotal !== null && (
            <p className="mt-4 text-sm leading-relaxed text-ink">
              {isFinal
                ? `${isViewer ? "You" : side.teamName} left ${fmtPoints(gap)} points on the bench in ${weekPhrase}. The best legal lineup was worth ${fmtPoints(side.optimalTotal)}.`
                : `${owner} best legal lineup projects ${fmtPoints(side.optimalTotal)}, which is ${fmtPoints(gap)} above the lineup ${isViewer ? "you have" : "they have"} set.`}
            </p>
          )}

          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            The swaps above do not add up to that gap. Taking one changes what the next
            one is worth, because the player it was going to replace is no longer sitting
            where it left him.
          </p>
        </>
      )}
    </Panel>
  );
}

/**
 * One swap, with the arithmetic on the page.
 *
 * The names are the load-bearing part of the sentence, so they carry the weight
 * and the gain carries an explicit sign. A swap that needs a roster move first
 * says so on its own line and wears a chip with a word in it, because a manager
 * who acts on it and finds Sleeper will not let them has been misled by this
 * panel.
 */
function UpgradeSentence({
  upgrade,
  isFinal,
  isViewer,
}: {
  upgrade: BenchUpgrade;
  isFinal: boolean;
  isViewer: boolean;
}) {
  return (
    <>
      <p className="text-sm leading-relaxed text-ink">
        {isFinal ? (
          <>
            <strong className="font-semibold">{upgrade.inPlayer.name}</strong> would have
            outscored <strong className="font-semibold">{upgrade.outPlayer.name}</strong>{" "}
            in {upgrade.slotLabel} by{" "}
            <span className="font-mono font-bold tabular-nums">
              {fmtPoints(upgrade.gain)}
            </span>{" "}
            points.
          </>
        ) : (
          <>
            Start <strong className="font-semibold">{upgrade.inPlayer.name}</strong> over{" "}
            <strong className="font-semibold">{upgrade.outPlayer.name}</strong> in{" "}
            {upgrade.slotLabel}.{" "}
            <span className="font-mono font-bold tabular-nums">
              {fmtSigned(upgrade.gain)}
            </span>{" "}
            projected points.
          </>
        )}
      </p>

      {upgrade.requiresMove && (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            {upgrade.inPlayer.name} is on injured reserve or the taxi squad, so starting
            him needs a roster move first. Sleeper will not let{" "}
            {isViewer ? "you" : "them"} slot him straight in.
          </p>
          <p className="mt-1.5">
            <span className={`${CHIP} border-signal-warning/50 text-signal-warning`}>
              <Repeat aria-hidden="true" className="h-3.5 w-3.5" />
              Roster move
            </span>
          </p>
        </>
      )}
    </>
  );
}
