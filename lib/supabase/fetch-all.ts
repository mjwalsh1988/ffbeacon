/**
 * Read every row a query matches, past the 1000-row cap.
 *
 * Supabase (PostgREST max-rows) returns at most 1000 rows per request and does
 * NOT error when a query matches more: it silently returns the first 1000. A
 * read that needs every row must page. Three rules, each one a bug this
 * project has shipped at least once:
 *
 * 1. PAGE AT 1000 EXACTLY. A larger page size ends the loop after the first
 *    page, because the capped page looks short. `.limit(5000)` does nothing.
 * 2. ORDER BY A UNIQUE KEY. Offset pages over an order with ties (a date, a
 *    week, a rank) can repeat or skip rows at every page boundary. The caller's
 *    `page` callback must end its order with a unique column (usually id).
 * 3. A FAILED PAGE IS AN ERROR. Stopping on error and returning the rows so
 *    far hands a partial answer to code that treats it as complete. This
 *    throws instead, so the caller's own error path (a retry state, a skipped
 *    cache write) runs.
 *
 * Usage:
 *   const rows = await fetchAllRows("rosters for league", (from, to) =>
 *     supabase.from("rosters").select("id, roster_id").eq("league_id", id)
 *       .order("id", { ascending: true }).range(from, to));
 */

export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { maxRows?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  const maxRows = opts.maxRows ?? 2_000_000;
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await page(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: read failed at row ${from}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < SUPABASE_PAGE_SIZE) return out;
    if (out.length >= maxRows) {
      throw new Error(`${label}: more than ${maxRows} rows; refusing to return a partial set.`);
    }
  }
}

/** How many id chunks run at once. Enough to overlap round trips, few enough
 *  that one report cannot take a meaningful share of the connection pool. */
export const CHUNK_CONCURRENCY = 4;

/**
 * Run `work` once per item with at most `limit` in flight, and return the
 * results in INPUT order, so a caller that concatenates them sees exactly what
 * a sequential loop would have produced. The first failure rejects the whole
 * call; items not yet started are not started.
 */
export async function mapWithConcurrency<I, R>(
  items: readonly I[],
  limit: number,
  work: (item: I, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const lanes = Math.max(1, Math.min(limit, items.length));
  const runLane = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index], index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, runLane));
  return results;
}

function chunksOf<K>(ids: readonly K[], chunkSize: number): K[][] {
  const out: K[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) out.push(ids.slice(i, i + chunkSize));
  return out;
}

/**
 * Run a read once per chunk of ids, for `.in()` lists too long for one URL
 * (a few hundred uuids is already past the limit). Each chunk is paged with
 * fetchAllRows, so a chunk that matches more than 1000 rows is still whole.
 * Chunks run CHUNK_CONCURRENCY at a time; the rows come back in chunk order.
 */
export async function fetchAllRowsInChunks<T, K>(
  label: string,
  ids: readonly K[],
  page: (chunk: K[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = 200,
): Promise<T[]> {
  const chunks = chunksOf(ids, chunkSize);
  const perChunk = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, (chunk, index) =>
    fetchAllRows(`${label} [chunk ${index + 1}]`, (from, to) => page(chunk, from, to)),
  );
  return perChunk.flat();
}

/**
 * Read every row a query matches by KEYSET paging on a unique, ordered key
 * (almost always `id`): each page asks for rows after the last key the
 * previous page ended on.
 *
 * Offset paging (`.range(from, to)`) makes Postgres find and discard every
 * earlier row on every page, so a read over a large `.in()` list gets slower
 * page by page. A keyset page starts at the right row through the index.
 *
 * The `page` callback must filter `key > after` when `after` is not null,
 * order by the key ascending, and `.limit(limit)`. The 1000-row rules above
 * still hold: a full page means there may be more, a short page ends the
 * walk, and a failed page throws rather than returning what was read so far.
 * A page whose last key did not move past the cursor also throws, because
 * that loop would otherwise never end.
 *
 * Usage:
 *   const rows = await fetchAllRowsByKeyset("matchups", (after, limit) => {
 *     let q = supabase.from("league_matchups").select("id, week")
 *       .eq("league_id", id).order("id", { ascending: true }).limit(limit);
 *     if (after !== null) q = q.gt("id", after);
 *     return q;
 *   }, (row) => row.id);
 */
export async function fetchAllRowsByKeyset<T, K extends string | number>(
  label: string,
  page: (after: K | null, limit: number) => PromiseLike<PageResult<T>>,
  keyOf: (row: T) => K,
  opts: { maxRows?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  const maxRows = opts.maxRows ?? 2_000_000;
  let cursor: K | null = null;
  for (;;) {
    const { data, error } = await page(cursor, SUPABASE_PAGE_SIZE);
    if (error) {
      throw new Error(`${label}: read failed after key ${String(cursor)}: ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < SUPABASE_PAGE_SIZE) return out;
    const last = keyOf(rows[rows.length - 1]);
    if (last === cursor || last === null || last === undefined) {
      throw new Error(`${label}: keyset cursor did not advance past ${String(cursor)}.`);
    }
    cursor = last;
    if (out.length >= maxRows) {
      throw new Error(`${label}: more than ${maxRows} rows; refusing to return a partial set.`);
    }
  }
}

/**
 * fetchAllRowsByKeyset once per chunk of ids, CHUNK_CONCURRENCY chunks at a
 * time, rows returned in chunk order.
 */
export async function fetchAllRowsInChunksByKeyset<T, K, C extends string | number>(
  label: string,
  ids: readonly K[],
  page: (chunk: K[], after: C | null, limit: number) => PromiseLike<PageResult<T>>,
  keyOf: (row: T) => C,
  chunkSize = 200,
): Promise<T[]> {
  const chunks = chunksOf(ids, chunkSize);
  const perChunk = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, (chunk, index) =>
    fetchAllRowsByKeyset(`${label} [chunk ${index + 1}]`, (after, limit) => page(chunk, after, limit), keyOf),
  );
  return perChunk.flat();
}
