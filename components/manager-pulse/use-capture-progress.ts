"use client";

/**
 * Polls GET /api/manager-pulse/runs/[run_id] while a Manager Pulse capture
 * drains (docs/manager-pulse/manager-pulse-plan.md 7.4), and hands back the real progress
 * that route reports: status, league counts, and per-section readiness.
 *
 * Takes the server-rendered `CaptureProgress` the page already has (from the
 * same `getManagerFootprint` call that decided to render the "building"
 * state) as the starting point, so the panel paints real numbers on first
 * render instead of a placeholder, then keeps it current by polling the same
 * run id.
 *
 * ABSOLUTE RULES:
 *   - A steady poll, not a backoff ramp. A successful poll schedules the next
 *     one at `pollIntervalMs` (2000ms by default); a failed poll schedules the
 *     next one at `failureBackoffMs` (8000ms by default). Both, plus
 *     `maxConsecutiveFailures`, are overridable via the optional second
 *     argument, defaulting to today's values, so an admin settings group can
 *     drive them later without this hook changing again.
 *   - Stops on a terminal status ("complete" | "error" | "throttled") only.
 *     "computing" keeps polling: once Phase 3's drainer lands, it is the thing
 *     that moves a run from "computing" to "complete", and the poll has to
 *     stay alive to see that happen. Until then, `capture-progress.tsx`'s
 *     existing `router.refresh()` on "computing" still fires once (it is
 *     keyed on the status value, not on the poll stopping), so behaviour in
 *     the interim is unchanged. Never polls forever regardless: a terminal
 *     status or repeated failure both end the loop.
 *   - Stops on unmount, and aborts the in-flight request so a slow response
 *     cannot update state after the component using it is gone.
 *   - Never throws. A failed poll (network error, non-200, bad JSON) keeps
 *     the last known progress on screen and retries after `failureBackoffMs`;
 *     it does not blank the panel. After several consecutive failures it gives
 *     up quietly (`unavailable: true`) rather than polling forever against a
 *     run that will never answer.
 *   - Does not poll at all when `initial.status` is already terminal.
 *
 * The scheduling loop itself (`createCaptureProgressPoller` below) carries no
 * React state and is exported so it can be unit tested directly: this repo has
 * no React rendering test harness (no jsdom, no @testing-library/react, no
 * react-test-renderer are installed), so a hook that only exposed its
 * behaviour through `useEffect` would be untestable. `useCaptureProgress`
 * itself is a thin wrapper that starts one poller per (runId, initial.status)
 * and forwards its callbacks into React state.
 */

import { useEffect, useState } from "react";
import type { CaptureProgress } from "@/lib/manager-pulse/types";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_FAILURE_BACKOFF_MS = 8000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 6;

/**
 * The poll's load-governing constants, overridable by the caller. Left
 * optional and defaulted rather than required: no settings group backs these
 * yet (they would live under `lib/manager-pulse/default-settings.ts`, owned
 * elsewhere), so today every caller passes nothing and gets the values above.
 */
export type CaptureProgressPollingOptions = {
  pollIntervalMs?: number;
  failureBackoffMs?: number;
  maxConsecutiveFailures?: number;
};

/** The three options above, always present (defaults already applied). */
type ResolvedPollingOptions = {
  pollIntervalMs: number;
  failureBackoffMs: number;
  maxConsecutiveFailures: number;
};

// "complete" | "error" | "throttled" only. "computing" is deliberately absent:
// once Phase 3's drainer lands it is what moves a run from "computing" onward,
// so the poll has to keep watching a run parked there instead of treating it
// as a dead end.
const TERMINAL_STATUSES: ReadonlySet<CaptureProgress["status"]> = new Set([
  "complete",
  "error",
  "throttled",
]);

function isTerminal(status: CaptureProgress["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

type RunProgressResponse = {
  status: CaptureProgress["status"];
  requestedAt: string;
  leaguesTotal: number;
  leaguesDone: number;
  leaguesFailed: number;
  leaguesProcessing: number;
  queueAhead: number;
  workerSeenAt: string | null;
  partialVersion: number;
  detail: string | null;
};

function isRunProgressResponse(value: unknown): value is RunProgressResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === "string" &&
    typeof v.requestedAt === "string" &&
    typeof v.leaguesTotal === "number" &&
    typeof v.leaguesDone === "number" &&
    typeof v.leaguesFailed === "number" &&
    typeof v.leaguesProcessing === "number" &&
    typeof v.queueAhead === "number" &&
    (v.workerSeenAt === null || typeof v.workerSeenAt === "string") &&
    typeof v.partialVersion === "number" &&
    (v.detail === null || typeof v.detail === "string")
  );
}

