/**
 * The Sleeper call budget.
 *
 * One token bucket per process, refilled continuously at `perMinute` tokens a
 * minute. Every Sleeper call (lib/sleeper.ts safeFetch) acquires a token first
 * and normally WAITS for one rather than being refused, so a burst spreads
 * itself out instead of hammering Sleeper. `pause(ms)` empties the bucket and
 * holds refills for `ms`, which is how a 429 slows down every caller in the
 * process, not just the one that received it.
 *
 * BURST CAPACITY IS A FRACTION OF perMinute, NOT ALL OF IT. A bucket that
 * refills to full capacity (perMinute) can, on a cold instance, hand out
 * perMinute tokens instantly: at the default 600/min that is 600 calls with no
 * spacing at all, which is a burst against Sleeper, not a budget. The steady
 * rate (how fast the bucket refills) is unchanged; only how much it can store
 * ahead of time is capped, at BURST_FRACTION (20%) of perMinute. That is
 * generous enough for the drainer to open several jobs at once without every
 * one of them queuing for a token, and small enough that a cold start, or many
 * concurrent job starts, cannot fire hundreds of requests in the same instant.
 *
 * ACQUIRING A TOKEN CAN TIME OUT, AND WHETHER IT DOES DEPENDS ON WHO IS ASKING.
 * `acquireSleeperToken` waits without a deadline (today's behavior, unchanged)
 * whenever it is called from inside `countSleeperCalls`, which is exactly the
 * queue worker's per-job scope (lib/league-bulk-sync.ts wraps one job's whole
 * Sleeper traffic in it). That is deliberate: a background job is allowed to
 * queue behind the budget or a pause, because nobody is staring at a spinner
 * waiting for it. Called from anywhere else, which is every interactive
 * request path (a league deep view, a lineup render, On The Clock's poller),
 * there is no such wrapper, so the wait is capped hard
 * (INTERACTIVE_TOKEN_DEADLINE_MS) and a caller that cannot get a token in time
 * gets a thrown SleeperTokenTimeoutError instead of blocking the render. A
 * caller may still pass an explicit `deadlineMs` or `signal` to override this,
 * but nothing in the codebase needs to today: the AsyncLocalStorage seam
 * already answers "job or interactive" for every existing call site.
 *
 * lib/sleeper.ts's safeFetch reads the same seam to decide whether a 429/503
 * is worth retrying: inside a job it waits out Retry-After and retries once,
 * same as before; outside one it returns null on the first refusal rather than
 * blocking an interactive render for up to 30 seconds. The whole-budget pause
 * is only ever triggered by a SECOND consecutive refusal inside a job, for the
 * same reason: a single interactive request's 429 is one data point, not
 * enough to conclude the whole process needs to slow down.
 *
 * With exactly one drainer (the lease in league_sync_worker_lease) this bucket
 * is the site's budget for queue traffic. If a second drainer is ever added,
 * `acquireSleeperToken` is the seam: its body moves to a database claim and
 * nothing else changes.
 *
 * Per-job counting uses AsyncLocalStorage so three concurrent jobs each count
 * their own calls, and it is the same store that tells acquireSleeperToken and
 * safeFetch whether they are running inside a job.
 *
 * Confirmed NOT problems by a prior review, so left alone here: the wait loop
 * below is tuned to about 10 wake-ups a second and is not a spin; the
 * AsyncLocalStorage overhead is not measurable; the bucket cannot deadlock or
 * leak, because pause() sets lastRefill = pausedUntil and refill() early-
 * returns while paused.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Counter = { calls: number };
const counterStore = new AsyncLocalStorage<Counter>();

/** Thrown by acquireSleeperToken when a bounded wait (the interactive path, or an
 * explicit deadline/signal) elapses before a token becomes available. */
export class SleeperTokenTimeoutError extends Error {
  constructor(message = "Timed out waiting for a Sleeper call budget token") {
    super(message);
    this.name = "SleeperTokenTimeoutError";
  }
}

