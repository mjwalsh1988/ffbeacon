"use client";

import { useId } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { useLeagueSync, useStartLeagueSync } from "@/lib/league-sync-queue";

/**
 * The Sync control on a "Not yet synced" league row.
 *
 * Opening a league has always been what calculates it. That is still true, and
 * the row's link still says so. This is for the reader who wants the number
 * without leaving the list, which is the whole reason the list shows the number.
 *
 * Sized and shaped like the tags it sits beside, not like a form button: it
 * lives in a cell with two pills in it, and a full-height button there dominates
 * a row it is only an accessory to. The beacon gradient is what makes it read as
 * the one thing on the row you can press.
 *
 * TOUCH TARGET. The visible pill is small, so the BUTTON BOX carries the 44px
 * instead: `h-11` at mobile widths where a finger is doing the pressing, and
 * `md:h-auto` above that, so a desktop row is not padded out by space no mouse
 * needs. The pill inside is what you see; the button around it is what you hit.
 *
 * Unavailable states say why, always to a screen reader through
 * aria-describedby, and visibly only when something actually went wrong. A
 * permanent paragraph under every button was most of the bulk and told a sighted
 * reader what the countdown in the label already says.
 *
 * aria-disabled rather than the disabled attribute, because `disabled` drops the
 * button out of the tab order, so a reader cannot reach the control to hear why
 * it is unavailable.
 */

const SIZE = {
  sm: { pill: "gap-1 px-2 py-0.5 text-[10px]", icon: "h-2.5 w-2.5" },
  md: { pill: "gap-1.5 px-2.5 py-1 text-[11px]", icon: "h-3 w-3" },
} as const;

export function LeagueSyncButton({
  sleeperLeagueId,
  leagueName,
  size = "md",
  className = "",
}: {
  sleeperLeagueId: string;
  leagueName: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const view = useLeagueSync(sleeperLeagueId);
  const startSync = useStartLeagueSync();
  const statusId = useId();
  const dims = SIZE[size];

  const { phase, secondsRemaining, error, blockingLeagueName, canStart } = view;

  const label =
    phase === "syncing"
      ? "Syncing"
      : phase === "retry"
        ? "Retry"
        : phase === "cooldown"
          ? `${error ? "Retry" : "Wait"} ${secondsRemaining}s`
          : "Sync";

  // The reason, in one sentence. Always reaches a screen reader through
  // aria-describedby; only rendered visibly when it is an error.
  const status =
    phase === "syncing"
      ? `Syncing ${leagueName}. This can take a few seconds.`
      : phase === "blocked"
        ? blockingLeagueName
          ? `Waiting for ${blockingLeagueName} to finish. One league syncs at a time.`
          : "Waiting for another league to finish. One league syncs at a time."
        : phase === "cooldown"
          ? error
            ? `${error} Available again in ${secondsRemaining} ${secondsRemaining === 1 ? "second" : "seconds"}.`
            : `Available again in ${secondsRemaining} ${secondsRemaining === 1 ? "second" : "seconds"}.`
          : phase === "retry" && error
            ? `${error} Ready to try again.`
            : null;

  const ariaLabel = canStart
    ? phase === "retry"
      ? `Try syncing ${leagueName} again.`
      : `Sync ${leagueName} now to calculate its Power Pulse standing.`
    : `Sync ${leagueName}. Currently unavailable.`;

  const tone = canStart
    ? // The one pressable thing on the row, so it gets the brand gradient and
      // black text rather than another outlined pill.
      "border-transparent bg-beacon text-black shadow-[0_0_20px_-8px_rgba(168,85,247,0.9)] hover:opacity-90"
    : phase === "syncing"
      ? "border-transparent bg-beacon text-black opacity-70"
      : error
        ? "border-signal-danger/50 bg-signal-danger/10 text-signal-danger"
        : "cursor-not-allowed border-line-accent bg-base/70 text-ink-subtle";

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <button
        type="button"
        aria-disabled={!canStart}
        aria-label={ariaLabel}
        aria-describedby={status ? statusId : undefined}
        onClick={(event) => {
          // The button sits inside rows that are themselves links or open a
          // sheet. Neither should fire when the press was meant for this.
          event.preventDefault();
          event.stopPropagation();
          if (!canStart) return;
          startSync(sleeperLeagueId, leagueName);
        }}
        className="inline-flex h-11 items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:h-auto"
      >
        <span
          className={`inline-flex items-center whitespace-nowrap rounded-full border font-bold tracking-tight transition-opacity ${dims.pill} ${tone}`}
        >
          <RefreshCw
            aria-hidden="true"
            className={`${dims.icon} shrink-0 ${phase === "syncing" ? "animate-spin" : ""}`}
          />
          {label}
        </span>
      </button>
      {/* Present for assistive technology on every unavailable state; visible
          only when it is an error worth taking up a line for. */}
      <span
        id={statusId}
        className={
          error
            ? "block max-w-[14rem] text-[10px] leading-snug text-signal-danger"
            : "sr-only"
        }
      >
        {status}
      </span>
    </span>
  );
}

/**
 * What a row shows once Sync all has queued it (components/league-sync-all.tsx).
 *
 * Not a button. The reader has already asked for this league and the work is on
 * the server, so there is nothing here to press: the row is reporting, not
 * offering. It replaces the Sync button for exactly as long as the job is
 * queued or running, and the button comes back if the job fails, because that is
 * the point where there is something to do again.
 *
 * Sized to match the button it stands in for, so a list part way through a batch
 * does not jump around as rows change state. The label is real text in a plain
 * span, so a screen reader following the pointer finds it.
 */
export function LeagueQueuedBadge({
  leagueName,
  phase,
  size = "md",
  className = "",
}: {
  leagueName: string;
  phase: "pending" | "processing";
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const dims = SIZE[size];
  const syncing = phase === "processing";
  const Icon = syncing ? RefreshCw : Clock;

  return (
    <span
      className={`inline-flex h-11 items-center md:h-auto ${className}`}
      title={
        syncing
          ? `${leagueName} is syncing now.`
          : `${leagueName} is waiting its turn in the sync queue.`
      }
    >
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-full border font-bold tracking-tight ${dims.pill} ${
          syncing
            ? "border-transparent bg-beacon text-black opacity-70"
            : "border-line-accent bg-base/70 text-ink-muted"
        }`}
      >
        <Icon
          aria-hidden="true"
          className={`${dims.icon} shrink-0 ${syncing ? "animate-spin" : ""}`}
        />
        {syncing ? "Syncing" : "Queued"}
      </span>
    </span>
  );
}
