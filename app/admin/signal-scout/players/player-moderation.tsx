"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideSignalScoutPlayer, unhideSignalScoutPlayer } from "../actions";
import { ADMIN_NOTE_MAX } from "../admin-constants";

/**
 * Row-level Hide/Unhide moderation for the Signal Scout Players admin table
 * (SS-T038). Hide opens an inline, labeled, required note textarea before
 * writing; unhide is a single button behind window.confirm, matching the OTC
 * reset convention for destructive confirms. router.refresh() re-renders the
 * server table (and the detail panel, if open) after a successful mutation.
 */
export function PlayerModeration({
  playerId,
  playerName,
  isHidden,
}: {
  playerId: string;
  playerName: string;
  isHidden: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [note, setNote] = useState("");

  const btnClass =
    "inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";
  const confirmBtnClass =
    "inline-flex min-h-11 items-center justify-center rounded-card border border-signal-danger/50 bg-signal-danger/10 px-3 text-xs font-semibold text-signal-danger transition-colors hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";

  function submitHide() {
    if (note.trim().length === 0) {
      setStatus("Failed: a note explaining the hide is required.");
      return;
    }
    startTransition(async () => {
      const result = await hideSignalScoutPlayer(playerId, note);
      if (result.ok) {
        setStatus("Hidden.");
        setShowNoteForm(false);
        setNote("");
        router.refresh();
      } else {
        setStatus(`Failed: ${result.error}`);
      }
    });
  }

  function submitUnhide() {
    const confirmed = window.confirm(`Unhide ${playerName} from the Signal Scout target pool?`);
    if (!confirmed) return;
    startTransition(async () => {
      const result = await unhideSignalScoutPlayer(playerId);
      if (result.ok) {
        setStatus("Unhidden.");
        router.refresh();
      } else {
        setStatus(`Failed: ${result.error}`);
      }
    });
  }

  return (
    <div className="flex min-w-[160px] flex-col gap-2">
      <p aria-live="polite" className="text-xs text-ink-muted">
        {isPending ? "Saving..." : status}
      </p>

      {isHidden ? (
        <button type="button" onClick={submitUnhide} disabled={isPending} className={btnClass}>
          Unhide
        </button>
      ) : (
        <>
          {/* Persistent toggle (never swapped out of the DOM) so keyboard focus
              survives opening the note form and the expanded state announces. */}
          <button
            type="button"
            onClick={() => setShowNoteForm((open) => !open)}
            aria-expanded={showNoteForm}
            aria-controls={`hide-note-region-${playerId}`}
            disabled={isPending}
            className={btnClass}
          >
            Hide
          </button>
          {showNoteForm ? (
        <div id={`hide-note-region-${playerId}`} className="flex flex-col gap-2">
          <label htmlFor={`hide-note-${playerId}`} className="text-xs font-semibold text-ink-subtle">
            Reason for hiding {playerName}
          </label>
          <textarea
            id={`hide-note-${playerId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={ADMIN_NOTE_MAX}
            required
            rows={2}
            className="w-full min-w-[200px] rounded-card border border-line bg-surface px-3 py-2 text-xs text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          <div className="flex gap-2">
            <button type="button" onClick={submitHide} disabled={isPending} className={confirmBtnClass}>
              Confirm hide
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNoteForm(false);
                setNote("");
                setStatus("");
              }}
              disabled={isPending}
              className={btnClass}
            >
              Cancel
            </button>
          </div>
        </div>
          ) : null}
        </>
      )}
    </div>
  );
}