export type CaptureProgressState = {
  /** The most recently known progress: `initial` until the first poll lands, then whatever the API returned. */
  progress: CaptureProgress;
  /** True while the hook still intends to poll again. */
  polling: boolean;
  /** True once polling gave up after repeated failures. `progress` may still be stale-but-present. */
  unavailable: boolean;
};

/** What `createCaptureProgressPoller` reports back; wired to React state by the hook, to nothing by a test. */
export type CaptureProgressPollerHandlers = {
  /** Called after every successful poll, terminal or not. */
  onProgress: (progress: CaptureProgress) => void;
  /** Called once, the moment the poller gives up after `maxConsecutiveFailures`. */
  onUnavailable: () => void;
  /** Called once, whenever the poller stops for any reason (terminal status reached, gave up, or told to). */
  onStopped: () => void;
};

/**
 * The framework-independent scheduling core behind `useCaptureProgress`. See
 * the file header for the rules it implements. `fetchImpl` defaults to the
 * global `fetch`; a test supplies its own so it can control timing and
 * responses precisely under fake timers.
 */
export function createCaptureProgressPoller(
  runId: string,
  options: ResolvedPollingOptions,
  handlers: CaptureProgressPollerHandlers,
  fetchImpl: typeof fetch = fetch,
): { start: () => void; stop: () => void } {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
    handlers.onStopped();
  };

  const scheduleNext = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(poll, delay);
  };

  const poll = async () => {
    if (stopped) return;
    const thisController = new AbortController();
    controller = thisController;

    try {
      const res = await fetchImpl(`/api/manager-pulse/runs/${runId}`, {
        signal: thisController.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }

      const body: unknown = await res.json();
      if (!isRunProgressResponse(body)) {
        throw new Error("unexpected response shape");
      }

      if (stopped) return;

      failures = 0;
      const next: CaptureProgress = {
        runId,
        status: body.status,
        requestedAt: body.requestedAt,
        leaguesTotal: body.leaguesTotal,
        leaguesDone: body.leaguesDone,
        leaguesFailed: body.leaguesFailed,
        leaguesProcessing: body.leaguesProcessing,
        queueAhead: body.queueAhead,
        workerSeenAt: body.workerSeenAt,
        partialVersion: body.partialVersion,
        detail: body.detail,
      };
      handlers.onProgress(next);

      if (isTerminal(next.status)) {
        stop();
        return;
      }

      scheduleNext(options.pollIntervalMs);
    } catch {
      if (thisController.signal.aborted || stopped) return;

      failures += 1;
      if (failures >= options.maxConsecutiveFailures) {
        handlers.onUnavailable();
        stop();
        return;
      }

      // Keep the last known progress untouched (the caller never receives an
      // onProgress call for a failed poll). Retry after the failure backoff
      // rather than the normal interval, so a flaky connection does not turn
      // into a tight retry loop.
      scheduleNext(options.failureBackoffMs);
    }
  };

  return {
    start: () => {
      void poll();
    },
    stop,
  };
}

export function useCaptureProgress(
  initial: CaptureProgress,
  polling?: CaptureProgressPollingOptions,
): CaptureProgressState {
  const pollIntervalMs = polling?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const failureBackoffMs = polling?.failureBackoffMs ?? DEFAULT_FAILURE_BACKOFF_MS;
  const maxConsecutiveFailures = polling?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;

  const [progress, setProgress] = useState<CaptureProgress>(initial);
  const [isPolling, setIsPolling] = useState<boolean>(!isTerminal(initial.status));
  const [unavailable, setUnavailable] = useState(false);

  const runId = initial.runId;

  useEffect(() => {
    if (isTerminal(initial.status)) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    setUnavailable(false);

    const poller = createCaptureProgressPoller(
      runId,
      { pollIntervalMs, failureBackoffMs, maxConsecutiveFailures },
      {
        onProgress: setProgress,
        onUnavailable: () => setUnavailable(true),
        onStopped: () => setIsPolling(false),
      },
    );
    poller.start();

    return () => {
      poller.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runId/initial.status identify the run; re-running on every new `initial` object reference (a fresh literal on each parent render) would restart polling for no reason. pollIntervalMs/failureBackoffMs/maxConsecutiveFailures are included so a genuine config change (not merely a new object identity) does restart the schedule.
  }, [runId, pollIntervalMs, failureBackoffMs, maxConsecutiveFailures]);

  return { progress, polling: isPolling, unavailable };
}
