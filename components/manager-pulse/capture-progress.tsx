"use client";

/**
 * The panel shown while a Manager Pulse capture is draining
 * (docs/manager-pulse/manager-pulse-audit-and-speed-plan.md MPS-T025): the real progress
 * bar, the counted line, the elapsed clock, the queue/liveness line, the
 * estimate, and the failed count.
 *
 * Called as
 *   <CaptureProgressPanel progress={progress} unavailable={unavailable} liveCoverage={...} />
 * from live-manager-report.tsx (MPS-T043). PRESENTATIONAL ONLY: this panel
 * does not poll. It used to call useCaptureProgress itself while the parent
 * ALSO called it and passed the result down as `initial`, which started two
 * independent pollers against the same run (one request per second per tab
 * instead of one per two, drifting against each other). The parent now polls
 * once and hands the resolved `progress` (and `unavailable`) straight through
 * as plain props.
 *
 * ABSOLUTE RULE: THE LIVE REGION ANNOUNCES ON MEANINGFUL CHANGE ONLY. A bar
 * that speaks every poll is unusable with a screen reader. The visible
 * numbers update every poll (a sighted reader can watch them), but the
 * `aria-live="polite"` region only gets new text on: a status change, the
 * league count crossing a multiple of five, the estimate's first appearance
 * (then at most once a minute), a live-report update (at most once every
 * thirty seconds), and completion. Priority when more than one of these is
 * true on the same poll: completion, then any other status change, then the
 * five-league crossing, then the estimate, then the live-report update -
 * only one sentence is ever spoken per poll.
 *
 * `detail` is server-written text (see the API route's own header) and is
 * rendered as a plain text node, never as HTML.
 *
 * The clock (ElapsedClock) is deliberately outside the live region: see that
 * component's own header for why a ticking clock must never be announced.
 *
 * Mobile: one column, nothing hidden, usable at 360px.
 */

import { useEffect, useRef, useState } from "react";
import type { CaptureProgress } from "@/lib/manager-pulse/types";
import { estimateRemaining } from "@/lib/manager-pulse/progress-estimate";
import { ProgressBar } from "./progress-bar";
import { ElapsedClock } from "./elapsed-clock";

const RUN_STATUS_LABEL: Record<CaptureProgress["status"], string> = {
  pending: "Queued",
  capturing: "Reading leagues",
  computing: "Building the report",
  complete: "Complete",
  error: "Could not finish",
  throttled: "Paused, too many recent runs",
};

/** How long a worker heartbeat may go quiet before the panel calls the run stalled. */
const WORKER_STALE_MS = 20_000;

/** Announcements never repeat inside this window, except for a fresh status change. */
const ESTIMATE_ANNOUNCE_MIN_GAP_MS = 60_000;
const LIVE_REPORT_ANNOUNCE_MIN_GAP_MS = 30_000;

