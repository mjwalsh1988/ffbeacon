/**
 * IndexNow push: POST a batch of our own URLs to
 * https://api.indexnow.org/indexnow, which fans the notification out to every
 * participating engine (Bing, Yandex, Seznam, Naver, Yep, the Internet
 * Archive, Amazonbot) in one call. Google does not participate. Microsoft
 * also names IndexNow as a citation aid for Copilot.
 *
 * The key proves control of the host, not identity, so it is not a secret.
 * It lives in INDEXNOW_KEY (server-only env) and is also committed as
 * public/{key}.txt, whose content must be exactly the key. See
 * lib/indexnow.test.ts for the test that keeps the two in agreement.
 *
 * Server-only by construction: it reads process.env.INDEXNOW_KEY, which is
 * never exposed to the client, and its only callers are server-side (worker,
 * cron routes, the npm run indexnow script). It deliberately does not import
 * the "server-only" package guard: scripts/indexnow.ts runs this module
 * under tsx outside Next's bundler, where that guard's package is not
 * resolvable, matching lib/email/send.ts and lib/sleeper.ts, which are also
 * server-only outbound-HTTP modules without the guard.
 */
import { SITE } from "@/lib/site";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_TIMEOUT_MS = 20_000;

/** IndexNow accepts at most 10,000 URLs per submission. */
const MAX_URLS = 10_000;

export type SubmitIndexNowResult = { ok: boolean; status: number };

/** The host our URLs are submitted under, derived from SITE.url. */
function siteHost(): string {
  return new URL(SITE.url).host;
}

/**
 * Resolve one input to an absolute URL on our own host, or null when it names
 * a different host (those are dropped rather than submitted, since IndexNow
 * only accepts URLs for the host named in the payload).
 */
function resolveOwnUrl(input: string, host: string): string | null {
  if (input.startsWith("/")) {
    return `${SITE.url.replace(/\/+$/, "")}${input}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  return parsed.host === host ? parsed.toString() : null;
}

/**
 * Push a batch of our own URLs to IndexNow. Never throws: every failure
 * (missing key, empty list after resolution, network error, timeout,
 * non-2xx response) is returned as { ok: false, status } so a caller can fire
 * this right after a write without risking the write's own success.
 *
 * Relative paths ("/brief") expand against SITE.url; absolute URLs on any
 * other host are dropped. Results are de-duplicated and capped at 10,000.
 * With no key configured or nothing left to submit, this returns
 * { ok: false, status: 0 } without making a request. There is no retry loop:
 * a 429 is logged and dropped, not retried.
 */
export async function submitIndexNow(urls: string[]): Promise<SubmitIndexNowResult> {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    return { ok: false, status: 0 };
  }

  const host = siteHost();
  const deduped = new Set<string>();
  for (const url of urls) {
    const resolved = resolveOwnUrl(url, host);
    if (resolved) deduped.add(resolved);
  }
  const urlList = Array.from(deduped).slice(0, MAX_URLS);
  if (urlList.length === 0) {
    return { ok: false, status: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error("[indexnow] submit responded", response.status);
      return { ok: false, status: response.status };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    console.error("[indexnow] submit failed", err);
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
