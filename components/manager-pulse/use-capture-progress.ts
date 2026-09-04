"use client";

/**
 * Polls GET /api/manager-pulse/runs/[run_id] while a Manager Pulse capture
 * drains (docs/manager-pulse-plan.md 7.4), and hands back the real progress
 * that route reports: status, league counts, and per-section readiness.
 *
 * Takes the server-rendered `CaptureProgress` the page already has (from the
 * same `getManagerFootprint` call that decided to render the "building"
 * state) as the starting point, so the panel paints real numbers on first
 * render instead of a placeholder, then keeps it current by polling the same
 * run id.
 *
 * ABSOLUTE RULES:
 *   - Backoff, not a tight fixed interval. A capture takes minutes; polling it
 *     every second is a self-inflicted load test. Starts around 1500ms and
 *     eases toward roughly 8000ms. All four numbers (start delay, max delay,
 *     backoff factor, max consecutive failures) are overridable via the
 *     optional second argument, defaulting to today's values, so an admin
 *     settings group can drive them later without this hook changing again.
 *   - Stops on any terminal status ("complete" | "error" | "throttled") AND
 *     on "computing": the worker sets that status when it finishes reading
 *     leagues, but only a page render closes the run to "complete" (that
 *     happens inside `getManagerFootprint`), so a run that reaches
 *     "computing" needs a render, not another poll, to ever move again.
 *     `CaptureProgressPanel` is what triggers that render (`router.refresh()`
 *     on both "computing" and "complete"). Never polls forever.
 *   - Stops on unmount, and aborts the in-flight request so a slow response
 *     cannot update state after the component using it is gone.
 *   - Never throws. A failed poll (network error, non-200, bad JSON) keeps
 *     the last known progress on screen and retries with the same backoff; it
 *     does not blank the panel. After several consecutive failures it gives
 *     up quietly (`unavailable: true`) rather than polling forever against a
 *     run that will never answer.
 *   - Does not poll at all when `initial.status` is already terminal.
 */

import { useEffect, useRef, useState } from "react";
import type { CaptureProgress } from "@/lib/manager-pulse/types";

const DEFAULT_START_DELAY_MS = 1500;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_BACKOFF_FACTOR = 1.4;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 6;

/**
 * The four load-governing constants, overridable by the caller. Left
 * optional and defaulted rather than required: no settings group backs these
 * yet (they would live under `lib/manager-pulse/default-settings.ts`, owned
 * elsewhere), so today every caller passes nothing and gets the values above.
 */
export type CaptureProgressPollingOptions = {
  startDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  maxConsecutiveFailures?: number;
};

// "computing" is terminal FOR POLLING PURPOSES ONLY: the run cannot progress
// further without a render (see the file header), so continuing to poll it
// would just confirm "still computing" every few seconds forever. It is not
// terminal for the run itself, only for this hook's own loop.
const TERMINAL_STATUSES: ReadonlySet<CaptureProgress["status"]> = new Set([
  "computing",
  "complete",
  "error",
  "throttled",
]);

function isTerminal(status: CaptureProgress["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

type RunProgressResponse = {
  status: CaptureProgress["status"];
  leaguesTotal: number;
  leaguesDone: number;
  leaguesFailed: number;
  sectionStatus: CaptureProgress["sectionStatus"];
  detail: string | null;
};

function isRunProgressResponse(value: unknown): value is RunProgressResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === "string" &&
    typeof v.leaguesTotal === "number" &&
    typeof v.leaguesDone === "number" &&
    typeof v.leaguesFailed === "number" &&
    typeof v.sectionStatus === "object" &&
    v.sectionStatus !== null &&
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

export function useCaptureProgress(
  initial: CaptureProgress,
  polling?: CaptureProgressPollingOptions,
): CaptureProgressState {
  const startDelayMs = polling?.startDelayMs ?? DEFAULT_START_DELAY_MS;
  const maxDelayMs = polling?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const backoffFactor = polling?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const maxConsecutiveFailures = polling?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;

  const [progress, setProgress] = useState<CaptureProgress>(initial);
  const [isPolling, setIsPolling] = useState<boolean>(!isTerminal(initial.status));
  const [unavailable, setUnavailable] = useState(false);

  const runId = initial.runId;

  // Mutable, so a scheduled poll can be cancelled from the cleanup without
  // re-running the whole effect.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const delayRef = useRef<number>(startDelayMs);
  const failuresRef = useRef<number>(0);
  const stoppedRef = useRef<boolean>(false);

  useEffect(() => {
    stoppedRef.current = false;
    delayRef.current = startDelayMs;
    failuresRef.current = 0;

    if (isTerminal(initial.status)) {
      setIsPolling(false);
      return () => {
        stoppedRef.current = true;
      };
    }

    setIsPolling(true);
    setUnavailable(false);

    const stop = () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      setIsPolling(false);
    };

    const scheduleNext = () => {
      if (stoppedRef.current) return;
      const delay = delayRef.current;
      delayRef.current = Math.min(maxDelayMs, Math.round(delay * backoffFactor));
      timerRef.current = setTimeout(poll, delay);
    };

    const poll = async () => {
      if (stoppedRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/manager-pulse/runs/${runId}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }

        const body: unknown = await res.json();
        if (!isRunProgressResponse(body)) {
          throw new Error("unexpected response shape");
        }

        if (stoppedRef.current) return;

        failuresRef.current = 0;
        const next: CaptureProgress = {
          runId,
          status: body.status,
          leaguesTotal: body.leaguesTotal,
          leaguesDone: body.leaguesDone,
          leaguesFailed: body.leaguesFailed,
          sectionStatus: body.sectionStatus,
          detail: body.detail,
        };
        setProgress(next);

        if (isTerminal(next.status)) {
          stop();
          return;
        }

        scheduleNext();
      } catch {
        if (controller.signal.aborted || stoppedRef.current) return;

        failuresRef.current += 1;
        if (failuresRef.current >= maxConsecutiveFailures) {
          setUnavailable(true);
          stop();
          return;
        }

        // Keep the last known `progress` untouched. Retry with the same
        // backoff schedule rather than resetting it, so a flaky connection
        // does not turn into a tight retry loop.
        scheduleNext();
      }
    };

    void poll();

    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runId/initial.status identify the run; re-running on every new `initial` object reference (a fresh literal on each parent render) would restart polling for no reason. startDelayMs/maxDelayMs/backoffFactor/maxConsecutiveFailures are included so a genuine config change (not merely a new object identity) does restart the schedule.
  }, [runId, startDelayMs, maxDelayMs, backoffFactor, maxConsecutiveFailures]);

  return { progress, polling: isPolling, unavailable };
}
