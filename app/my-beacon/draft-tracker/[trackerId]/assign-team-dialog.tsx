"use client";

/**
 * "Who took him?" One tap per team, in the shared slide-up dialog every other
 * modal on the site uses.
 *
 * The reader's own team is in the list even though the board has a Mine button
 * of its own, because this dialog is also how a pick lands on the right team
 * after it landed on the wrong one.
 *
 * "Not sure yet" is a real answer and deserves a real button. Somebody two beers
 * into a live draft often knows a player is gone before they know who called it,
 * and the alternative to recording that is leaving a drafted player on the board.
 *
 * `isMove` is what separates the two jobs this dialog does. Placing a player for
 * the first time, nothing is current, so nothing is marked current. Moving one
 * who is already off the board, the team he is on now is. Without that flag the
 * not-sure button read as the current choice on every ordinary pick, which told
 * a reader a decision had been made before they had made one.
 */

import { useId } from "react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { PlayerHeadshot } from "@/components/player-headshot";
import { HelpCircle } from "lucide-react";
import { teamLabel } from "@/lib/draft-tracker/order";
import type { TrackerPlayer } from "@/lib/draft-tracker/types";

export function AssignTeamDialog({
  player,
  playerName,
  teamCount,
  teamNames,
  myTeamSlot,
  isMove,
  currentSlot,
  onAssign,
  onClose,
}: {
  /** The player being placed. Null both when closed and when the pick's player
   *  is not on the current board, which is still a pick worth moving. */
  player: TrackerPlayer | null;
  /** Non-null whenever the dialog is open. Carries the name in either case. */
  playerName: string | null;
  teamCount: number;
  teamNames: string[];
  myTeamSlot: number;
  /** True when this is a correction to a pick already off the board. */
  isMove: boolean;
  /** The slot he is on already. Only meaningful when `isMove`. */
  currentSlot?: number | null;
  onAssign: (slot: number | null) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const open = playerName !== null;
  const slots = Array.from({ length: teamCount }, (_, i) => i);

  return (
    <SlideUpDialog
      open={open}
      onClose={onClose}
      label={playerName ? `Choose which team took ${playerName}` : "Choose a team"}
      labelledBy={headingId}
    >
      {playerName && (
        <div className="px-4 pb-4 sm:px-6">
          <div className="flex items-center gap-3 border-b border-line pb-4">
            {player && (
              <PlayerHeadshot sleeperId={player.sleeperId} name="" size={44} />
            )}
            <div className="min-w-0">
              <p className="text-base font-bold leading-tight text-ink">{playerName}</p>
              {player && (
                <p className="mt-0.5 text-xs text-ink-muted">
                  <span aria-hidden="true">
                    {player.position}
                    {player.positionRank}
                    {player.team ? `, ${player.team}` : ""}
                  </span>
                  <span className="sr-only">
                    {player.position} rank {player.positionRank}
                    {player.team ? `, ${player.team}` : ""}
                  </span>
                </p>
              )}
            </div>
          </div>

          <h2 id={headingId} className="mt-4 text-sm font-semibold text-ink">
            {isMove ? `Move ${playerName} to which team?` : "Who took him?"}
          </h2>

          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {slots.map((slot) => {
              const mine = slot === myTeamSlot;
              const current = isMove && currentSlot === slot;
              return (
                <li key={slot}>
                  <button
                    type="button"
                    onClick={() => onAssign(slot)}
                    aria-current={current ? "true" : undefined}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-card border px-3 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                      current
                        ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                        : mine
                          ? "border-brand-purple/50 bg-brand-purple/10 text-ink hover:border-brand-purple"
                          : "border-line bg-base text-ink hover:border-line-accent"
                    }`}
                  >
                    <span className="min-w-0 truncate">{teamLabel(teamNames, slot)}</span>
                    {(mine || current) && (
                      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        {current ? "On this team" : "You"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => onAssign(null)}
            aria-current={isMove && currentSlot === null ? "true" : undefined}
            className="mt-3 inline-flex min-h-11 w-full items-center gap-2 rounded-card border border-dashed border-line px-3 py-2.5 text-sm font-semibold text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <HelpCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            Not sure yet, just take him off the board
          </button>
        </div>
      )}
    </SlideUpDialog>
  );
}
