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

/**
 * Run a read once per chunk of ids, for `.in()` lists too long for one URL
 * (a few hundred uuids is already past the limit). Each chunk is paged with
 * fetchAllRows, so a chunk that matches more than 1000 rows is still whole.
 */
export async function fetchAllRowsInChunks<T, K>(
  label: string,
  ids: readonly K[],
  page: (chunk: K[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = 200,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    out.push(...(await fetchAllRows(`${label} [chunk ${i / chunkSize + 1}]`, (from, to) => page(chunk, from, to))));
  }
  return out;
}