/** How long an interactive (non-job) caller waits for a token before giving up
 * rather than blocking a page render. A second or two, deliberately short. */
const INTERACTIVE_TOKEN_DEADLINE_MS = 1500;

/** The fraction of perMinute a cold or long-idle bucket can hand out instantly.
 * The refill rate (perMinute) is unchanged; this only bounds the store. */
const BURST_FRACTION = 0.2;

function burstCapacityFor(perMinute: number): number {
  return Math.max(1, Math.round(perMinute * BURST_FRACTION));
}

/** True while running inside countSleeperCalls, which is exactly the queue
 * worker's per-job scope. Everything outside it is an interactive request. */
export function isSleeperJobContext(): boolean {
  return counterStore.getStore() !== undefined;
}

class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private pausedUntil = 0;
  private capacity: number;
  constructor(private perMinute: number) {
    this.capacity = burstCapacityFor(perMinute);
    this.tokens = this.capacity;
  }
  configure(perMinute: number) {
    this.perMinute = Math.max(1, perMinute);
    this.capacity = burstCapacityFor(this.perMinute);
    this.tokens = Math.min(this.tokens, this.capacity);
  }
  private refill() {
    const now = Date.now();
    if (now < this.pausedUntil) return;
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 60_000) * this.perMinute);
    this.lastRefill = now;
  }
  async acquire(deadlineMs?: number, signal?: AbortSignal): Promise<void> {
    const deadlineAt = deadlineMs === undefined ? null : Date.now() + deadlineMs;
    for (;;) {
      if (signal?.aborted) throw new SleeperTokenTimeoutError("Aborted while waiting for a Sleeper call budget token");
      this.refill();
      if (this.tokens >= 1 && Date.now() >= this.pausedUntil) {
        this.tokens -= 1;
        return;
      }
      if (deadlineAt !== null && Date.now() >= deadlineAt) {
        throw new SleeperTokenTimeoutError();
      }
      const wait = Math.max(50, Math.min(1000, ((1 - this.tokens) / this.perMinute) * 60_000));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  pause(ms: number) {
    this.tokens = 0;
    this.pausedUntil = Date.now() + ms;
    this.lastRefill = this.pausedUntil;
  }
}

const bucket = new TokenBucket(600);

export function configureSleeperBudget(perMinute: number): void {
  bucket.configure(perMinute);
}

/**
 * Acquire one token, waiting if none is available.
 *
 * Inside a queue job (countSleeperCalls), waits without a deadline: today's
 * behavior, unchanged. Outside one, waits at most INTERACTIVE_TOKEN_DEADLINE_MS
 * and throws SleeperTokenTimeoutError rather than blocking a render. Either can
 * be overridden with an explicit `deadlineMs` or `signal`, though no call site
 * needs to today.
 */
export async function acquireSleeperToken(opts?: {
  deadlineMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const deadlineMs = opts?.deadlineMs ?? (isSleeperJobContext() ? undefined : INTERACTIVE_TOKEN_DEADLINE_MS);
  await bucket.acquire(deadlineMs, opts?.signal);
  const c = counterStore.getStore();
  if (c) c.calls += 1;
}

export function pauseSleeperBudget(ms: number): void {
  bucket.pause(ms);
}

/** Run `fn` with its own call counter; returns the result and the count. */
export async function countSleeperCalls<T>(fn: () => Promise<T>): Promise<{ result: T; calls: number }> {
  const counter: Counter = { calls: 0 };
  const result = await counterStore.run(counter, fn);
  return { result, calls: counter.calls };
}

/** Test seam. Also clears a pause left over from a previous test, so tests stay isolated. */
export function _resetSleeperBudgetForTests(perMinute = 600): void {
  bucket.configure(perMinute);
  const b = bucket as unknown as {
    tokens: number;
    pausedUntil: number;
    lastRefill: number;
    capacity: number;
  };
  b.tokens = b.capacity;
  b.pausedUntil = 0;
  b.lastRefill = Date.now();
}
