/**
 * Small shared pieces for the Season Pulse pages: the position badge, the
 * player photo, a player link and the number formats.
 *
 * No hooks, so every one renders inside a server component and inside the
 * client leaders board alike.
 *
 * NOTHING HERE IS COLOUR-ONLY. A position badge prints the position and the
 * rank as text and adds the spelled-out words for a screen reader inside the
 * same element; the hue repeats what the letters already say.
 */

import Link from "next/link";
import type { Route } from "next";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerHeadshot } from "@/components/player-headshot";
import { positionNoun } from "@/lib/site";
import type { SeasonPosition } from "@/lib/season-pulse/types";

/** Static class names, so Tailwind sees every one of them. */
export const POSITION_CHIP: Record<SeasonPosition, string> = {
  QB: "border-position-qb/45 bg-position-qb/10 text-position-qb",
  RB: "border-position-rb/45 bg-position-rb/10 text-position-rb",
  WR: "border-position-wr/45 bg-position-wr/10 text-position-wr",
  TE: "border-position-te/45 bg-position-te/10 text-position-te",
  K: "border-position-k/45 bg-position-k/10 text-position-k",
  DEF: "border-position-def/45 bg-position-def/10 text-position-def",
};

/** The house link: cyan on hover, a visible focus ring, never colour alone in running text. */
export const PULSE_LINK =
  "font-medium text-ink underline decoration-ink/25 underline-offset-[3px] transition-colors hover:text-brand-cyan hover:decoration-brand-cyan/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** One decimal, always: "26.0" lines up under "31.3". */
export function points(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "n/a" : value.toFixed(1);
}

/** "+7.2" or "-3.0". */
export function signed(value: number): string {
  const body = Math.abs(value).toFixed(1);
  return value > 0 ? `+${body}` : value < 0 ? `-${body}` : body;
}

/**
 * "WR7": a position and a rank as one chip.
 *
 * The letters are real text, never aria-hidden, with the spelled-out words
 * appended inside the same element. A hidden visible span with a spoken twin
 * beside it reads correctly line by line and goes silent the moment a reader
 * points at it (CLAUDE.md, Lineups), so nothing here is drawn twice: a screen
 * reader hears "WR7, wide receiver rank 7".
 */
export function PositionBadge({
  position,
  rank,
  size = "md",
  when = "",
}: {
  position: SeasonPosition;
  rank?: number | null;
  size?: "sm" | "md";
  /** What the rank is for when it is not the season, e.g. "that week". */
  when?: string;
}) {
  const hasRank = rank !== null && rank !== undefined;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md border font-mono font-bold tabular-nums ${
        size === "sm" ? "min-w-[2.6rem] px-1 py-0.5 text-[10px]" : "min-w-[3.1rem] px-1.5 py-1 text-xs"
      } ${POSITION_CHIP[position]}`}
    >
      {position}
      {hasRank ? rank : ""}
      <span className="sr-only">
        {hasRank ? `, ${positionNoun(position)} rank ${rank}${when ? ` ${when}` : ""}` : `, ${positionNoun(position)}`}
      </span>
    </span>
  );
}

/**
 * A player's photo, or his team's logo for a team defense (a defense has no
 * headshot). Decorative either way: the name is always the adjacent text.
 */
export function PlayerAvatar({
  position,
  sleeperId,
  team,
  size = 36,
}: {
  position: SeasonPosition;
  sleeperId: string | null;
  team: string | null;
  size?: number;
}) {
  if (position === "DEF") {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-md border border-line bg-base/60"
        style={{ width: size, height: size }}
      >
        <NflTeamLogo team={team} size={Math.round(size * 0.72)} />
      </span>
    );
  }
  return <PlayerHeadshot sleeperId={sleeperId} name="" size={size} className="shrink-0" />;
}

/** A player's name as a link to his profile, with the 44px target the site uses. */
export function PlayerName({
  slug,
  name,
  className = "",
}: {
  slug: string;
  name: string;
  className?: string;
}) {
  return (
    <Link
      href={`/players/${encodeURIComponent(slug)}` as Route}
      className={`inline-flex min-h-11 min-w-11 items-center break-words text-sm ${PULSE_LINK} ${className}`}
    >
      {name}
    </Link>
  );
}

/** A team code with its logo. The code is the text; the logo repeats it. */
export function TeamTag({ team, size = 16 }: { team: string | null; size?: number }) {
  if (!team) return <span className="text-ink-subtle">Free agent</span>;
  return (
    <span className="inline-flex items-center gap-1 text-ink-subtle">
      <NflTeamLogo team={team} size={size} />
      {team}
    </span>
  );
}

/** A figure against a projection: green above, red below, the sign always printed. */
export function DiffChip({ value, context = "against the projection" }: { value: number; context?: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
        value >= 0 ? "bg-signal-success/15 text-signal-success" : "bg-[#F87171]/15 text-[#F87171]"
      }`}
    >
      {signed(value)}
      <span className="sr-only"> {context}</span>
    </span>
  );
}
