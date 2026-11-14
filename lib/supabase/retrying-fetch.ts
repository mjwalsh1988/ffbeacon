/**
 * The fetch every server-side Supabase client uses.
 *
 * A read that fails because the connection dropped is tried again at growing
 * intervals before the caller ever sees an error, so one bad moment between
 * the app and the database does not become an empty page or a cached empty
 * result. Only reads are retried (GET and HEAD): a read is safe to repeat,
 * while a write or an rpc call that timed out may already have happened.
 *
 * What counts as a bad moment: the request threw (socket closed, DNS, reset)
 * or the gateway answered 502, 503 or 504. Any other answer, a 4xx included,
 * is the database's real answer and is returned as it is.
 *
 * The waits total under 2.5 seconds, so a page that is going to fail still
 * fails quickly. Callers must still treat a returned error as a failure and
 * never as "no rows".
 */

export const READ_RETRY_DELAYS_MS: readonly number[] = [200, 600, 1500];

const RETRY_STATUSES = new Set([502, 503, 504]);

type FetchLike = typeof fetch;

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && "method" in input) return input.method.toUpperCase();
  return "GET";
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createRetryingFetch(
  customFetch?: FetchLike,
  delays: readonly number[] = READ_RETRY_DELAYS_MS,
): FetchLike {
  // The global fetch is looked up per call, not captured at import, so the
  // runtime's patched fetch (Next.js) or a test's stub is always the one used.
  const baseFetch: FetchLike = (input, init) => (customFetch ?? globalThis.fetch)(input, init);
  return async function retryingFetch(input, init) {
    const method = methodOf(input, init);
    if (method !== "GET" && method !== "HEAD") return baseFetch(input, init);

    const signal = init?.signal ?? null;
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= delays.length;
      try {
        const response = await baseFetch(input, init);
        if (last || !RETRY_STATUSES.has(response.status)) return response;
        // Free the socket before the next try.
        await response.body?.cancel().catch(() => undefined);
      } catch (thrown) {
        if (last || signal?.aborted) throw thrown;
      }
      await wait(delays[attempt], signal);
    }
  };
}

/** One shared instance; it holds no state. */
export const retryingFetch: FetchLike = createRetryingFetch();
