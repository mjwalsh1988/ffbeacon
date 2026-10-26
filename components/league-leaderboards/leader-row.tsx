/**
 * The two row shapes every Leaderboards list is built from: a player across
 * the weeks in scope, and a player in one week.
 *
 * ONE LAYOUT AT EVERY WIDTH. Rank on the left, the player in the middle, the
 * number on the right, and everything else (position, NFL team, who held him,
 * the ownership history) on a second line under the name. Nothing is hidden
 * on a phone; the second line wraps between whole tags, never inside one.
 *
 * READING ORDER IS THE SENTENCE. A screen reader moving through a row hears
 * rank, name, position, team, holder, then the points with the word "points"
 * after them, because every figure is one text node with only the missing
 * words appended inside the same element.
 */

import Link from "next/link";
import type { Route } from "next";
import { PlayerAvatar, PULSE_LINK } from "@/components/season-pulse/bits";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import type { SeasonPosition } from "@/lib/season-pulse/types";
import type {
  LeaderboardPlayer,
  LeaderboardTeam,
  PlayerLeader,
  PlayerWeekLeader,
} from "@/lib/league-leaderboards/types";
import { OwnershipStrip } from "./ownership-strip";
import {
  OwnerTag,
  PlayoffTag,
  PosChip,
  WeekTag,
  ownershipHistory,
  pts,
} from "./bits";

