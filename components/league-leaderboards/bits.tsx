/**
 * The small pieces every Leaderboards list shares: who held a player, which
 * week, whether it was a playoff week, and the position chip.
 *
 * No hooks, so each renders inside the server page and the client board alike.
 *
 * A FREE AGENT IS SAID IN WORDS. The tag for a player nobody held is its own
 * shape (dashed, uncolored) AND the words "Free agent", because the shape is
 * the part a screen reader cannot see.
 */

import { SleeperAvatar } from "@/components/sleeper-avatar";
import { teamLabel } from "@/lib/league-leaderboards/team-label";
import { POSITION_CHIP } from "@/components/season-pulse/bits";
import { positionNoun } from "@/lib/site";
import {
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
  positionColorKey,
} from "@/lib/on-the-clock/position-colors";
import type { SeasonPosition } from "@/lib/season-pulse/types";
import type {
  LeaderboardPosition,
  LeaderboardTeam,
  OwnershipWeek,
} from "@/lib/league-leaderboards/types";

/** One decimal, always, so columns of points line up. */
export function pts(value: number): string {
  return value.toFixed(1);
}

/**
 * "WR" with the spelled-out position for a screen reader, in one element. The
 * six offensive hues are the Season Pulse chip's; a defender takes the shared
 * palette's defender hue, the same one his tag carries everywhere else.
 */
export function PosChip({ position }: { position: LeaderboardPosition }) {
  const key = positionColorKey(position);
  const tone =
    POSITION_CHIP[position as SeasonPosition] ??
    `border-transparent ${key ? POSITION_BADGE[key] : POSITION_BADGE_FALLBACK}`;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${tone}`}
    >
      {position}
      <span className="sr-only">{`, ${positionNoun(position)}`}</span>
    </span>
  );
}

/**
 * "Wk 7". The number is one real text node; only the abbreviation is swapped
 * for the word, so a screen reader pointed at the tag still finds the number.
 */
export function WeekTag({ week }: { week: number }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-line px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-muted">
      <span aria-hidden="true">Wk</span>
      <span className="sr-only">Week</span> {week}
    </span>
  );
}

/** Marks a playoff week. Only ever drawn in a league that has a bracket. */
export function PlayoffTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-brand-purple/50 bg-brand-purple/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-purple-light">
      Playoffs
    </span>
  );
}

/**
 * Who held a player: the team, or "Free agent". The reader's own team gets a
 * cyan edge and the words "Your team", never the color alone.
 */
export function OwnerTag({
  team,
  viewerRosterId,
  prefix,
}: {
  team: LeaderboardTeam | null;
  viewerRosterId: number | null;
  /** Spoken before the name, e.g. "rostered by". Visible text is the name alone. */
  prefix?: string;
}) {
  if (!team) {
    return (
      <span className="inline-flex max-w-full shrink-0 items-center rounded-full border border-dashed border-ink/35 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
        <span className="sr-only">, </span>
        Free agent
      </span>
    );
  }
  const mine = viewerRosterId !== null && team.sleeperRosterId === viewerRosterId;
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-xl border py-0.5 pl-0.5 pr-2 text-[11px] font-semibold ${
        mine ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan" : "border-line bg-surface/70 text-ink"
      }`}
    >
      <SleeperAvatar avatarId={team.avatarId} title="" size={18} />
      {/* The comma is the pause between the tag before and the name. */}
      <span className="sr-only">, {prefix ? `${prefix} ` : ""}</span>
      {/* The owner's Sleeper handle, not the team name (see
          lib/league-leaderboards/team-label.ts). Wraps rather than truncates:
          it appears nowhere else in full on a phone. */}
      <span className="min-w-0 break-words">{teamLabel(team)}</span>
      {mine && (
        <span className="shrink-0 rounded-full bg-brand-cyan/20 px-1.5 text-[9px] font-bold uppercase tracking-[0.1em]">
          Your team
        </span>
      )}
    </span>
  );
}

type Run = { rosterId: number | null; from: number; to: number };

/** Consecutive weeks under one holder, in order. */
export function ownershipRuns(ownership: OwnershipWeek[]): Run[] {
  const runs: Run[] = [];
  for (const w of ownership) {
    const last = runs[runs.length - 1];
    if (last && last.rosterId === w.rosterId && last.to === w.week - 1) last.to = w.week;
    else runs.push({ rosterId: w.rosterId, from: w.week, to: w.week });
  }
  return runs;
}

/**
 * The ownership history in full words: "Free agent weeks 1 to 3, then
 * mjwalsh weeks 4 to 7". Null only when one holder had him every week
 * AND still has him, because then the owner tag already says it all. A single
 * holder who has since traded or dropped him is still named. One line for the
 * eye and the ear alike, so nothing is drawn twice.
 */
export function ownershipHistory(
  ownership: OwnershipWeek[],
  teams: Record<number, LeaderboardTeam>,
  currentRosterId: number | null,
): string | null {
  const runs = ownershipRuns(ownership);
  if (runs.length === 0) return null;
  if (runs.length === 1 && runs[0].rosterId === currentRosterId) return null;
  return runs
    .map((r) => {
      const who = r.rosterId === null ? "Free agent" : (teams[r.rosterId] ? teamLabel(teams[r.rosterId]) : "Another team");
      const span = r.from === r.to ? `week ${r.from}` : `weeks ${r.from} to ${r.to}`;
      return `${who} ${span}`;
    })
    .join(", then ");
}
