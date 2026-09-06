import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acquireSleeperToken,
  pauseSleeperBudget,
  countSleeperCalls,
  isSleeperJobContext,
  SleeperTokenTimeoutError,
  _resetSleeperBudgetForTests,
} from "./sleeper-budget";

/** Matches the BURST_FRACTION (20%) baked into sleeper-budget.ts at the default 600/min. */
const BURST_CAPACITY_AT_600 = 120;

beforeEach(() => {
  vi.useFakeTimers();
  _resetSleeperBudgetForTests(600);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("acquireSleeperToken", () => {
  it("allows only the burst capacity immediately, then waits for a refill", async () => {
    for (let i = 0; i < BURST_CAPACITY_AT_600; i += 1) {
      await acquireSleeperToken();
    }

    let resolved = false;
    const pending = acquireSleeperToken().then(() => {
      resolved = true;
    });

    // Not enough time has passed yet for a token to refill (600/min needs 100ms for one).
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(60);
    await pending;
    expect(resolved).toBe(true);
  });

  it("outside a job, gives up and throws after the interactive deadline rather than blocking forever", async () => {
    pauseSleeperBudget(10_000);

    let threw: unknown = null;
    const pending = acquireSleeperToken().catch((err) => {
      threw = err;
    });

    // Still well inside the pause; nothing should have settled yet.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(threw).toBeNull();

    // Past the interactive deadline (a second or two), even though the pause
    // itself has 8+ seconds left.
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(threw).toBeInstanceOf(SleeperTokenTimeoutError);
  });

  it("inside a job (countSleeperCalls), waits out a long pause rather than timing out", async () => {
    pauseSleeperBudget(3_000);

    const { result } = await countSleeperCalls(async () => {
      let resolved = false;
      const pending = acquireSleeperToken().then(() => {
        resolved = true;
      });

      // Past where the interactive deadline would have fired.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1_500);
      await pending;
      return resolved;
    });

    expect(result).toBe(true);
  });

  it("an explicit deadlineMs overrides the default even inside a job", async () => {
    pauseSleeperBudget(10_000);

    const { result } = await countSleeperCalls(async () => {
      let threw: unknown = null;
      const pending = acquireSleeperToken({ deadlineMs: 500 }).catch((err) => {
        threw = err;
      });
      await vi.advanceTimersByTimeAsync(600);
      await pending;
      return threw;
    });

    expect(result).toBeInstanceOf(SleeperTokenTimeoutError);
  });

  it("an already-aborted signal rejects immediately without waiting", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(acquireSleeperToken({ signal: controller.signal })).rejects.toBeInstanceOf(
      SleeperTokenTimeoutError,
    );
  });
});

describe("pauseSleeperBudget", () => {
  it("makes the next job-context acquire wait at least the paused duration", async () => {
    pauseSleeperBudget(5000);

    const { result } = await countSleeperCalls(async () => {
      let resolved = false;
      const pending = acquireSleeperToken().then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(4000);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1500);
      await pending;
      return resolved;
    });

    expect(result).toBe(true);
  });
});

describe("countSleeperCalls", () => {
  it("counts only calls made inside its own callback when two run concurrently", async () => {
    const outer = async () => {
      const { calls, result } = await countSleeperCalls(async () => {
        await acquireSleeperToken();
        await acquireSleeperToken();
        return "outer";
      });
      return { calls, result };
    };
    const inner = async () => {
      const { calls, result } = await countSleeperCalls(async () => {
        await acquireSleeperToken();
        return "inner";
      });
      return { calls, result };
    };

    const [a, b] = await Promise.all([outer(), inner()]);
    expect(a).toEqual({ calls: 2, result: "outer" });
    expect(b).toEqual({ calls: 1, result: "inner" });
  });
});

describe("isSleeperJobContext", () => {
  it("is false outside countSleeperCalls and true inside it", async () => {
    expect(isSleeperJobContext()).toBe(false);

    const { result } = await countSleeperCalls(async () => isSleeperJobContext());
    expect(result).toBe(true);

    expect(isSleeperJobContext()).toBe(false);
  });
});
