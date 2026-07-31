/**
 * X (Twitter) API v2 client for The Beacon Brief.
 *
 * Every endpoint returns a discriminated XResult rather than T | null. The old
 * null-on-failure contract (mirroring lib/sleeper.ts) threw away the one fact
 * that mattered most: WHY the call failed. On 2026-07-31 the developer account
 * ran out of API credits, X answered every request with HTTP 402, and the whole
 * pipeline recorded nothing but "timeline fetch failed" while retrying each job
 * five times and emailing on each one. Callers now get a classified XError and
 * can tell an account-wide outage (isXOutageKind) from one bad request.
 *
 * Auth is a bearer token (X_BEARER_TOKEN, server-only). This module returns raw
 * typed X responses; normalization to BeaconBriefSourceItem lives in
 * lib/beacon-brief/ingest-x.ts (the only X-specific normalizer).
 *
 * Billing note for anyone adding an endpoint: X meters READS PER RESOURCE
 * RETURNED, not per request. Asking for 100 ids in one call costs the same as
 * 100 calls for one id each; asking for posts you do not need is what costs
 * money. Batch for rate-limit headroom and latency, reduce the number of posts
 * fetched to reduce spend.
 *
 * Do not call api.twitter.com directly from anywhere else; add endpoints here.
 */

const BASE = "https://api.twitter.com/2";
const DEFAULT_TIMEOUT_MS = 20_000;

export type XErrorKind =
  /** HTTP 402: the developer account has no API credits. Account-wide. */
  | "credits"
  /** HTTP 401/403 or a missing token: bad, revoked, or unprivileged auth. Account-wide. */
  | "auth"
  /** HTTP 429: too many requests in the current window. Recovers on its own. */
  | "rate_limit"
  /** HTTP 404: this specific resource does not exist. Per-request. */
  | "not_found"
  /** Timeout, network error, 5xx, or anything unclassified. Per-request. */
  | "transient";

export interface XError {
  kind: XErrorKind;
  /** HTTP status, or null when the request never reached X. */
  status: number | null;
  /** Short human-readable reason, safe to store in a log row. */
  detail: string;
  /** Milliseconds to wait before retrying, when the response said so. */
  retryAfterMs: number | null;
}

export type XResult<T> = { ok: true; data: T } | { ok: false; error: XError };

/**
 * True when the failure is account-wide rather than specific to this request.
 * Retrying an individual job cannot fix either case: the balance has to be
 * topped up or the token replaced. Callers use this to trip a circuit breaker
 * instead of burning retries and sending an email per job.
 */
export function isXOutageKind(kind: XErrorKind): boolean {
  return kind === "credits" || kind === "auth";
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.X_BEARER_TOKEN ?? ""}`,
    "user-agent": "ffbeacon/1.0",
  };
}

function classify(status: number): XErrorKind {
  if (status === 402) return "credits";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 404) return "not_found";
  return "transient";
}

/**
 * Milliseconds until the rate-limit window reopens. X sends x-rate-limit-reset
 * as epoch SECONDS; retry-after is a delta in seconds. Clamped to an hour so a
 * malformed header cannot park a job indefinitely.
 */
function retryAfterFromHeaders(headers: Headers): number | null {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 3_600_000);
  }
  const reset = Number(headers.get("x-rate-limit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset * 1000 - Date.now();
    if (ms > 0) return Math.min(ms, 3_600_000);
  }
  return null;
}

/** X error bodies are `{title, detail, ...}`. Fall back to raw text, truncated. */
function describeBody(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { title?: string; detail?: string };
    const parts = [parsed.title, parsed.detail].filter(Boolean);
    if (parts.length > 0) return `HTTP ${status}: ${parts.join(" - ")}`;
  } catch {
    // not JSON; fall through
  }
  const trimmed = body.trim().slice(0, 200);
  return trimmed ? `HTTP ${status}: ${trimmed}` : `HTTP ${status}`;
}

async function safeFetch<T>(
  path: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<XResult<T>> {
  if (!process.env.X_BEARER_TOKEN) {
    return {
      ok: false,
      error: {
        kind: "auth",
        status: null,
        detail: "X_BEARER_TOKEN is not set",
        retryAfterMs: null,
      },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: authHeaders(),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const kind = classify(response.status);
      const detail = describeBody(response.status, body);
      console.warn("[x]", kind, detail, path);
      return {
        ok: false,
        error: {
          kind,
          status: response.status,
          detail,
          retryAfterMs:
            kind === "rate_limit"
              ? retryAfterFromHeaders(response.headers)
              : null,
        },
      };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch (err) {
    const detail =
      err instanceof Error && err.name === "AbortError"
        ? `request timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    console.warn("[x] request failed", path, detail);
    return {
      ok: false,
      error: { kind: "transient", status: null, detail, retryAfterMs: null },
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface XUser {
  id: string;
  name: string;
  username: string;
}

export interface XMedia {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
}

export interface XReferencedTweet {
  type: "retweeted" | "quoted" | "replied_to";
  id: string;
}

export interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  edit_history_tweet_ids?: string[];
  referenced_tweets?: XReferencedTweet[];
  attachments?: { media_keys?: string[] };
}

