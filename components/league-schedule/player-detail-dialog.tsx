"use client";

/**
 * Every number behind one player in one week.
 *
 * The lineup table shows a name and a figure. This is where the figure comes
 * apart: the projection, the spread around it, what the matchup did to it, how
 * often this player has met his number before, and how often he has been
 * available to try. It opens on every breakpoint rather than only on a phone,
 * because the desktop alternative is a hover popover, and a hover popover is a
 * thing a keyboard cannot reach.
 *
 * WHY NULL IS A SENTENCE
 *   A dash reads as "nothing here" and a zero reads as "we measured nothing",
 *   and only one of those is true. Anything we do not hold says "Not available"
 *   in words. The one exception is the injury row: types.ts documents a null
 *   injuryStatus as healthy, so that row says "None reported", which is
 *   information rather than an absence.
 *
 * WHY THERE IS NO LINK TO THE PLAYER PROFILE
 *   /players/[slug] is keyed on the slug column, and SchedulePlayer carries a
 *   uuid and a Sleeper id, neither of which is a slug. A link built from either
 *   would be a 404 on every player, so there is no link. Add `slug` to
 *   SchedulePlayer and the link becomes three lines here.
 *
 * ACCESSIBLE NAME: SlideUpDialog takes a `label` and owns its own
 * aria-labelledby, with no prop to point it at a heading of ours. The visible
 * h2 below is therefore worded identically to the label passed in, so the name
 * a screen reader announces and the name on the screen cannot drift apart.
 */

import { PlayerHeadshot } from "@/components/player-headshot";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import type { SchedulePlayer } from "@/lib/league-schedule/types";
import { CHIP, EYEBROW, fmtPoints, opponentLabel, opponentWords } from "./format";

/** Spoken position names, so a matchup sentence reads like a sentence. */
const POSITION_WORDS: Record<string, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "team defenses",
  DL: "defensive linemen",
  LB: "linebackers",
  DB: "defensive backs",
};

function positionWords(position: string): string {
  return POSITION_WORDS[position.toUpperCase()] ?? `${position} players`;
}

/**
 * What the opponent multiplier means, in words.
 *
 * Above 1 means the defense has given up MORE than the league average to this
 * position, which is why "above average" attaches to what the opponent allowed
 * rather than to how the defense played. Exactly 1 is not rounded into one of
 * the other two, because "an average matchup" is a real finding and "0 percent
 * above average" is a sentence nobody says.
 */
function describeMatchup(
  multiplier: number | null,
  position: string,
  opponent: string | null,
): string {
  if (multiplier === null) return "Not available";
  const team = opponent ? opponent.replace(/^@/, "") : "This opponent";
  const percent = Math.round(Math.abs(multiplier - 1) * 100);
  if (percent === 0) {
    return `${team} is an average matchup for ${positionWords(position)}.`;
  }
  const direction = multiplier > 1 ? "above" : "below";
  return `${team} has allowed ${percent} percent ${direction} average to ${positionWords(position)}.`;
}

/** "1.02, which lifts the projection by 2 percent." */
function describeReliability(reliability: number | null): string {
  if (reliability === null) return "Not available";
  const percent = Math.round(Math.abs(reliability - 1) * 100);
  if (percent === 0) return `${reliability.toFixed(2)}, no adjustment either way.`;
  const verb = reliability > 1 ? "lifts" : "trims";
  return `${reliability.toFixed(2)}, which ${verb} the projection by ${percent} percent.`;
}

export function PlayerDetailDialog({
  player,
  week,
  isFinal,
  onClose,
}: {
  /** Null closes the dialog. The parent keeps the selection. */
  player: SchedulePlayer | null;
  week: number;
  isFinal: boolean;
  onClose: () => void;
}) {
  // Nothing selected, nothing rendered. SlideUpDialog already returns null when
  // it is closed, so mounting it empty would only add a component that draws
  // nothing and holds a stale name.
  if (!player) return null;

  const title = `${player.name}, week ${week}`;
  const opponent = opponentLabel(player.nflOpponent);
  // Read as a phrase in the identity line, where it sits in running text, and
  // as a bare code in the term list below, where the label supplies the noun.
  const opponentPhrase = opponentWords(player.nflOpponent);

  return (
    <SlideUpDialog open onClose={onClose} label={title} closeLabel={`Close ${player.name}`}>
      <div className="px-5 pb-6 pt-1">
        <header className="flex items-start gap-3 border-b border-line pb-4">
          <PlayerHeadshot sleeperId={player.sleeperId} name="" size={48} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={EYEBROW}>Week {week}</p>
            <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-ink">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {player.position}
              {player.team ? `, ${player.team}` : ""}, {opponentPhrase}
            </p>
          </div>
        </header>

        {player.injuryStatus && (
          <p className="mt-3">
            <span className={`${CHIP} border-signal-warning/50 text-signal-warning`}>
              Injury designation: {player.injuryStatus}
            </span>
          </p>
        )}

        <dl className="mt-4 space-y-3">
          {isFinal && (
            <Row
              term="Actual points"
              value={player.actual === null ? "Not available" : `${fmtPoints(player.actual)}`}
            />
          )}
          <Row
            term="Projected points"
            value={
              player.projected === null
                ? "Not available"
                : `${fmtPoints(player.projected)} in this league scoring`
            }
          />
          <Row
            term="Weekly spread"
            value={
              player.sigma === null
                ? "Not available"
                : `plus or minus ${fmtPoints(player.sigma)} points in a typical week`
            }
          />
          <Row term="NFL opponent" value={opponent} />
          <Row
            term="Matchup strength"
            value={describeMatchup(player.opponentMultiplier, player.position, player.nflOpponent)}
          />
          <Row
            term="Beats his projection"
            value={
              player.beatRate === null
                ? "Not available"
                : `${Math.round(player.beatRate * 100)} percent of the weeks he was projected. Half is the coin flip.`
            }
          />
          <Row
            term="Availability"
            value={
              player.availability === null
                ? "Not available"
                : `Played ${Math.round(player.availability * 100)} percent of the weeks he was projected for.`
            }
          />
          <Row term="Reliability" value={describeReliability(player.reliability)} />
          <Row term="Injury status" value={player.injuryStatus ?? "None reported"} />
          <Row
            term="Roster status"
            value={
              player.isInactive
                ? "On injured reserve or the taxi squad, so starting him needs a roster move first."
                : "Active, and startable as things stand."
            }
          />
        </dl>
      </div>
    </SlideUpDialog>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {term}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-ink">{value}</dd>
    </div>
  );
}
