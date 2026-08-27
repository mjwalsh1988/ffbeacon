"use client";

/**
 * Delete a saved draft, behind the shared confirmation dialog.
 *
 * A draft is two hours of somebody's evening, so this never deletes on a single
 * press. The dialog names the draft rather than saying "this item", because the
 * list can hold several and the confirmation is often read out loud rather than
 * looked at.
 *
 * IT SAYS SO AFTERWARDS, AND IT PUTS FOCUS SOMEWHERE. A destructive, stated
 * irreversible action that reports nothing is worse by ear than by eye: the row
 * simply stops existing, the confirm dialog hands focus back to a trash button
 * that has been removed with it, and focus lands on the body. So the parent is
 * told to announce the deletion and take focus, and this component says it too
 * for the moment before the list re-renders.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteTracker } from "./actions";

export function DeleteTrackerButton({
  trackerId,
  trackerName,
  onDeleted,
}: {
  trackerId: string;
  trackerName: string;
  /** Announce the deletion and move focus. Runs before the list re-renders. */
  onDeleted: (name: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setOpen(false);
    startTransition(async () => {
      const result = await deleteTracker(trackerId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      onDeleted(trackerName);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (pending) return;
          setOpen(true);
        }}
        aria-disabled={pending}
        aria-label={`Delete the draft ${trackerName}`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </button>

      {open && (
        <ConfirmDialog
          title="Delete this draft?"
          description={`Every pick you recorded in "${trackerName}" goes with it. This cannot be undone.`}
          confirmLabel="Delete draft"
          tone="danger"
          icon={Trash2}
          onConfirm={confirm}
          onCancel={() => setOpen(false)}
        />
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-signal-danger">
          {error}
        </p>
      )}
    </>
  );
}
