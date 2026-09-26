"use client";

import { useId, useState } from "react";

/**
 * "Place him at a rank" (plan section 5.2). Accepts only ranks above his
 * current spot, and says who is at the chosen rank now ("Rank 8 is currently
 * Chris Olave"), so the reader knows who moves down. The label and that line
 * are read together: the line is the field's description.
 */
export function PlaceAtRank({
  playerName,
  maxRank,
  board,
  onPlace,
  focusOnMount = false,
}: {
  playerName: string;
  /** The lowest rank allowed. Every rank from 1 to this is above his current
   * spot. */
  maxRank: number;
  /** Names on the board, in order, for the "currently" line. */
  board: string[];
  onPlace: (rank: number) => void;
  /** The reader just asked to place him, so the field is the next thing they
   * need. Only ever set in answer to that request. */
  focusOnMount?: boolean;
}) {
  const inputId = useId();
  const descId = useId();
  const [value, setValue] = useState("");
  const rank = Math.trunc(Number(value));
  const valid = value.trim() !== "" && Number.isInteger(rank) && rank >= 1 && rank <= maxRank;
  const line = !value.trim()
    ? `Pick a rank from 1 to ${maxRank}. Everyone from that rank down moves down one.`
    : valid
      ? `Rank ${rank} is currently ${board[rank - 1] ?? "empty"}, who moves down one.`
      : `Pick a rank from 1 to ${maxRank}, above his current spot.`;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onPlace(rank);
      }}
    >
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          Place {playerName} at rank
        </label>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={maxRank}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={descId}
          // Set only right after the reader pressed "Place him at a rank" or
          // "Put him at", so focus follows their own request.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={focusOnMount}
          className="mt-1 min-h-11 w-28 rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none sm:text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={!valid}
        className="inline-flex min-h-11 items-center rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
      >
        Place him
      </button>
      <p id={descId} className="w-full text-xs text-ink-muted">
        {line}
      </p>
    </form>
  );
}
