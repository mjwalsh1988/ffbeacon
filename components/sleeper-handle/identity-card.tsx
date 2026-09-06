"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Settings2 } from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type {
  SavedSleeperHandle,
  SleeperViewer,
} from "@/lib/sleeper-handle/types";

export type IdentityCardStatus = "idle" | "loading" | "throttled" | "failed";

/**
 * "You are using this tool as @handle", and the way back out of it.
 *
 * The form is UNMOUNTED while the card is closed, not hidden. A hidden form
 * still holds a focusable input, so a keyboard reader tabbing through a page
 * that says it has no search box lands in one anyway. Change mounts it and
 * moves focus into it; Close or Escape unmounts it and returns focus to the
 * button that opened it.
 *
 * The status line is ONE `role="status"` region and it carries only the
 * auto-run's state. It never carries a clock, and it is only escalated to
 * `role="alert"` for the one case that genuinely interrupts: a saved handle
 * Sleeper no longer resolves, where the form also opens itself.
 */
export function SleeperIdentityCard({
  toolName,
  handle,
  viewer,
  headingLevel = 2,
  status = "idle",
  statusMessage,
  onRetry,
  children,
  manageHref = "/my-beacon/sleeper-leagues",
  clearHref,
  actions,
  changeLabel = "Change",
  compact = false,
  className = "",
}: {
  /** "League Pulse", "On The Clock", "the FAAB Calculator". */
  toolName: string;
  handle: SavedSleeperHandle;
  /** Present and `source: "url"` when a shareable link overrode the handle. */
  viewer?: SleeperViewer | null;
  headingLevel?: 1 | 2 | 3;
  status?: IdentityCardStatus;
  statusMessage?: string | null;
  /** Rendered for "throttled": the auto-run can simply be tried again. */
  onRetry?: () => void;
  /** The tool's own form. Mounted only while the disclosure is open. */
  children?: ReactNode;
  /**
   * The settings page the footer link points at. Pass null on the settings
   * page itself, where the link would point at the page the reader is on.
   */
  manageHref?: string | null;
  /** Where "Switch to your saved handle" goes, when the URL won. */
  clearHref?: string;
  /** Extra controls beside Change (Manager Pulse's "Open my own report"). */
  actions?: ReactNode;
  changeLabel?: string;
  /**
   * The same card, less tall.
   *
   * Nothing inside changes except its scale and where the footer link sits:
   * on a tool page this card is a STATUS LINE above the reader's leagues, not
   * a destination, and the whole point of hiding the search form was to put
   * the leagues near the top of the page. A full-size panel in its place gives
   * back exactly the vertical space that was saved.
   */
  compact?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const fromLink = viewer?.source === "url";
  const acting = fromLink ? viewer : null;

  // A saved handle Sleeper no longer resolves is the one case where the reader
  // has to do something, so the form opens itself rather than hiding the fix
  // behind a button they have no reason to press.
  const failed = status === "failed";
  useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);

  // WHY FOCUS ONLY MOVES ON A PRESS
  //   The form opens for two different reasons and only one of them is a
  //   request. When the reader presses Change, moving the caret into the field
  //   they just asked for is the whole point. When the form opens ITSELF
  //   because a saved handle stopped resolving, the reader is somewhere near
  //   the top of a page they just loaded, and teleporting them into a text box
  //   halfway down it is not help; it also races the `role="alert"` rendering
  //   in the same commit, and one of the two announcements is then lost.
  //   So the failure state announces and opens, and the reader arrives under
  //   their own steam.
  const moveFocusRef = useRef(false);

  useEffect(() => {
    if (!open || !moveFocusRef.current) return;
    moveFocusRef.current = false;
    // The frame matters: without it the node is not in the document yet.
    const frame = requestAnimationFrame(() => {
      const input = regionRef.current?.querySelector<HTMLElement>(
        "input:not([type='hidden']):not([disabled])",
      );
      input?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Focusing the button synchronously here would focus it while it still reads
  // "Close" and still carries aria-expanded="true", because React has not
  // re-rendered yet. A screen reader then announces the state the card just
  // left. The frame puts the focus move after the re-render, so what is
  // announced is what is on screen.
  const returnFocusRef = useRef(false);
  useEffect(() => {
    if (open || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    const frame = requestAnimationFrame(() => buttonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const close = useCallback(() => {
    returnFocusRef.current = true;
    setOpen(false);
  }, []);

  const openByRequest = useCallback(() => {
    moveFocusRef.current = true;
    setOpen(true);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    },
    [close],
  );

  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  const displayName = handle.displayName;
  const avatarId = acting ? acting.avatar : handle.avatar;

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-card border border-brand-cyan/30 bg-surface/40 ${
        compact ? "p-3" : "p-4 sm:p-5"
      } ${className}`}
    >
      <div
        className={`flex flex-wrap items-center gap-3 ${compact ? "" : "items-start"}`}
      >
        <SleeperAvatar avatarId={avatarId} title="" size={compact ? 32 : 40} />

        <div className="min-w-0 flex-1">
          <Heading
            id={headingId}
            className={`font-semibold tracking-tight text-ink ${
              compact ? "text-sm" : "text-base"
            }`}
          >
            {acting ? (
              <>
                Viewing as{" "}
                <span className="text-brand-cyan">@{acting.username}</span> from
                this link
              </>
            ) : (
              <>
                Using {toolName} as{" "}
                <span className="text-brand-cyan">@{handle.username}</span>
              </>
            )}
          </Heading>

          {!acting && displayName && displayName !== handle.username && (
            <p className="mt-1 text-sm text-ink-muted">
              Sleeper shows you as {displayName}.
            </p>
          )}

          {acting && (
            <p className="mt-1 text-sm text-ink-muted">
              {clearHref ? (
                <Link
                  href={clearHref}
                  className="text-brand-purple underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Switch to your saved handle, @{handle.username}
                </Link>
              ) : (
                <>Your saved handle is @{handle.username}.</>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {compact && manageHref && (
            <Link
              href={manageHref}
              className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-ink-subtle underline-offset-4 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />
              Manage
            </Link>
          )}
          {children && (
            <button
              ref={buttonRef}
              type="button"
              onClick={() => (open ? close() : openByRequest())}
              aria-expanded={open}
              aria-controls={formId}
              className="inline-flex h-11 min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {open ? "Close" : changeLabel}
            </button>
          )}
        </div>
      </div>

      {/* One status region for the whole card. Empty when there is nothing to
          say, which is most of the time. */}
      {/* Two nodes, not one node whose `role` flips. Changing an element's
          role after it is in the accessibility tree is among the least
          reliably handled mutations across NVDA, JAWS and VoiceOver: several
          combinations keep the politeness they first computed. Keying them
          apart means the node identity changes when the politeness does. Only
          one is ever mounted, so there is still one region on the card. */}
      {failed ? (
        <p
          key="identity-alert"
          role="alert"
          className="mt-3 min-h-[1.25rem] text-sm text-ink-muted empty:mt-0 empty:min-h-0"
        >
          {statusMessage ?? ""}
        </p>
      ) : (
        <p
          key="identity-status"
          role="status"
          className="mt-3 min-h-[1.25rem] text-sm text-ink-muted empty:mt-0 empty:min-h-0"
        >
          {statusMessage ?? ""}
        </p>
      )}

      {status === "throttled" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex h-11 min-h-11 items-center rounded-card border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Retry
        </button>
      )}

      {/* Unmounted while closed, on purpose. See the header. */}
      <div id={formId} ref={regionRef} onKeyDown={onKeyDown}>
        {open && children ? <div className="mt-4">{children}</div> : null}
      </div>

      {!compact && manageHref && (
        <p className="mt-4 text-sm">
          <Link
            href={manageHref}
            className="inline-flex items-center gap-1.5 text-ink-subtle underline-offset-4 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />
            Manage your Sleeper connection
          </Link>
        </p>
      )}
    </section>
  );
}
