"use client";

import { forwardRef } from "react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { PositionChip } from "@/components/position-chip";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { finishesSentence, type CardPlayer } from "@/lib/ranking-boards/card-text";
import { nflTeamName } from "@/lib/nfl-teams";

/** The sentence the whole card is named by (plan section 10). */
export function cardSentence(player: CardPlayer): string {
  const team = player.team ? nflTeamName(player.team) ?? player.team : "free agent";
  const age = player.age != null ? `, age ${player.age}` : "";
  return `Choose ${player.name}, ${player.position}, ${team}${age}, ${finishesSentence(player)}`;
}

/**
 * One side of a Beacon Ranker question (plan section 13.3). The whole card is
 * the button: its accessible name is the full sentence, and the visible card
 * is that sentence's content, so nothing is drawn twice. Both sides are drawn
 * identically so neither looks like the default, and nothing is pre-selected.
 *
 * The button element is stable across questions (the caller keys it by side),
 * so focus stays put after an answer. The inner content is keyed by player, so
 * it remounts and plays its entrance, which reduced motion turns off.
 */
export const ComparisonCard = forwardRef<
  HTMLButtonElement,
  {
    player: CardPlayer;
    digit: 1 | 2;
    onChoose: () => void;
    disabled?: boolean;
    /** The side just chosen lifts for a moment. */
    lifted?: boolean;
  }
>(function ComparisonCard({ player, digit, onChoose, disabled, lifted }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onChoose}
      disabled={disabled}
      aria-label={cardSentence(player)}
      aria-keyshortcuts={String(digit)}
      className={`group relative flex w-full flex-col overflow-hidden rounded-modal border border-line bg-surface p-4 text-left transition-colors hover:border-brand-purple/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60 sm:p-5 ${
        lifted ? "ranker-lift" : ""
      }`}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-beacon" />
      <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-base font-mono text-xs font-bold text-ink-muted">
        {digit}
      </span>
      <span key={player.playerId} className="ranker-enter flex flex-col gap-3">
        <span className="flex items-center gap-4">
          <PlayerHeadshot
            sleeperId={player.sleeperId}
            position={player.position}
            name={player.name}
            size={96}
          />
          <span className="min-w-0">
            <span className="block text-xl font-semibold leading-tight tracking-tight text-ink sm:text-2xl">
              {player.name}
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <PositionChip position={player.position} />
              <span className="inline-flex items-center gap-1.5">
                <NflTeamLogo team={player.team} size={20} />
                {player.team ?? "FA"}
              </span>
              {player.age != null && <span>Age {player.age}</span>}
            </span>
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {player.finishes.length === 0 ? (
            <span className="rounded-full border border-line bg-base px-2.5 py-1 text-xs text-ink-subtle">
              {player.rookie ? "Rookie, no NFL finishes" : "No finishes in the last three seasons"}
            </span>
          ) : (
            player.finishes.map((f) => (
              <span
                key={f.season}
                className="rounded-full border border-brand-purple/40 bg-brand-purple/10 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-brand-purple-light"
              >
                {f.season} {player.position}
                {f.finish}
              </span>
            ))
          )}
        </span>
      </span>
      <span className="mt-4 inline-flex min-h-11 items-center justify-center rounded-card bg-base/60 px-4 text-sm font-semibold text-ink group-hover:bg-brand-purple/15">
        Choose {player.name}
      </span>
    </button>
  );
});
