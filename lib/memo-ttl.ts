type Entry = { value: Promise<unknown>; expires: number };
const store = new Map<string, Entry>();

/**
 * Past this many live entries a miss also sweeps the expired ones out. The
 * store used to grow by one entry per distinct key for the life of the
 * process, because an expired entry was only replaced when its own key was
 * asked for again; a key asked for once (a period that has closed, a team
 * code nobody types twice) stayed referenced forever. The sweep is bounded
 * work on a rare path and keeps the Map at the size of what is actually live.
 */
const SWEEP_ABOVE = 256;

/**
 * In-process memo with a TTL, for reads whose answer changes only when an
 * admin saves a form, and at no other time. This is what closes the gap
 * React's `cache()` leaves open: `cache()` dedupes calls within ONE render,
 * but a reference table like format_configs or a settings row like
 * beam_settings gets re-read from Postgres on every fresh request, at about
 * 45 to 50 ms each, for bytes that have not changed since the admin last
 * saved. `memoTtl` holds the promise for `ttlMs` so the next miss on this
 * process is a plain in-memory read.
 *
 * The store is one Map, in one process. A serverless deploy runs many
 * processes, so a write on one instance is invisible to the others until
 * their own copy expires and they miss again, at most `ttlMs` later. That
 * lag is the tradeoff this function makes, and it is fine for admin-editable
 * settings; it would NOT be fine for anything that needs to be correct the
 * instant it is saved.
 *
 * NEVER use this for a user-scoped read, or for anything that depends on the
 * request's cookies or auth. The Map is global across every reader hitting
 * this process: a key built from one user's id, session, or preferences
 * would cache THAT user's answer and hand it to the next reader who asks,
 * whoever they are. That is a data leak between readers, not a performance
 * bug, and no TTL length makes it safe.
 *
 * A key built from a value the ADDRESS BAR chooses (a slug, a team code) is
 * allowed only when the caller has bounded and validated that value first,
 * because every distinct key is an entry until it is swept.
 */
export function memoTtl<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (store.size > SWEEP_ABOVE) {
    for (const [k, entry] of store) if (entry.expires <= now) store.delete(k);
  }
  const value = fn().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/**
 * Evicts every stored key starting with `prefix`, so the next read misses
 * and goes back to the database. Call this on THIS process right after an
 * admin save succeeds. Other processes still serve their stale copy until
 * their own entry expires; that is the documented lag above, not a bug in
 * this function.
 *
 * `except` keeps one key: a caller about to memoise under a new key can
 * evict its predecessors under the same prefix without evicting itself.
 */
export function bustMemo(prefix: string, except?: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix) && key !== except) store.delete(key);
}
