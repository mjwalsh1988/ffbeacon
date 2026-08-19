"use client";

import { useId, useRef, useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { SaveUsernameForm } from "./save-username-form";

/**
 * The Sleeper handle box at the top of My Sleeper Leagues.
 *
 * TWO STATES, BECAUSE THERE ARE TWO READERS
 *   Someone with no handle saved needs the pitch: what this field is for and
 *   why it is worth typing. Someone who saved theirs months ago needs one line
 *   confirming it is still right, and then to get past it. The old page gave
 *   both of them the pitch, so the first thing a returning reader saw every
 *   visit was a heading, a paragraph, and a form asking for something they had
 *   already given us, above the leagues they actually came for.
 *
 *   Connected, this collapses to a single row. The form is still one press away
 *   and nothing is removed, it is just no longer the first thing on the page.
 *
 * A DISCLOSURE, NOT A LINK. aria-expanded and aria-controls on the row, so a
 * screen reader hears that there is something to open and whether it is open,
 * and the field takes focus when it appears rather than leaving the reader to
 * hunt for what just changed.
 *
 * A SAVED HANDLE SLEEPER CANNOT FIND OPENS BY ITSELF. Collapsing a broken
 * connection behind a row that says everything is fine is how someone stares at
 * an empty league list without knowing the handle is the problem.
 */
export function SleeperConnection({
  savedUsername,
  /** True when Sleeper could not resolve the saved handle. Forces the form open. */
  lookupFailed = false,
}: {
  savedUsername: string;
  lookupFailed?: boolean;
}) {
  const formId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(lookupFailed);
  // Set once the reader opens the form themselves, so the field is focused on a
  // real press but not on a page load that happened to open it for them.
  const [openedByPress, setOpenedByPress] = useState(false);
  // The form's own "Saved" line goes with it when it collapses, so the
  // confirmation has to outlive it. This one sits on the row that replaces it.
  const [justSaved, setJustSaved] = useState(false);

  if (!savedUsername) {
    return (
      <>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Sleeper connection
          </p>
          <h2
            id="connect-heading"
            className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Link your Sleeper username.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            We save your handle so every visit auto-loads your leagues, no
            re-typing, no re-pasting. Change it anytime.
          </p>
        </div>
        <SaveUsernameForm defaultUsername="" />
      </>
    );
  }

  return (
    <>
      {/* The section still needs a name in the document outline; connected, it
          does not need to spend three lines of the page on one. */}
      <h2 id="connect-heading" className="sr-only">
        Sleeper connection
      </h2>

      <button
        ref={toggleRef}
        type="button"
        aria-expanded={editing}
        aria-controls={formId}
        onClick={() => {
          setEditing((prev) => !prev);
          setOpenedByPress(true);
          setJustSaved(false);
        }}
        className="flex min-h-12 w-full items-center gap-3 rounded-card border border-line bg-surface/60 px-4 py-3 text-left transition-colors hover:border-line-accent hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <CheckCircle2
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-signal-success"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
          Sleeper username saved as{" "}
          <span className="font-semibold text-ink">{savedUsername}</span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-brand-cyan">
          {editing ? "Close" : "Change it"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform ${
            editing ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Announced on save, and left in place afterwards rather than timed out:
          a message that erases itself is one a reader who looked away has no way
          to get back. It clears when the form is opened again. */}
      <p
        role="status"
        aria-live="polite"
        className={`mt-2 text-xs text-signal-success ${justSaved ? "" : "sr-only"}`}
      >
        {justSaved ? "Saved. Your leagues are reloading." : ""}
      </p>

      {/* Unmounted rather than hidden, so a collapsed form holds no focusable
          field for a keyboard reader to land in. */}
      <div id={formId}>
        {editing && (
          <SaveUsernameForm
            defaultUsername={savedUsername}
            autoFocus={openedByPress}
            onSaved={() => {
              setEditing(false);
              setJustSaved(true);
              // The field that had focus is about to unmount, and focus would
              // otherwise fall to the body, stranding a keyboard reader at the
              // top of the document. Hand it back to the control they pressed
              // to get here.
              toggleRef.current?.focus();
            }}
          />
        )}
      </div>
    </>
  );
}
