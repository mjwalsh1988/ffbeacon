/**
 * Transient-error retry helpers shared between CLI scripts and API routes.
 * Supabase edge proxies occasionally close sockets mid-stream on long syncs;
 * upserts with unique constraints are idempotent so retrying is safe.
 */

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { label?: string; maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const label = opts.label ?? "supabase";
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (thrown) {
      lastError = thrown;
      const msg = errorMessage(thrown);
      const transient = isTransientSupabaseError(msg);
      if (!transient || attempt === maxAttempts) throw thrown;
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(
        `  ${label} attempt ${attempt} failed (${msg}); retrying in ${backoffMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError ?? new Error("withRetry: exhausted retries without an error");
}

export async function chunkUpsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    await fn(slice);
  }
}

function errorMessage(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  if (thrown && typeof thrown === "object" && "message" in thrown) {
    const m = (thrown as { message: unknown }).message;
    return typeof m === "string" ? m : String(m);
  }
  return String(thrown);
}

function isTransientSupabaseError(msg: string): boolean {
  return /fetch failed|socket|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_SOCKET|other side closed|network|503|504|timeout/i.test(
    msg,
  );
}
