"use client";

/**
 * Rename the teams mid draft.
 *
 * People set a room up as Team 1 through Team 12 and then learn who is who as
 * the night goes on, so this has to be reachable while the draft is running and
 * has to leave every recorded pick exactly where it is. Names are labels on
 * slots; the picks reference the slot, never the label.
 *
 * The save confirmation is announced HERE, inside the dialog, rather than by the
 * room behind it. Everything outside an aria-modal container is removed from the
 * accessibility tree, so a status region on the page underneath is one the reader
 * cannot hear until the dialog closes, by which point the message has been and
 * gone. Twelve names typed in and no confirmation at all is the version of this
 * that shipped first.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { Save } from "lucide-react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { MAX_TEAM_NAME_LENGTH } from "@/lib/draft-tracker/types";

export function TeamNamesDialog({
  open,
  teamCount,
  teamNames,
  myTeamSlot,
  onSave,
  onClose,
}: {
  open: boolean;
  teamCount: number;
  teamNames: string[];
  myTeamSlot: number;
  onSave: (names: string[]) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const fieldId = useId();
  const headingId = useId();
  const [draft, setDraft] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [pending, startTransition] = useTransition();

  // Reload the boxes from the saved names every time the dialog opens, so an
  // abandoned edit does not come back on the next open.
  useEffect(() => {
    if (!open) return;
    setDraft(Array.from({ length: teamCount }, (_, i) => teamNames[i] ?? ""));
    setError(null);
    setSaved("");
  }, [open, teamCount, teamNames]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // aria-disabled marks the button rather than `disabled`, which would blur it
    // mid-save, so the guard against a second submit has to live here.
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await onSave(draft);
      if (!result.ok) {
        setError(result.error ?? "That did not save. Try again.");
        return;
      }
      // Say it while the dialog is still open, then close a beat later so the
      // announcement is not cut off by the tree changing under it.
      setSaved("Team names saved.");
      window.setTimeout(onClose, 900);
    });
  };

  return (
    <SlideUpDialog
      open={open}
      onClose={onClose}
      label="Name the teams in this draft"
      labelledBy={headingId}
    >
      <form onSubmit={submit} className="px-4 pb-4 sm:px-6">
        <h2 id={headingId} className="text-base font-bold text-ink">
          Name the teams
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Leave any of them blank and it stays Team 1, Team 2, and so on. Picks
          already recorded stay exactly where they are.
        </p>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {draft.map((value, slot) => (
            <li key={slot}>
              <label
                htmlFor={`${fieldId}-${slot}`}
                className="block text-xs font-medium text-ink-muted"
              >
                Team {slot + 1}
                {slot === myTeamSlot ? " (you)" : ""}
              </label>
              <input
                id={`${fieldId}-${slot}`}
                value={value}
                maxLength={MAX_TEAM_NAME_LENGTH}
                placeholder={`Team ${slot + 1}`}
                autoComplete="off"
                onChange={(event) =>
                  setDraft((prev) => {
                    const next = prev.slice();
                    next[slot] = event.target.value;
                    return next;
                  })
                }
                className="mt-1 h-11 w-full rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-sm"
              />
            </li>
          ))}
        </ul>

        {/* One message, one urgency each. role="alert" is already assertive and
            role="status" already polite, so neither sits inside a second live
            region repeating it. */}
        <div className="min-h-[1.25rem]">
          {error && (
            <p role="alert" className="mt-2 text-sm text-signal-danger">
              {error}
            </p>
          )}
          <p role="status" className="mt-2 text-sm text-brand-cyan">
            {saved}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            aria-disabled={pending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
          >
            <Save aria-hidden="true" className="h-4 w-4" />
            {pending ? "Saving..." : "Save names"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-card border border-line px-4 text-sm font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Cancel
          </button>
        </div>
      </form>
    </SlideUpDialog>
  );
}