export function CaptureProgressPanel({
  progress,
  unavailable = false,
  liveCoverage,
}: {
  progress: CaptureProgress;
  /** True once the parent's poller has given up after repeated failures. */
  unavailable?: boolean;
  /**
   * The newest live report's coverage figures, for the live-report
   * announcement only. `progress.partialVersion` tells this panel a live
   * report changed, but not what it now covers; only the parent (which
   * fetches that report) knows those two numbers, so it is passed straight
   * through rather than read via a getter. Null before any live report has
   * landed, or while the parent's fetch for the newest version is still in
   * flight - in that case the announcement is skipped and the checkpoint is
   * NOT considered spoken, so the next poll (or the one after the fetch
   * resolves) tries again rather than losing it.
   */
  liveCoverage?: { coverage: number; coverageTotal: number } | null;
}) {
  const [announcement, setAnnouncement] = useState("");
  const prevRunStatus = useRef<CaptureProgress["status"] | null>(null);
  // Seeded from whatever `progress` happens to be at first mount, not from
  // zero: a page that loads with a run already partway through (leaguesDone
  // at 12, say) must not immediately announce "12 of 44 leagues read" as
  // though a checkpoint had just been crossed.
  const prevDoneMultipleOfFive = useRef(Math.floor(progress.leaguesDone / 5));
  const lastEstimateAnnouncedAt = useRef<number | null>(null);
  const prevPartialVersion = useRef<number | null>(null);
  const lastLiveAnnouncedAt = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const prevStatus = prevRunStatus.current;
    const wasFirstRead = prevStatus === null;
    const statusJustChanged = !wasFirstRead && progress.status !== prevStatus;
    prevRunStatus.current = progress.status;

    let next: string | null = null;

    if (statusJustChanged && progress.status === "complete") {
      next = `Complete. ${progress.leaguesDone} of ${progress.leaguesTotal} leagues read.`;
    } else if (statusJustChanged) {
      next = RUN_STATUS_LABEL[progress.status];
    }

    // Every fifth league, crossing upward. Tracked by the multiple itself (not
    // a simple modulo) so a poll that jumps from 3 done to 12 done (a slow
    // poll landing after several leagues finished) still announces once,
    // rather than being skipped because leaguesDone never equalled exactly 10.
    const currentMultipleOfFive = Math.floor(progress.leaguesDone / 5);
    if (
      next === null &&
      progress.leaguesDone > 0 &&
      currentMultipleOfFive > prevDoneMultipleOfFive.current
    ) {
      next = `${progress.leaguesDone} of ${progress.leaguesTotal} leagues read.`;
    }
    prevDoneMultipleOfFive.current = currentMultipleOfFive;

    if (next === null && progress.status === "capturing") {
      const estimate = estimateRemaining({
        done: progress.leaguesDone,
        total: progress.leaguesTotal,
        elapsedMs: now - Date.parse(progress.requestedAt),
      });
      if (estimate) {
        const lastAt = lastEstimateAnnouncedAt.current;
        if (lastAt === null || now - lastAt >= ESTIMATE_ANNOUNCE_MIN_GAP_MS) {
          next = estimate;
          lastEstimateAnnouncedAt.current = now;
        }
      }
    }

    const wantsLiveAnnouncement =
      next === null &&
      progress.partialVersion > (prevPartialVersion.current ?? 0) &&
      now - lastLiveAnnouncedAt.current >= LIVE_REPORT_ANNOUNCE_MIN_GAP_MS;

    if (wantsLiveAnnouncement) {
      if (liveCoverage) {
        next = `Report updated with ${liveCoverage.coverage} of ${liveCoverage.coverageTotal} league-seasons.`;
        lastLiveAnnouncedAt.current = now;
        prevPartialVersion.current = progress.partialVersion;
      }
      // liveCoverage is null: the parent's fetch for this version has not
      // resolved yet. Deliberately leave prevPartialVersion where it is,
      // rather than marking this version seen, so the checkpoint is not lost
      // - the next poll (or the one after the fetch resolves) tries again.
    } else {
      prevPartialVersion.current = progress.partialVersion;
    }

    if (next !== null) setAnnouncement(next);
  }, [progress, liveCoverage]);

  const isWaiting =
    progress.status === "capturing" &&
    progress.workerSeenAt !== null &&
    Date.now() - Date.parse(progress.workerSeenAt) > WORKER_STALE_MS;

  // Queue position is stated whenever the API reports one, whatever the run's
  // own status: a cold lookup queued behind other work sits at "pending", not
  // "capturing", and a reader waiting on that has just as much reason to be
  // told. The wording deliberately avoids an ordinal ("249th"): since
  // migration 0263 the claim interleaves owners round-robin, so a queue of
  // 250 leagues does not mean 250 turns.
  const secondLine =
    progress.queueAhead > 0
      ? `${progress.queueAhead} league${progress.queueAhead === 1 ? "" : "s"} from other lookups still waiting`
      : isWaiting
        ? "Waiting for the next league"
        : progress.leaguesProcessing > 0
          ? `${progress.leaguesProcessing} in progress`
          : null;

  const estimateText =
    progress.status === "capturing"
      ? estimateRemaining({
          done: progress.leaguesDone,
          total: progress.leaguesTotal,
          elapsedMs: Date.now() - Date.parse(progress.requestedAt),
        })
      : null;

  const countLineId = `manager-pulse-progress-count-${progress.runId}`;
  const isRunning =
    progress.status !== "complete" && progress.status !== "error" && progress.status !== "throttled";

  return (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{RUN_STATUS_LABEL[progress.status]}</h2>
        {unavailable ? (
          <span className="text-xs text-ink-subtle">Could not check for updates</span>
        ) : null}
      </div>

      <div className="mt-3">
        <ProgressBar
          id={`manager-pulse-progress-${progress.runId}`}
          done={progress.leaguesDone}
          failed={progress.leaguesFailed}
          total={progress.leaguesTotal > 0 ? progress.leaguesTotal : null}
          processing={progress.leaguesProcessing}
          waiting={isWaiting}
          ariaLabelledBy={countLineId}
        />
        {/* Named by, not repeated after, the bar above: the bar's own
            aria-valuetext already carries this count, so a labelledby link
            gives the bar its name instead of the two being announced back to
            back as two separate copies of the same sentence. The id sits on
            the inner span, not this <p>: ElapsedClock is a sibling of the
            labelled text rather than a child of it, so the bar's accessible
            name does not recompute (and re-announce) every second the clock
            ticks. */}
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted">
          <span id={countLineId}>
            {progress.leaguesTotal > 0
              ? `${progress.leaguesDone} of ${progress.leaguesTotal} leagues read`
              : "Preparing to read leagues"}
          </span>
          <ElapsedClock requestedAt={progress.requestedAt} running={isRunning} />
        </p>
        {secondLine ? <p className="mt-1 text-xs text-ink-muted">{secondLine}</p> : null}
        {estimateText ? <p className="mt-1 text-xs text-ink-muted">{estimateText}</p> : null}
        {progress.leaguesFailed > 0 ? (
          <p className="mt-1 text-xs text-ink-muted">
            {progress.leaguesFailed} league{progress.leaguesFailed === 1 ? "" : "s"} could not be
            read
          </p>
        ) : null}
      </div>

      {progress.detail ? (
        <p className="mt-4 text-xs leading-relaxed text-ink-subtle">{progress.detail}</p>
      ) : null}
    </div>
  );
}
