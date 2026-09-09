"use client";

/**
 * Rename one bookmark.
 *
 * Centred on desktop rather than the house right-hand rail, per the rule in
 * CLAUDE.md: this is a decision with one field in it, and a full-height panel
 * holding a single input would be mostly empty. The bottom sheet on a phone is
 * unchanged, as is everything about how the dialog is operated.
 *
 * Only the NAME changes. The page a bookmark points at is fixed at the moment
 * it was saved, because a bookmark whose destination could be edited is a
 * different and much sharper thing to hand a reader.
 *
 * NO CORNER CLOSE BUTTON, deliberately. SlideUpDialog focuses the first
 * focusable thing inside it, and with the corner button present that is the
 * corner button, so a reader opening a dialog whose entire content is one text
 * field heard "Rename bookmark, dialog, Close, button" and had to tab forward
 * to reach the only thing on the screen. Cancel below is the visible way out,
 * and Escape and a backdrop press are unaffected.
 */

import { useId, useState } from "react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { MAX_BOOKMARK_LABEL_LENGTH } from "@/lib/bookmarks/types";

export function RenameBookmarkDialog({
  open,
  currentLabel,
  path,
  busy,
  error,
  onCancel,
  onSave,
}: {
  open: boolean;
  currentLabel: string;
  /** Shown, read-only, so the reader can see which row they are renaming. */
  path: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (label: string) => void;
}) {
  const headingId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [value, setValue] = useState(currentLabel);

  // The dialog is unmounted between opens by its caller, so state starts fresh
  // every time and there is no stale draft to clear.
  return (
    <SlideUpDialog
      open={open}
      onClose={onCancel}
      label="Rename bookmark"
      labelledBy={headingId}
      showClose={false}
      desktopPlacement="center"
    >
      <form
        className="px-5 pb-5 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || value.trim().length === 0) return;
          onSave(value);
        }}
      >
        <h2 id={headingId} className="text-lg font-semibold text-ink">
          Rename bookmark
        </h2>
        <p id={hintId} className="mt-1 text-sm leading-relaxed text-ink-muted">
          {`This changes the name on your bookmark bar. It still opens ${path}.`}
        </p>

        <label
          htmlFor={inputId}
          className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-subtle"
        >
          Name
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={MAX_BOOKMARK_LABEL_LENGTH}
          required
          autoComplete="off"
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={error ? true : undefined}
          className="mt-1.5 h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />

        {error && (
          <p id={errorId} role="alert" className="mt-2 text-sm text-signal-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Cancel
          </button>
          {/* `aria-disabled`, so the button the reader just pressed does not
              become disabled underneath their focus and hand it to `body`.
              The submit handler above carries the same guard. */}
          <button
            type="submit"
            aria-disabled={busy || value.trim().length === 0 || undefined}
            aria-busy={busy}
            className="inline-flex h-11 items-center justify-center rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60"
          >
            {busy ? "Saving" : "Save name"}
          </button>
        </div>
      </form>
    </SlideUpDialog>
  );
}
