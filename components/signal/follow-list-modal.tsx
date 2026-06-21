"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ImageWithFallback } from "@/components/image-with-fallback";
import {
  loadFollowList,
  type FollowListEntry,
} from "@/app/u/[handle]/follow-actions";

/**
 * Authenticated-only follower/following list, shown in a focus-trapped dialog
 * (anon viewers never get the trigger; they see only the public count). The list
 * is fetched on open and on tab change via the loadFollowList server action,
 * which returns only users with a live public Signal, so private/draft handles
 * are never exposed. The dialog reuses the proven mobile-menu focus model:
 * portal to document.body, role=dialog + aria-modal, Tab focus trap (both
 * directions), Escape to close, body scroll lock, and focus return to the
 * trigger on close.
 *
 * The two tabs are a labeled pair of aria-pressed buttons (not an ARIA tablist):
 * each toggles which list is shown, and a polite live region announces the
 * loaded result so a screen-reader user hears the count change.
 */

type Kind = "followers" | "following";

export function FollowListModal({
  open,
  onClose,
  profileUserId,
  displayName,
  initialKind = "followers",
}: {
  open: boolean;
  onClose: () => void;
  profileUserId: string;
  displayName: string;
  initialKind?: Kind;
}) {
  const [mounted, setMounted] = useState(false);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [entries, setEntries] = useState<FollowListEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const statusId = useId();
  // Bumped on each fetch so a slow earlier response cannot overwrite a newer tab.
  const requestSeq = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset to the requested tab each time the dialog opens.
  useEffect(() => {
    if (open) setKind(initialKind);
  }, [open, initialKind]);

  // Focus trap + scroll lock + focus return (mobile-menu pattern).
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Only restore focus if the trigger is still in the document.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  // Fetch the active list when open / tab changes.
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setStatus("loading");
    setErrorMsg(null);
    loadFollowList(profileUserId, kind).then((res) => {
      if (seq !== requestSeq.current) return; // a newer request superseded this
      if (res.ok) {
        setEntries(res.entries);
        setTruncated(res.truncated);
        setStatus("ready");
      } else {
        setEntries([]);
        setTruncated(false);
        setErrorMsg(res.error);
        setStatus("error");
      }
    });
  }, [open, kind, profileUserId]);

  if (!open || !mounted) return null;

  const noun = kind === "followers" ? "followers" : "following";
  const statusText =
    status === "loading"
      ? `Loading ${noun}...`
      : status === "error"
        ? (errorMsg ?? "Could not load that list.")
        : entries.length === 0
          ? `No ${noun} to show.`
          : `Showing ${entries.length}${truncated ? " of the most recent" : ""} ${
              entries.length === 1 && kind === "followers" ? "follower" : noun
            }.`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
      />
      <div
        ref={dialogRef}
        className="relative flex max-h-[80vh] w-full max-w-md flex-col rounded-card border border-line bg-surface-elevated p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {displayName}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div
          role="group"
          aria-label="Show followers or following"
          className="mb-3 inline-flex rounded-card border border-line p-0.5"
        >
          {(["followers", "following"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded-[inherit] px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                kind === k
                  ? "bg-brand-purple/15 text-ink"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {k === "followers" ? "Followers" : "Following"}
            </button>
          ))}
        </div>

        <p id={statusId} aria-live="polite" className="text-sm text-ink-muted">
          {statusText}
        </p>

        <ul
          role="list"
          aria-label={`${noun} of ${displayName}`}
          className="beacon-scroll mt-2 flex min-h-0 flex-col gap-1 overflow-y-auto"
        >
          {entries.map((entry) => (
            <li key={entry.handle}>
              <Link
                href={`/${entry.handle}`}
                onClick={onClose}
                className="flex min-h-11 items-center gap-3 rounded-card px-2 py-1.5 hover:bg-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <ImageWithFallback
                  src={entry.avatarUrl}
                  alt=""
                  size={36}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {entry.displayName}
                  </span>
                  <span className="block truncate font-mono text-xs text-ink-muted">
                    @{entry.handle}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
