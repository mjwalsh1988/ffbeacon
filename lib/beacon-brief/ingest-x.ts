/**
 * The Beacon Brief X ingestor (the only X-specific normalizer).
 *
 * Pulls a source's recent tweets via lib/x.ts and maps the raw v2 response to
 * BeaconBriefSourceItem[], resolving media, quoted/retweeted context, and native
 * edit linkage. Everything downstream (curate, worker) consumes the normalized
 * contract only, so a future source just needs its own ingestor producing the
 * same shape.
 */

import type { Database } from "@/lib/database.types";
import {
  getXUserByUsername,
  getXUserTweets,
  type XMedia,
  type XTimelineResponse,
  type XTweet,
  type XUser,
} from "@/lib/x";
import type {
  BeaconBriefMedia,
  BeaconBriefQuoted,
  BeaconBriefSourceItem,
} from "./types";

type NewsSource = Database["public"]["Tables"]["news_sources"]["Row"];

function mapMedia(
  keys: string[] | undefined,
  mediaById: Map<string, XMedia>,
): BeaconBriefMedia[] {
  if (!keys) return [];
  const out: BeaconBriefMedia[] = [];
  for (const key of keys) {
    const m = mediaById.get(key);
    if (!m) continue;
    const type: BeaconBriefMedia["type"] =
      m.type === "animated_gif"
        ? "gif"
        : m.type === "video"
          ? "video"
          : "photo";
    const url = m.url ?? m.preview_image_url ?? null;
    if (url) out.push({ type, url });
  }
  return out;
}

function buildQuoted(
  ref: XTweet | undefined,
  usersById: Map<string, XUser>,
  mediaById: Map<string, XMedia>,
): BeaconBriefQuoted | null {
  if (!ref) return null;
  const author = ref.author_id ? usersById.get(ref.author_id) : undefined;
  return {
    author_handle: author?.username ?? null,
    text: ref.text,
    media: mapMedia(ref.attachments?.media_keys, mediaById),
  };
}

/** Map a raw v2 timeline response to normalized items for one source. */
export function normalizeTimeline(
  resp: XTimelineResponse,
  source: NewsSource,
): BeaconBriefSourceItem[] {
  const tweets = resp.data ?? [];
  const mediaById = new Map<string, XMedia>(
    (resp.includes?.media ?? []).map((m) => [m.media_key, m]),
  );
  const usersById = new Map<string, XUser>(
    (resp.includes?.users ?? []).map((u) => [u.id, u]),
  );
  const refTweetsById = new Map<string, XTweet>(
    (resp.includes?.tweets ?? []).map((t) => [t.id, t]),
  );
  const sourceAuthor = source.external_account_id
    ? usersById.get(source.external_account_id)
    : undefined;

  return tweets.map((t) => {
    const chain = t.edit_history_tweet_ids ?? [];
    const isEdit = chain.length > 1 && chain[chain.length - 1] === t.id;
    const editOf = isEdit ? (chain[chain.length - 2] ?? null) : null;

    let quoted: BeaconBriefQuoted | null = null;
    let retweeted: BeaconBriefQuoted | null = null;
    for (const ref of t.referenced_tweets ?? []) {
      const refT = refTweetsById.get(ref.id);
      if (ref.type === "quoted")
        quoted = buildQuoted(refT, usersById, mediaById);
      else if (ref.type === "retweeted")
        retweeted = buildQuoted(refT, usersById, mediaById);
    }

    const author =
      (t.author_id ? usersById.get(t.author_id) : undefined) ?? sourceAuthor;
    const handle = author?.username ?? source.handle;

    return {
      source_type: "x",
      source_id: source.id,
      source_external_id: t.id,
      external_url: `https://x.com/${handle}/status/${t.id}`,
      author_handle: handle,
      author_display_name: author?.name ?? handle,
      text: t.text,
      media: mapMedia(t.attachments?.media_keys, mediaById),
      quoted,
      retweeted,
      is_native_edit: isEdit,
      edit_of_external_id: editOf,
      created_at: t.created_at ?? new Date().toISOString(),
      raw: t,
    } satisfies BeaconBriefSourceItem;
  });
}

export interface FetchSourceResult {
  items: BeaconBriefSourceItem[];
  newestId: string | null;
  accountId: string | null;
  ok: boolean;
  error?: string;
}

/**
 * Resolve the source account id (once), pull tweets after its cursor, and return
 * normalized items plus the newest id to advance the cursor. ok=false on any X
 * failure so the curation cron records a per-source error without throwing.
 */
export async function fetchSourceItems(
  source: NewsSource,
): Promise<FetchSourceResult> {
  let accountId = source.external_account_id;
  if (!accountId) {
    const user = await getXUserByUsername(source.handle);
    if (!user) {
      return {
        items: [],
        newestId: null,
        accountId: null,
        ok: false,
        error: "could not resolve handle",
      };
    }
    accountId = user.id;
  }

  const resp = await getXUserTweets(accountId, { sinceId: source.last_cursor });
  if (!resp) {
    return {
      items: [],
      newestId: null,
      accountId,
      ok: false,
      error: "timeline fetch failed",
    };
  }

  const items = normalizeTimeline(resp, {
    ...source,
    external_account_id: accountId,
  });
  const newestId = resp.meta?.newest_id ?? null;
  return { items, newestId, accountId, ok: true };
}
