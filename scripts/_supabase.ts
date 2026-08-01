import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

export function getServiceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in env. Run with tsx --env-file=.env.local",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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

/**
 * Retry wrapper for any async Supabase operation that may hit transient
 * network errors. Supabase's edge proxies occasionally close the socket
 * mid-stream during long sync runs ("TypeError: fetch failed",
 * "UND_ERR_SOCKET other side closed", etc.) and most of those are safe
 * to retry, upserts with a unique constraint are idempotent, and SELECTs
 * just re-fetch the same rows.
 *
 * The callback should perform the supabase call and throw on .error so the
 * retry path catches both raw network exceptions and Supabase result errors.
 *
 * Pattern:
 *   await withRetry(async () => {
 *     const { error } = await supabase.from("...").upsert(chunk);
 *     if (error) throw error;
 *   }, { label: "player_value_history upsert" });
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
