"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteBoard } from "./actions";

/**
 * Delete a board (and, via ON DELETE CASCADE, all of its player rows). Two-step
 * confirm so a single tap never destroys a board. The write goes through the
 * `deleteBoard` server action, which re-derives the caller and re-verifies
 * ownership before deleting; the owner-only RLS delete policy is the backstop.
 */
export function DeleteBoardButton({
  boardId,
  boardName,
}: {
  boardId: string;
  boardName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const statusId = useId();
  // A failed delete collapses back to the trash icon, which mounts a new
  // button in place of "Confirm delete" and the browser drops focus to
  // <body> the instant that happens. Send it back to the trash icon so a
  // keyboard or screen reader user doesn't lose their place.
  const triggerRef = useRef<HTMLButtonElement>(null);

  const remove = () => {
    startTransition(async () => {
      const result = await deleteBoard(boardId);
      if (result.ok) {
        router.refresh();
      } else {
        setConfirming(false);
        setError(result.error);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    });
  };

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          aria-label={`Delete board ${boardName}`}
          aria-describedby={error ? statusId : undefined}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:h-9 sm:w-9"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
        {error && (
          <p
            id={statusId}
            role="alert"
            className="max-w-[12rem] text-right text-xs text-signal-danger"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Confirm deleting board ${boardName}`}
        className="inline-flex h-11 items-center rounded-card border border-signal-danger/60 bg-signal-danger/10 px-3 text-xs font-semibold text-signal-danger hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50 sm:h-9"
      >
        {pending ? "Deleting..." : "Confirm delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="inline-flex h-11 items-center rounded-card border border-line px-3 text-xs font-medium text-ink-muted hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:h-9"
      >
        Cancel
      </button>
    </div>
  );
}
