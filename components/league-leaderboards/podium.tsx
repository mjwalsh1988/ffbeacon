/**
 * The top three, on a podium.
 *
 * THE LEADER IS THE BIGGEST THING ON THE PAGE. First place stands in the
 * middle on a wider screen, taller than the two beside it, with the beacon
 * gradient around the photo; second and third flank it. On a phone the three
 * stack in rank order, first on top, because a podium squeezed into 360 pixels
 * is three postage stamps.
 *
 * FF BEACON COLORS, NOT MEDAL COLORS. Gold, silver and bronze would be the
 * obvious move and gold is exactly the accent the brand rules keep off this
 * site. First is the full purple to cyan gradient, second cyan, third purple,
 * and every place is printed as a word, so nothing depends on the color.
 *
 * An ordered list in rank order whatever the visual order, so a screen reader
 * hears first, second, third even where first is drawn in the middle.
 */

import type { SeasonPosition } from "@/lib/season-pulse/types";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import type { LeaderboardTeam, PlayerLeader } from "@/lib/league-leaderboards/types";
import { OwnerTag, PosChip, pts } from "./bits";
import { PlayerLink } from "./leader-row";

const PLACE: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

const RING = [
  "bg-beacon p-[3px] shadow-[0_0_60px_-12px_rgba(168,85,247,0.75)]",
  "bg-brand-cyan/80 p-[2px]",
  "bg-brand-purple/80 p-[2px]",
] as const;

const PLACE_TEXT = [
  "bg-beacon bg-clip-text text-transparent",
  "text-brand-cyan",
  "text-brand-purple",
] as const;

/** The place badge on the photo: solid colors, because a gradient clipped to
 *  text cannot share an element with the badge's own background. */
const BADGE = [
  "border-brand-cyan/70 text-brand-cyan shadow-[0_0_18px_-4px_rgba(34,211,238,0.8)]",
  "border-brand-cyan/50 text-brand-cyan",
  "border-brand-purple/50 text-brand-purple",
] as const;

/** sm+ order: second, first, third. Phones keep rank order. */
const ORDER = ["sm:order-2", "sm:order-1", "sm:order-3"] as const;

export function Podium({
  leaders,
  teams,
  viewerRosterId,
  label,
}: {
  leaders: PlayerLeader[];
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
  /** What the three lead, e.g. "Season points leaders". */
  label: string;
}) {
  const top = leaders.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <ol role="list" aria-label={label} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      {top.map((leader, i) => {
        const owner = leader.currentRosterId !== null ? (teams[leader.currentRosterId] ?? null) : null;
        const first = i === 0;
        const photo = first ? 112 : 84;
        return (
          <li
            key={leader.player.sleeperId}
            className={`relative overflow-hidden rounded-modal border ${
              first ? "border-line-accent" : "border-line"
            } bg-surface/60 ${ORDER[i]}`}
            style={
              first
                ? {
                    backgroundImage:
                      "radial-gradient(ellipse at 50% 0%, rgba(168, 85, 247, 0.22) 0%, transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
                  }
                : undefined
            }
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 top-0 h-[3px] ${first ? "bg-beacon" : i === 1 ? "bg-brand-cyan/70" : "bg-brand-purple/70"}`}
            />
            {/* A phone lays the card out sideways (photo left, figures right) so
                three of them fit above the fold. From sm up each card stands. */}
            <div
              className={`flex items-center gap-3 p-3.5 sm:flex-col sm:text-center ${first ? "sm:px-4 sm:pb-6 sm:pt-6" : "sm:px-4 sm:pb-4 sm:pt-5"}`}
            >
              <div className="relative shrink-0">
                <div className={`rounded-xl ${RING[i]}`}>
                  {leader.player.position === "DEF" ? (
                    <span
                      className="flex items-center justify-center rounded-[10px] bg-base"
                      style={{ width: photo, height: photo }}
                    >
                      <NflTeamLogo team={leader.player.nflTeam} size={Math.round(photo * 0.7)} />
                    </span>
                  ) : (
                    <PlayerHeadshot
                      sleeperId={leader.player.sleeperId}
                      name=""
                      size={photo}
                      className="!rounded-[10px] bg-base"
                    />
                  )}
                </div>
                <span
                  className={`absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-base px-2 py-0.5 font-mono text-[11px] font-black ${BADGE[i]}`}
                >
                  {PLACE[leader.rank] ?? `${leader.rank}th`}
                  <span className="sr-only"> place</span>
                </span>
              </div>

              <div className="min-w-0 flex-1 sm:mt-3 sm:w-full">
                <div className="sm:flex sm:justify-center">
                  <PlayerLink player={leader.player} />
                </div>
                <div className="pointer-events-none -mt-1.5 flex flex-wrap items-center gap-1.5 sm:justify-center">
                  <PosChip position={leader.player.position as SeasonPosition} />
                  {leader.player.nflTeam && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
                      <NflTeamLogo team={leader.player.nflTeam} size={14} />
                      {leader.player.nflTeam}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex sm:justify-center">
                  <OwnerTag team={owner} viewerRosterId={viewerRosterId} prefix="rostered by" />
                </div>
              </div>

              <div className="shrink-0 text-right sm:mt-3 sm:text-center">
                <p
                  className={`font-mono font-black tabular-nums leading-none ${first ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"} ${first ? PLACE_TEXT[0] : "text-ink"}`}
                >
                  {pts(leader.points)}
                  <span className="sr-only"> points</span>
                </p>
                <p className="mt-1 whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-subtle">
                  {leader.perGame !== null ? pts(leader.perGame) : "0.0"} per game
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