/** The rank numeral. The top three are drawn in the beacon gradient. */
export function RankMark({ rank }: { rank: number }) {
  const top = rank <= 3;
  return (
    <span
      className={`w-8 shrink-0 text-center font-mono text-lg font-black tabular-nums sm:w-9 sm:text-xl ${
        top ? "bg-beacon bg-clip-text text-transparent" : "text-ink-subtle"
      }`}
    >
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

/**
 * The rank and the photo. From sm up the rank is its own column; on a phone it
 * sits on the photo's corner instead, which gives the name the forty pixels a
 * separate column would have taken. Only one of the two is ever displayed, so
 * a screen reader hears the rank once.
 */
function RankedAvatar({ rank, player }: { rank: number; player: LeaderboardPlayer }) {
  const top = rank <= 3;
  return (
    <>
      <span className="hidden sm:contents">
        <RankMark rank={rank} />
      </span>
      <span className="relative shrink-0">
        <PlayerAvatar
          position={player.position as SeasonPosition}
          sleeperId={player.sleeperId}
          team={player.nflTeam}
          size={40}
        />
        <span
          className={`absolute -bottom-1.5 -left-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border bg-base px-1 font-mono text-[10px] font-black tabular-nums sm:hidden ${
            top ? "border-brand-cyan/70 text-brand-cyan" : "border-line text-ink-muted"
          }`}
        >
          <span className="sr-only">Rank </span>
          {rank}
        </span>
      </span>
    </>
  );
}

/** The player's name, linked to his profile when he has one. A 44px target. */
export function PlayerLink({ player }: { player: LeaderboardPlayer }) {
  const text = <span className="min-w-0 break-words">{player.name}</span>;
  if (!player.slug) {
    return <span className="flex min-h-11 min-w-0 items-center text-sm font-semibold text-ink">{text}</span>;
  }
  return (
    <Link
      href={`/players/${encodeURIComponent(player.slug)}` as Route}
      className={`flex min-h-11 min-w-0 items-center text-sm font-semibold ${PULSE_LINK}`}
    >
      {text}
    </Link>
  );
}

function NflTeam({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-subtle">
      <NflTeamLogo team={code} size={14} />
      {code}
    </span>
  );
}

function rowTone(highlight: boolean): string {
  return highlight
    ? "bg-brand-cyan/[0.06] shadow-[inset_3px_0_0_0_rgba(34,211,238,0.8)]"
    : "";
}

/** A player across the weeks in scope. */
export function LeaderRow({
  leader,
  teams,
  viewerRosterId,
  leaderPoints,
}: {
  leader: PlayerLeader;
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
  /** The first row's total, for the bar that measures this row against it. */
  leaderPoints: number;
}) {
  const share = leaderPoints > 0 ? Math.max(0.02, Math.min(1, leader.points / leaderPoints)) : 0;
  const owner = leader.currentRosterId !== null ? (teams[leader.currentRosterId] ?? null) : null;
  const history = ownershipHistory(leader.ownership, teams, leader.currentRosterId);
  const mine = viewerRosterId !== null && leader.currentRosterId === viewerRosterId;
  return (
    <li className={`flex items-center gap-2.5 px-3 py-2 sm:gap-3 sm:px-4 ${rowTone(mine)}`}>
      <RankedAvatar rank={leader.rank} player={leader.player} />
      <div className="min-w-0 flex-1 md:flex md:items-center md:gap-6">
        <div className="min-w-0 md:w-80 md:shrink-0 lg:w-96">
          <PlayerLink player={leader.player} />
          <div className="pointer-events-none -mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <PosChip position={leader.player.position} />
            <NflTeam code={leader.player.nflTeam} />
            <OwnerTag team={owner} viewerRosterId={viewerRosterId} prefix="rostered by" />
          </div>
          {history && <p className="mt-1 break-words text-[11px] text-ink-subtle">{history}</p>}
          {/* Under the name on a phone. Both strips are aria-hidden pictures
              of what the tags and the line above already say in words. */}
          <div className="mt-1 md:hidden">
            <OwnershipStrip ownership={leader.ownership} currentRosterId={leader.currentRosterId} />
          </div>
        </div>
        <div aria-hidden="true" className="hidden min-w-0 flex-1 items-center gap-5 md:flex">
          <OwnershipStrip ownership={leader.ownership} currentRosterId={leader.currentRosterId} size="lg" />
          <span className="block h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-ink/[0.07]">
            <span className="block h-full rounded-full bg-beacon" style={{ width: `${share * 100}%` }} />
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-base font-extrabold tabular-nums text-ink sm:text-lg">
          {pts(leader.points)}
          <span className="sr-only"> points</span>
        </p>
        <p className="whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-subtle">
          {leader.perGame !== null ? pts(leader.perGame) : "0.0"}
          <span className="sr-only"> per game</span>
          <span aria-hidden="true">/g</span>
          <span>
            {", "}
            {leader.games}
            <span aria-hidden="true">g</span>
            <span className="sr-only"> {leader.games === 1 ? "game" : "games"}</span>
          </span>
        </p>
        {leader.gapAbove !== null && leader.gapAbove > 0 && (
          <p className="whitespace-nowrap font-mono text-[10px] tabular-nums text-ink-subtle">
            {pts(leader.gapAbove)} back
            <span className="sr-only"> of the player above</span>
          </p>
        )}
      </div>
    </li>
  );
}

/** A player in one week. */
export function PlayerWeekRow({
  item,
  rank,
  teams,
  viewerRosterId,
  showStatus = true,
}: {
  item: PlayerWeekLeader;
  rank: number;
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
  /** Off where every row is a bench row and saying so each time is noise. */
  showStatus?: boolean;
}) {
  const team = item.rosterId !== null ? (teams[item.rosterId] ?? null) : null;
  const mine = viewerRosterId !== null && item.rosterId === viewerRosterId;
  return (
    <li className={`flex items-center gap-2.5 px-3 py-2 sm:gap-3 sm:px-4 ${rowTone(mine)}`}>
      <RankedAvatar rank={rank} player={item.player} />
      <div className="min-w-0 flex-1">
        <PlayerLink player={item.player} />
        <div className="pointer-events-none -mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <PosChip position={item.player.position} />
          <WeekTag week={item.week} />
          {item.playoff && <PlayoffTag />}
          <OwnerTag team={team} viewerRosterId={viewerRosterId} prefix="that week, rostered by" />
          {showStatus && team && (
            <span className="text-[11px] text-ink-subtle">
              <span className="sr-only">, </span>
              {item.started ? "Started" : "On the bench"}
            </span>
          )}
        </div>
      </div>
      <p className="shrink-0 text-right font-mono text-base font-extrabold tabular-nums text-ink sm:text-lg">
        {pts(item.points)}
        <span className="sr-only"> points</span>
      </p>
    </li>
  );
}

/** The list shell: an ordered list, named by the heading above it. */
export const LIST_CLASS = "divide-y divide-line/60 overflow-hidden rounded-card border border-line bg-base/40";
