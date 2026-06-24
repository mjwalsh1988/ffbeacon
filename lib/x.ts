/**
 * X (Twitter) API v2 client for The Beacon Brief.
 *
 * Mirrors the lib/sleeper.ts contract: a private safeFetch<T> with an
 * AbortController timeout that returns null on any non-ok response or thrown
 * error, so callers and the curation cron degrade gracefully and never see
 * exceptions. Auth is a bearer token (X_BEARER_TOKEN, server-only). This module
 * returns raw typed X responses; normalization to BeaconBriefSourceItem lives in
 * lib/beacon-brief/ingest-x.ts (the only X-specific normalizer).
 *
 * Do not call api.twitter.com directly from anywhere else; add endpoints here.
 */

const BASE = "https://api.twitter.com/2";
const DEFAULT_TIMEOUT_MS = 20_000;

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.X_BEARER_TOKEN ?? ""}`,
    "user-agent": "ffbeacon/1.0",
  };
}

async function safeFetch<T>(
  path: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  if (!process.env.X_BEARER_TOKEN) {
    console.warn("[x] X_BEARER_TOKEN is not set; skipping request to", path);
    return null;
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
      console.warn("[x] non-ok response", response.status, path);
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    console.warn(
      "[x] request failed",
      path,
      err instanceof Error ? err.message : String(err),
    );
    return null;
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
): Promise<XUser | null> {
  const clean = handle.replace(/^@/, "").trim();
  const res = await safeFetch<{ data?: XUser }>(
    `/users/by/username/${encodeURIComponent(clean)}`,
  );
  return res?.data ?? null;
}

/**
 * Pull a user's recent tweets, newest first, optionally only those after
 * sinceId. Excludes replies at the API level but KEEPS retweets and quotes, so a
 * source that breaks news by retweeting a colleague (or quote-tweeting) is still
 * ingested with full context. Returns the raw v2 response (with includes) or null.
 */
export async function getXUserTweets(
  userId: string,
  opts: {
    sinceId?: string | null;
    maxResults?: number;
    paginationToken?: string | null;
  } = {},
): Promise<XTimelineResponse | null> {
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
 * Look up tweets by id. Deleted tweets are omitted from `data` and reported in
 * `errors`, so this doubles as the deletion check: a requested id missing from
 * `data` means it is gone at the source.
 */
export async function getXTweetsByIds(
  ids: string[],
): Promise<XTimelineResponse | null> {
  if (ids.length === 0) return { data: [] };
  const list = ids.slice(0, 100).join(",");
  return safeFetch<XTimelineResponse>(
    `/tweets?ids=${encodeURIComponent(list)}&${TWEET_QUERY}`,
  );
}
