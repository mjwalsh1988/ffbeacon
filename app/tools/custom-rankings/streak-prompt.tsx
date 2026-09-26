"use client";

import { useId, useState } from "react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { PlayerHeadshot } from "@/components/player-headshot";
import { PositionChip } from "@/components/position-chip";
import type { CardPlayer } from "@/lib/ranking-boards/card-text";
import { PlaceAtRank } from "./place-at-rank";

/**
 * The three-win prompt (plan sections 5.2 and 13.5). A decision, so a centred
 * dialog. It replaces the question the reader was on, so it takes focus and
 * its heading says why it appeared. Escape and the close button mean "keep
 * comparing": the prompt must never leave the run stuck with no question open.
 */
export function StreakPrompt({
  open,
  player,
  streak,
  maxRank,
  boardNames,
  onPlace,
  onContinue,
}: {
  open: boolean;
  player: CardPlayer | null;
  streak: number;
  maxRank: number;
  boardNames: string[];
  onPlace: (rank: number) => void;
  onContinue: () => void;
}) {
  const headingId = useId();
  const [placing, setPlacing] = useState(false);
  if (!player) return null;
  return (
    <SlideUpDialog
      open={open}
      onClose={onContinue}
      label={`${player.name} has won ${streak} in a row`}
      labelledBy={headingId}
      desktopPlacement="center"
      closeLabel="Keep comparing"
    >
      <div className="space-y-4 p-5 sm:p-6">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
          {player.name} has won {streak} in a row. Place him at a rank, or keep comparing?
        </h2>
        <div className="flex items-center gap-3 rounded-card border border-line bg-base/40 p-3">
          <PlayerHeadshot sleeperId={player.sleeperId} position={player.position} name={player.name} size={48} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{player.name}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
              <PositionChip position={player.position} />
              {player.team ?? "FA"}
            </span>
          </span>
        </div>
        {placing ? (
          <PlaceAtRank
            playerName={player.name}
            maxRank={maxRank}
            board={boardNames}
            onPlace={(rank) => {
              setPlacing(false);
              onPlace(rank);
            }}
            focusOnMount
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPlacing(true)}
              className="inline-flex min-h-14 items-center justify-center rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Place him at a rank
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex min-h-14 items-center justify-center rounded-card border border-line px-4 text-sm font-semibold text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Keep comparing one at a time
            </button>
          </div>
        )}
      </div>
    </SlideUpDialog>
  );
}