export interface XTimelineResponse {
  data?: XTweet[];
  includes?: {
    media?: XMedia[];
    tweets?: XTweet[];
    users?: XUser[];
  };
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    result_count?: number;
    next_token?: string;
  };
  errors?: unknown[];
}

/** Shared field/expansion set so timeline pulls and id lookups normalize identically. */
const TWEET_QUERY =
  "tweet.fields=created_at,edit_history_tweet_ids,referenced_tweets,attachments,author_id" +
  "&expansions=attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id,author_id" +
  "&media.fields=type,url,preview_image_url" +
  "&user.fields=username,name";

/** Resolve an X handle (without @) to its numeric account id. */
export async function getXUserByUsername(
  handle: string,
): Promise<XResult<XUser | null>> {
  const clean = handle.replace(/^@/, "").trim();
  const res = await safeFetch<{ data?: XUser }>(
    `/users/by/username/${encodeURIComponent(clean)}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.data ?? null };
}

/**
 * Pull a user's recent tweets, newest first, optionally only those after
 * sinceId. Excludes replies at the API level but KEEPS retweets and quotes, so a
 * source that breaks news by retweeting a colleague (or quote-tweeting) is still
 * ingested with full context.
 *
 * With sinceId set, a quiet period returns zero posts and therefore costs
 * nothing, which is why the 5-minute poll is cheap: spend tracks how much the
 * source posts, not how often we ask.
 */
export async function getXUserTweets(
  userId: string,
  opts: {
    sinceId?: string | null;
    maxResults?: number;
    paginationToken?: string | null;
  } = {},
): Promise<XResult<XTimelineResponse>> {
  const params = new URLSearchParams();
  params.set("max_results", String(opts.maxResults ?? 20));
  params.set("exclude", "replies");
  if (opts.sinceId) params.set("since_id", opts.sinceId);
  // Walk older pages within the same since_id window (used by the curator to drain
  // more than one page of backlog in a single poll). The token comes from a prior
  // response's meta.next_token.
  if (opts.paginationToken)
    params.set("pagination_token", opts.paginationToken);
  return safeFetch<XTimelineResponse>(
    `/users/${userId}/tweets?${params.toString()}&${TWEET_QUERY}`,
  );
}

/**
 * Look up tweets by id, up to 100 per call. Deleted tweets are omitted from
 * `data` and reported in `errors`, so this doubles as the deletion check: a
 * requested id missing from `data` means it is gone at the source.
 *
 * Callers MUST pass no more than 100 ids. Silently truncating (the previous
 * behaviour) would make the deletion sweep report every dropped id as deleted
 * and unpublish live articles, so an over-long list is a caller bug and is
 * reported as one.
 */
export async function getXTweetsByIds(
  ids: string[],
): Promise<XResult<XTimelineResponse>> {
  if (ids.length === 0) return { ok: true, data: { data: [] } };
  if (ids.length > 100) {
    return {
      ok: false,
      error: {
        kind: "transient",
        status: null,
        detail: `getXTweetsByIds called with ${ids.length} ids; the endpoint accepts 100`,
        retryAfterMs: null,
      },
    };
  }
  return safeFetch<XTimelineResponse>(
    `/tweets?ids=${encodeURIComponent(ids.join(","))}&${TWEET_QUERY}`,
  );
}
