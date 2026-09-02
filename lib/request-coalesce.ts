/**
 * In-flight work deduplication, shared.
 *
 * A single page render fans out into several server components, and a user
 * hitting reload on a slow cold load starts a second render before the first
 * finishes. Without this, each of those repeats the same expensive work against
 * the same league. Keyed work shares one promise; the entry is dropped as soon
 * as it settles, so this is a request coalescer and NOT a cache. Two calls that
 * do not overlap in time both run.
 *
 * WHY IT LIVES HERE RATHER THAN IN lib/league-pulse.ts, WHERE IT STARTED.
 * `lib/league-manager-ledger.ts` needs the identical guarantee and is imported
 * BY league-pulse, so importing back the other way would close a cycle. It is
 * eight lines with no dependencies, so the module it belongs in is its own.
 *
 * The map is per process. On a multi-instance deploy two instances can each run
 * one copy, which is the same bound every other coalescer in this codebase has
 * and is exactly what the database-level guards (unique constraints, the
 * fingerprint gate, `try_claim_*` rows) are there for.
 */

const inFlight = new Map<string, Promise<unknown>>();

export function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const started = run();
  inFlight.set(key, started);
  void started.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key),
  );
  return started;
}
