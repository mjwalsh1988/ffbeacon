import { ArrowDown, ArrowUp, Repeat } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { Panel } from "@/components/dashboard-panel";
import type { BenchUpgrade, MatchupSide, SchedulePlayer } from "@/lib/league-schedule/types";
import {
  BENCH_CHIP_THRESHOLD,
  CHIP,
  fmtPoints,
  fmtSigned,
  opponentLabel,
  opponentWords,
} from "./format";

/**
 * What this lineup left behind.
 *
 * Server component. Everything on it is already computed on the MatchupSide;
 * this file decides only what words and what layout go around the numbers.
 *
 * TWO RENDERS OF ONE SWAP, AND WHY
 *   A swap is a comparison of two players, and the fastest way to read a
 *   comparison is to see both faces, both positions, both opponents, and both
 *   projections side by side with the gain called out. The fastest way to HEAR
 *   one is a sentence. Those are different shapes, and trying to make one serve
 *   both is what produced the old version: a sentence with the names bolded,
 *   which read fine and told a sighted reader nothing about who these players
 *   are. So the card is drawn for the eye and marked aria-hidden, and an
 *   sr-only sentence carries the identical facts for the ear. Every figure
 *   appears in both. Neither is a summary of the other.
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

/**
 * The stand-in lib/league-schedule/matchup.ts uses for an unfilled slot.
 *
 * It is a SchedulePlayer with a synthetic id and every number null, so it has
 * no photo to fetch and no projection to print. Detected on the two fields that
 * cannot both be empty on a real player rather than on the id string, which is
 * an implementation detail of the other module.
 */
