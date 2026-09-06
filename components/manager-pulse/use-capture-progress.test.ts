/**
 * Unit tests for the scheduling core behind `useCaptureProgress`
 * (docs/manager-pulse/manager-pulse-audit-and-speed-plan.md MPS-T005).
 *
 * This repo has no React rendering test harness (no jsdom, no
 * @testing-library/react, no react-test-renderer are installed), so the hook
 * itself cannot be mounted here. `createCaptureProgressPoller` carries no
 * React state at all, exactly so its actual production scheduling logic (the
 * same function `useCaptureProgress` wraps in a `useEffect`) can be driven
 * directly with fake timers and a stubbed `fetch`, rather than reimplemented
 * for the test.
 *
 * Run directly with:
 *
 *   npx vitest run components/manager-pulse/use-capture-progress.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureProgressPoller } from "./use-capture-progress";
import type { CaptureProgress } from "@/lib/manager-pulse/types";

const RUN_ID = "run-1";

const OPTIONS = {
  pollIntervalMs: 2000,
  failureBackoffMs: 8000,
  maxConsecutiveFailures: 6,
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

function progressBody(status: CaptureProgress["status"]): unknown {
  return {
    status,
    requestedAt: "2026-09-05T12:00:00.000Z",
    leaguesTotal: 4,
    leaguesDone: 2,
    leaguesFailed: 0,
    leaguesProcessing: 1,
    queueAhead: 0,
    workerSeenAt: null,
    partialVersion: 0,
    detail: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCaptureProgressPoller", () => {
  it("schedules the next poll at pollIntervalMs after a successful poll", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(progressBody("capturing")));
    const onProgress = vi.fn();
    const poller = createCaptureProgressPoller(
      RUN_ID,
      OPTIONS,
      { onProgress, onUnavailable: vi.fn(), onStopped: vi.fn() },
      fetchImpl,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);

    // Nothing scheduled early.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // The remaining millisecond crosses the 2000ms mark.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("schedules the next poll at failureBackoffMs after a failed poll", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const poller = createCaptureProgressPoller(
      RUN_ID,
      OPTIONS,
      { onProgress: vi.fn(), onUnavailable: vi.fn(), onStopped: vi.fn() },
      fetchImpl,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(7999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up and reports unavailable after six consecutive failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const onUnavailable = vi.fn();
    const onStopped = vi.fn();
    const poller = createCaptureProgressPoller(
      RUN_ID,
      OPTIONS,
      { onProgress: vi.fn(), onUnavailable, onStopped },
      fetchImpl,
    );

    poller.start();
    // First poll, then five more retries at the failure backoff: six failures total.
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(OPTIONS.failureBackoffMs);
    }

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onStopped).toHaveBeenCalledTimes(1);

    // No further polls after giving up.
    await vi.advanceTimersByTimeAsync(OPTIONS.failureBackoffMs * 2);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("keeps polling on a 'computing' status instead of stopping", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(progressBody("computing")));
    const onProgress = vi.fn();
    const onStopped = vi.fn();
    const poller = createCaptureProgressPoller(
      RUN_ID,
      OPTIONS,
      { onProgress, onUnavailable: vi.fn(), onStopped },
      fetchImpl,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onStopped).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OPTIONS.pollIntervalMs);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onStopped).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OPTIONS.pollIntervalMs);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onStopped).not.toHaveBeenCalled();
  });

  it("stops on a terminal status and does not poll again", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(progressBody("complete")));
    const onStopped = vi.fn();
    const poller = createCaptureProgressPoller(
      RUN_ID,
      OPTIONS,
      { onProgress: vi.fn(), onUnavailable: vi.fn(), onStopped },
      fetchImpl,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onStopped).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OPTIONS.pollIntervalMs * 3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops immediately and aborts the in-flight request when told to", async () => {
    const abortSpy = vi.fn();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", abortSpy);
      return new Promise<Response>(() => {
        // Never resolves: the poll is stopped while it is still in flight.
      });
    });
    const onStopped = vi.fn();
    const poller = createCaptureProgressPoller(
      RUN_ID,
      OPTIONS,
      { onProgress: vi.fn(), onUnavailable: vi.fn(), onStopped },
      fetchImpl as unknown as typeof fetch,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(onStopped).toHaveBeenCalledTimes(1);
  });
});
