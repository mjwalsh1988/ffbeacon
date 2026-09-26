"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp, GripHorizontal, Plus, X } from "lucide-react";
import { MAX_TIER_BREAKS } from "@/lib/ranking-boards";

type Named = { name: string };

const smallButton =
  "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-card border border-line px-2 text-xs font-medium text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-8 sm:min-w-8";

/** Where a line after `rank` would fall, in words: "between Bijan Robinson
 * (2nd) and Jahmyr Gibbs (3rd)". Null when the rank is not strictly inside
 * the board. */
export function describeLinePlace(players: readonly Named[], rank: number): string | null {
  if (!Number.isInteger(rank) || rank < 1 || rank >= players.length) return null;
  return `between ${players[rank - 1].name} (rank ${rank}) and ${players[rank].name} (rank ${rank + 1})`;
}

/**
 * The ONE "Add tier break after rank..." control above the board (plan section
 * 7). A number field that says which two players the line would fall between
 * BEFORE it is applied, rather than a button between every pair of rows, which
 * on a 200 player board is 199 tab stops before the first player.
 */
export function AddTierBreakForm({
  players,
  breaks,
  onAdd,
}: {
  players: readonly Named[];
  breaks: readonly number[];
  onAdd: (rank: number) => void;
}) {
  const inputId = useId();
  const previewId = useId();
  const [value, setValue] = useState("");
  const rank = Number(value);
  const place = value.trim() === "" ? null : describeLinePlace(players, rank);
  const taken = breaks.includes(rank);
  const full = breaks.length >= MAX_TIER_BREAKS;
  const canAdd = place !== null && !taken && !full;

  let preview: string;
  if (full) preview = `A board can have at most ${MAX_TIER_BREAKS} tier lines.`;
  else if (players.length < 2) preview = "Add at least two players to draw a tier line.";
  else if (value.trim() === "") preview = `Pick a rank from 1 to ${players.length - 1}.`;
  else if (place === null) preview = `Pick a rank from 1 to ${players.length - 1}.`;
  else if (taken) preview = `There is already a line after rank ${rank}.`;
  else preview = `The line would fall ${place}.`;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canAdd) return;
        onAdd(rank);
        setValue("");
      }}
    >
      <div>
        <label htmlFor={inputId} className="block text-xs font-medium text-ink">
          Add tier break after rank
        </label>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.max(1, players.length - 1)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={previewId}
          className="mt-1 h-11 w-24 rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none sm:h-9 sm:text-sm"
        />
      </div>
      <button type="submit" disabled={!canAdd} className={`${smallButton} px-3`}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add line
      </button>
      <p id={previewId} className="w-full text-xs text-ink-muted">
        {preview}
      </p>
    </form>
  );
}

/**
 * One line's own controls (plan section 7): move up one, move down one, move to
 * after a chosen rank (stating who would sit either side before it is applied),
 * a drag handle for a pointer, and remove. Drag is never the only way.
 */
export function TierBreakLineControls({
  tier,
  rank,
  players,
  breaks,
  onMove,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  /** The tier that begins below this line. */
  tier: number;
  /** The rank the line falls after. */
  rank: number;
  players: readonly Named[];
  breaks: readonly number[];
  onMove: (from: number, to: number) => void;
  onRemove: (rank: number) => void;
  onDragStart: (rank: number) => void;
  onDragEnd: () => void;
}) {
  const inputId = useId();
  const previewId = useId();
  const [value, setValue] = useState("");
  const target = Number(value);
  const upBlocked = rank - 1 < 1 || breaks.includes(rank - 1);
  const downBlocked = rank + 1 >= players.length || breaks.includes(rank + 1);
  const place = value.trim() === "" ? null : describeLinePlace(players, target);
  const taken = target !== rank && breaks.includes(target);
  const canMove = place !== null && !taken && target !== rank;

  let preview: string;
  if (value.trim() === "" || place === null) {
    preview = `Pick a rank from 1 to ${players.length - 1}.`;
  } else if (target === rank) preview = "The line is already there.";
  else if (taken) preview = `There is already a line after rank ${target}.`;
  else preview = `Tier ${tier} would begin at rank ${target + 1}, ${place}.`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          onDragStart(rank);
        }}
        onDragEnd={onDragEnd}
        title="Drag the line onto a player to put it below him"
        aria-hidden="true"
        className="hidden cursor-grab text-ink-subtle sm:inline-flex"
      >
        <GripHorizontal className="h-4 w-4" />
      </span>
      <button
        type="button"
        onClick={() => onMove(rank, rank - 1)}
        disabled={upBlocked}
        aria-label={`Move the tier ${tier} line up one rank`}
        className={smallButton}
      >
        <ChevronUp aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onMove(rank, rank + 1)}
        disabled={downBlocked}
        aria-label={`Move the tier ${tier} line down one rank`}
        className={smallButton}
      >
        <ChevronDown aria-hidden="true" className="h-4 w-4" />
      </button>
      <details className="group relative">
        <summary className={`${smallButton} cursor-pointer list-none px-3`}>
          Move to rank
        </summary>
        <form
          className="absolute right-0 z-20 mt-1 w-72 rounded-card border border-line bg-surface-elevated p-3 shadow-2xl shadow-black/50"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canMove) return;
            onMove(rank, target);
            setValue("");
            (event.currentTarget.parentElement as HTMLDetailsElement | null)?.removeAttribute(
              "open",
            );
          }}
        >
          <label htmlFor={inputId} className="block text-xs font-medium text-ink">
            Move the tier {tier} line to after rank
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={1}
              max={Math.max(1, players.length - 1)}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-describedby={previewId}
              className="h-11 w-24 rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none sm:h-9 sm:text-sm"
            />
            <button type="submit" disabled={!canMove} className={`${smallButton} px-3`}>
              Move
            </button>
          </div>
          <p id={previewId} className="mt-2 text-xs text-ink-muted">
            {preview}
          </p>
        </form>
      </details>
      <button
        type="button"
        onClick={() => onRemove(rank)}
        aria-label={`Remove the tier ${tier} line`}
        className={`${smallButton} hover:border-signal-danger/60 hover:text-signal-danger`}
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
