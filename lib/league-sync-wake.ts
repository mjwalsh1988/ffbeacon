import "server-only";

/**
 * Ask the drainer to start a pass now rather than at the next cron tick.
 *
 * A POST to the worker route with the cron secret. The route acquires the
 * lease and schedules its own pass in after(), so this returns in a few
 * hundred milliseconds whether or not a pass started. Never throws: a wake
 * that fails costs at most one minute, which is what the cron tick is for.
 *
 * WHERE THE TARGET URL COMES FROM, AND WHY IT IS CHECKED
 *   VERCEL_URL is set by the platform itself, for the exact deployment that is
 *   currently running, and cannot be misconfigured by anything an operator
 *   edits; it is preferred whenever it is present. NEXT_PUBLIC_SITE_URL is a
 *   NEXT_PUBLIC_ variable: it is inlined into the client bundle and is treated
 *   organisationally as non-sensitive, precisely because anything reachable
 *   from the browser cannot be a secret. A wrong or stale value there (a
 *   preview deployment's env, a copied staging config, a changed setting)
 *   would otherwise silently carry CRON_SECRET, a real secret, to whatever
 *   host that variable names. So it is used only as a fallback, for
 *   environments Vercel does not supply VERCEL_URL for (local dev, a non-
 *   Vercel host), and only after it parses as a valid https URL; a non-https
 *   scheme or an unparsable value means the secret is not sent at all.
 *
 * CONSECUTIVE FAILURE COUNTING
 *   A wake that is silently intercepted (a bad or hijacked target absorbing
 *   the POST) looks identical, from here, to one that timed out: both land in
 *   the catch below as a generic failure. Counting consecutive failures and
 *   escalating the log once they pile up is the only way an operator would
 *   notice a wake that keeps failing for the same reason, rather than reading
 *   one warning that looks like every other transient one.
 */

const WORKER_PATH = "/api/cron/league-sync-worker";

/** Consecutive failures before a warning escalates to an error-level log. */
const ESCALATE_AFTER_FAILURES = 5;

let consecutiveFailures = 0;

/**
 * The base URL to wake, or null when nothing trustworthy is configured.
 *
 * VERCEL_URL has no scheme and no path: it is a bare host, always https on
 * Vercel's own runtime, so it is used directly. NEXT_PUBLIC_SITE_URL is only
 * trusted when VERCEL_URL is absent, and only once it parses as https.
 */
function resolveWakeBase(): string | null {
  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost}`;

  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    return parsed.protocol === "https:" ? configured.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

export async function wakeLeagueSyncWorker(reason: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  const base = resolveWakeBase();
  if (!base) {
    console.warn("[league-sync-wake] no trusted https target configured, refusing to wake");
    return;
  }

  try {
    await fetch(`${base}${WORKER_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-wake-reason": reason },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    consecutiveFailures = 0;
  } catch (err) {
    consecutiveFailures += 1;
    const message = err instanceof Error ? err.message : String(err);
    if (consecutiveFailures >= ESCALATE_AFTER_FAILURES) {
      console.error(
        `[league-sync-wake] wake failed ${consecutiveFailures} times in a row, the cron tick is now the only thing draining the queue:`,
        message,
      );
    } else {
      console.warn("[league-sync-wake] wake failed:", message);
    }
  }
}