function isEmptySlot(player: SchedulePlayer): boolean {
  return player.playerId === null && player.position === "";
}

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
      return "No projections this week, so there is nothing to compare.";
    }
    if (!hasGap) {
      return isFinal
        ? "Nothing on the bench would have scored more."
        : "Nothing on the bench beats this lineup.";
    }
    return isFinal
      ? `${fmtPoints(gap)} points sat on the bench in ${weekPhrase}.`
      : `${fmtPoints(gap)} projected points are on the bench.`;
  })();

  return (
    <Panel
      eyebrow="Lineup check"
      title={`Better starts for ${side.teamName}`}
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
          <ul role="list" className="space-y-3">
            {upgrades.map((upgrade, index) => (
              <li
                key={`${upgrade.inPlayer.sleeperId}-${upgrade.outPlayer.sleeperId}-${index}`}
                className="rounded-card border border-line bg-base/50 p-2.5 sm:p-3"
              >
                {/* For the ear. Identical facts, sentence shape. */}
                <p className="sr-only">{spokenUpgrade(upgrade, isFinal, isViewer)}</p>

                {/* For the eye. */}
                <div aria-hidden="true">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`${CHIP} font-bold uppercase tracking-wide`}>
                      {upgrade.slotLabel}
                    </span>
                    <span className="rounded-full border border-signal-success/50 bg-signal-success/10 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-signal-success">
                      {fmtSigned(upgrade.gain)} pts
                    </span>
                  </div>

                  <div className="mt-2.5 space-y-1.5">
                    <PlayerLine
                      player={upgrade.inPlayer}
                      role="in"
                      isFinal={isFinal}
                      gain={upgrade.gain}
                    />
                    <PlayerLine
                      player={upgrade.outPlayer}
                      role="out"
                      isFinal={isFinal}
                      gain={null}
                    />
                  </div>

                  {/* Inside the aria-hidden block on purpose: spokenUpgrade
                      already carries this warning, and a second copy would have
                      a screen reader read the roster-move caveat twice. */}
                  {upgrade.requiresMove && (
                    <>
                      <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                        {upgrade.inPlayer.name} is on injured reserve or the taxi squad,
                        so starting him needs a roster move first. Sleeper will not let{" "}
                        {isViewer ? "you" : "them"} slot him straight in.
                      </p>
                      <p className="mt-1.5">
                        <span
                          className={`${CHIP} border-signal-warning/50 text-signal-warning`}
                        >
                          <Repeat className="h-3.5 w-3.5" />
                          Roster move
                        </span>
                      </p>
                    </>
                  )}
                </div>
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
 * One player in a swap, drawn.
 *
 * The projection is the right-hand figure and the gain rides in brackets on the
 * incoming half only, because the gain is a property of the swap and printing it
 * against both players would make it look like each of them moved by that much.
 * Green for the player coming in, muted for the one going out; the START and SIT
 * words carry the same distinction, so the tint is reinforcement rather than the
 * signal. This whole subtree is inside an aria-hidden block: the sentence above
 * it is what a screen reader gets.
 */
function PlayerLine({
  player,
  role,
  isFinal,
  gain,
}: {
  player: SchedulePlayer;
  role: "in" | "out";
  isFinal: boolean;
  /** Only ever set on the incoming half. */
  gain: number | null;
}) {
  const incoming = role === "in";
  const empty = isEmptySlot(player);
  const points = isFinal ? player.actual : player.projected;
  const Icon = incoming ? ArrowUp : ArrowDown;

  return (
    <div
      className={`flex items-center gap-2.5 rounded-card border px-2.5 py-2 ${
        incoming
          ? "border-signal-success/35 bg-signal-success/[0.06]"
          : "border-line bg-surface/60"
      }`}
    >
      {empty ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-line-accent text-[10px] font-bold text-ink-subtle">
          --
        </span>
      ) : (
        <PlayerHeadshot sleeperId={player.sleeperId} name="" size={36} className="shrink-0" />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${
              incoming
                ? "bg-signal-success/20 text-signal-success"
                : "bg-line-accent text-ink-subtle"
            }`}
          >
            <Icon className="h-2.5 w-2.5" />
            {incoming ? "Start" : "Sit"}
          </span>
          <span className="min-w-0 truncate text-sm font-bold text-ink">
            {empty ? "Empty slot" : player.name}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
          {empty
            ? "Nobody is in this slot"
            : `${player.position}${player.team ? `, ${player.team}` : ""} ${opponentLabel(
                player.nflOpponent,
                player.nflIsHome,
              )}`}
        </span>
      </span>

      <span className="shrink-0 text-right">
        {points === null ? (
          <span className="block text-[11px] text-ink-subtle">
            {isFinal ? "No score" : "No proj"}
          </span>
        ) : (
          <span className="block font-mono text-base font-extrabold tabular-nums text-ink">
            {fmtPoints(points, 2)}
            {gain !== null && (
              <span className="ml-1 font-mono text-xs font-bold tabular-nums text-signal-success">
                ({fmtSigned(gain)})
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * One swap as a sentence, for a screen reader.
 *
 * Carries everything the drawn card carries: both names, both positions, both
 * NFL opponents, both figures, and the gain. A final week says what was scored,
 * an unplayed one says what is projected, because on a settled week the result
 * is the fact and the forecast is the footnote.
 */
function spokenUpgrade(
  upgrade: BenchUpgrade,
  isFinal: boolean,
  isViewer: boolean,
): string {
  const describe = (player: SchedulePlayer): string => {
    if (isEmptySlot(player)) return "an empty slot, with no projection";
    const parts: string[] = [player.name, player.position];
    if (player.team) parts.push(player.team);
    parts.push(opponentWords(player.nflOpponent, player.nflIsHome));
    const value = isFinal ? player.actual : player.projected;
    parts.push(
      value === null
        ? isFinal
          ? "no score recorded"
          : "no projection published"
        : isFinal
          ? `scored ${fmtPoints(value, 2)}`
          : `projected ${fmtPoints(value, 2)}`,
    );
    return parts.join(", ");
  };

  const lead = isFinal
    ? `In ${upgrade.slotLabel}, ${describe(upgrade.inPlayer)}, would have outscored ${describe(
        upgrade.outPlayer,
      )} by ${fmtPoints(upgrade.gain)} points.`
    : `In ${upgrade.slotLabel}, start ${describe(upgrade.inPlayer)}, over ${describe(
        upgrade.outPlayer,
      )}. Worth ${fmtSigned(upgrade.gain)} projected points.`;

  if (!upgrade.requiresMove) return lead;
  return `${lead} ${upgrade.inPlayer.name} is on injured reserve or the taxi squad, so starting him needs a roster move first. Sleeper will not let ${
    isViewer ? "you" : "them"
  } slot him straight in.`;
}
