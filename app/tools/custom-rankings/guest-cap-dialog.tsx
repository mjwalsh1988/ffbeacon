"use client";

import { useId } from "react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { StatReadout } from "@/components/dashboard-panel";

/** Where every sign-in link from the builder lands: the tool page, which sees
 * claim=1 with a signed-in reader and a guest cookie and carries the guest
 * board into the account. */
export const CLAIM_NEXT = "/tools/custom-rankings?claim=1";
export const LOGIN_HREF = `/login?next=${encodeURIComponent(CLAIM_NEXT)}`;

/**
 * The guest cap prompt (plan sections 8 and 13.5): a decision, so a centred
 * dialog. It says what the guest has and what an account adds, concretely,
 * and "Not now" leaves the board exactly as it is. Nothing a guest built is
 * lost by reaching the cap: it is carried into the account on sign-in.
 */
export function GuestCapDialog({
  open,
  cap,
  maxDepth,
  retentionHours,
  onClose,
}: {
  open: boolean;
  cap: number;
  /** The deepest an account's run can go (settings.builder.maxDepth). */
  maxDepth: number;
  retentionHours: number;
  onClose: () => void;
}) {
  const headingId = useId();
  return (
    <SlideUpDialog
      open={open}
      onClose={onClose}
      label={`You've ranked your top ${cap}`}
      labelledBy={headingId}
      desktopPlacement="center"
      closeLabel="Not now"
    >
      <div className="space-y-4 p-5 sm:p-6">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
          You&apos;ve ranked your top {cap}.
        </h2>
        <p className="text-sm text-ink-muted">
          Sign up or log in to keep this board, rank past {cap}, add tiers and share it. Your board
          so far comes with you.
        </p>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatReadout label="Your board so far" value={`Top ${cap}`} accent="ink" />
          <StatReadout label="With an account" value={`Up to ${maxDepth}`} accent="cyan" />
          <StatReadout label="Tiers" value="Yes" accent="purple" />
          <StatReadout label="Share link" value="Yes" accent="purple" />
        </dl>
        <p className="text-xs text-ink-subtle">
          Without an account, this board is deleted {retentionHours} hours after your last change.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href={LOGIN_HREF}
            className="inline-flex min-h-11 items-center rounded-card bg-beacon px-5 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Sign up
          </a>
          <a
            href={LOGIN_HREF}
            className="inline-flex min-h-11 items-center rounded-card border border-line px-5 text-sm font-semibold text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Log in
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-card px-4 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Not now
          </button>
        </div>
      </div>
    </SlideUpDialog>
  );
}
