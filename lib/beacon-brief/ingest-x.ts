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
  getXTweetsByIds,
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
    let hasRetweetRef = false;
    for (const ref of t.referenced_tweets ?? []) {
      const refT = refTweetsById.get(ref.id);
      if (ref.type === "quoted")
        quoted = buildQuoted(refT, usersById, mediaById);
      else if (ref.type === "retweeted") {
        hasRetweetRef = true;
        retweeted = buildQuoted(refT, usersById, mediaById);
      }
    }

    const author =
      (t.author_id ? usersById.get(t.author_id) : undefined) ?? sourceAuthor;
    const handle = author?.username ?? source.handle;

    // A retweet's own text is the truncated "RT @user: ..." stub; the full content
    // lives on the retweeted tweet. When we resolved it, promote that text so the
    // Discord card, the classifier, and the article writer all see the complete
    // post. A tweet that carries BOTH a retweet and a quote ref is treated as a
    // retweet (the retweet is the rebroadcast that matters). When the retweet ref
    // exists but could not be resolved (deleted/withheld/unhydrated), we keep the
    // stub text and flag it so the curator never builds an article from it (F2).
    const isRetweet = retweeted !== null;
    const retweetUnresolved = hasRetweetRef && retweeted === null;
    const primaryText =
      isRetweet && retweeted?.text ? retweeted.text : t.text;

    return {
      source_type: "x",
      source_id: source.id,
      source_external_id: t.id,
      external_url: `https://x.com/${handle}/status/${t.id}`,
      author_handle: handle,
      author_display_name: author?.name ?? handle,
      text: primaryText,
      media: mapMedia(t.attachments?.media_keys, mediaById),
      quoted,
      retweeted,
      retweet_unresolved: retweetUnresolved,
      is_native_edit: isEdit,
      edit_of_external_id: editOf,
      created_at: t.created_at ?? new Date().toISOString(),
      raw: t,
    } satisfies BeaconBriefSourceItem;
  });
}

/**
 * Repair the quoted/retweeted context that the timeline expansion leaves
 * incomplete. Two gaps:
 *   1. The expansion hydrates media only for top-level tweets, so a retweet/quote
 *      of an image post arrives with the referenced tweet's media_keys but no
 *      media object, and the image is lost.
 *   2. A referenced tweet can be missing from `includes.tweets` entirely (not
 *      returned by the expansion), so its text and author cannot resolve, which
 *      would leave a retweet as a truncated "RT @user:" stub.
 * We collect every referenced tweet that is missing, or present but with
 * unhydrated media, look them up by id (where they ARE primary, so tweet, author,
 * and media all hydrate), and merge tweets + users + media back into the response
 * in place before normalization. Best-effort: getXTweetsByIds returns null on
 * failure (it never throws) and is null-guarded here, so a failed repair only
 * means some context is missing, never that the poll fails.
 */
async function hydrateReferences(resp: XTimelineResponse): Promise<void> {
  const haveTweets = new Set((resp.includes?.tweets ?? []).map((t) => t.id));
  const haveMedia = new Set((resp.includes?.media ?? []).map((m) => m.media_key));
  const haveUsers = new Set((resp.includes?.users ?? []).map((u) => u.id));

  const needIds = new Set<string>();
  // Referenced tweets missing from includes entirely (so their text/author cannot
  // resolve) - the retweet-stub gap (F2/F5).
  for (const t of resp.data ?? []) {
    for (const ref of t.referenced_tweets ?? []) {
      if (!haveTweets.has(ref.id)) needIds.add(ref.id);
    }
  }
  // Referenced tweets present but whose media was not hydrated - the image gap.
  for (const t of resp.includes?.tweets ?? []) {
    for (const key of t.attachments?.media_keys ?? []) {
      if (!haveMedia.has(key)) {
        needIds.add(t.id);
        break;
      }
    }
  }
  if (needIds.size === 0) return;

  const lookup = await getXTweetsByIds([...needIds]);
  if (!lookup) return;

  const tweets = resp.includes?.tweets ?? [];
  for (const t of lookup.data ?? []) {
    if (!haveTweets.has(t.id)) {
      tweets.push(t);
      haveTweets.add(t.id);
    }
  }
  const media = resp.includes?.media ?? [];
  for (const m of lookup.includes?.media ?? []) {
    if (!haveMedia.has(m.media_key)) {
      media.push(m);
      haveMedia.add(m.media_key);
    }
  }
  const users = resp.includes?.users ?? [];
  for (const u of lookup.includes?.users ?? []) {
    if (!haveUsers.has(u.id)) {
      users.push(u);
      haveUsers.add(u.id);
    }
  }
  resp.includes = { ...resp.includes, tweets, media, users };
}

export interface FetchSourceResult {
  items: BeaconBriefSourceItem[];
  newestId: string | null;
  accountId: string | null;
  ok: boolean;
  error?: string;
  /**
   * True when the source had more than the page budget of new posts in one poll,
   * so the very oldest new posts (beyond MAX_TIMELINE_PAGES) were not fetched this
   * run. The curator processes what was fetched and advances the cursor, so that
   * unfetched older tail IS skipped. This is a deliberate, bounded tradeoff:
   *
   *   - It is practically unreachable: it needs MAX_TIMELINE_PAGES * the page size
   *     (500) new posts between two polls of the same source.
   *   - The curator logs a warning so the rare case is visible, not silent.
   *   - Do NOT "fix" this by bailing without advancing the cursor: because the API
   *     returns newest-first under since_id, a bail would re-fetch the same newest
   *     500 every run, truncate again, and never advance, stalling the source
   *     entirely (even the newest posts would stop flowing). Reaching the old tail
   *     would require a separate until_id drain cursor that pages from the old end
   *     across runs, which is a redesign, not a tweak. Until then, dropping the
   *     ancient tail is the lesser evil versus a full stall.
   */
  truncatedByPageBudget?: boolean;
}

// One poll may walk several pages so a backlog larger than one page is not
// permanently skipped (F6). Bounded so a runaway source cannot loop or exhaust
// the X rate limit: at most MAX_TIMELINE_PAGES requests per source per poll.
const TIMELINE_PAGE_SIZE = 100;
const MAX_TIMELINE_PAGES = 5;

/**
 * Resolve the source account id (once), pull tweets after its cursor (paginating
 * up to the page budget), hydrate referenced context, and return normalized items
 * plus the newest id to advance the cursor. ok=false on any X failure so the
 * curation cron records a per-source error without throwing. A failure on a page
 * after the first also returns ok=false: we hold only the newer items and the
 * older tail is unknown, so advancing the cursor would skip it, the safe move is
 * to process nothing and retry the whole window next run.
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

  const data: XTweet[] = [];
  const mediaById = new Map<string, XMedia>();
  const tweetsById = new Map<string, XTweet>();
  const usersById = new Map<string, XUser>();
  let newestId: string | null = null;
  let pageToken: string | null | undefined;
  let pages = 0;
  let truncatedByPageBudget = false;

  for (;;) {
    const resp = await getXUserTweets(accountId, {
      sinceId: source.last_cursor,
      maxResults: TIMELINE_PAGE_SIZE,
      paginationToken: pageToken,
    });
    if (!resp) {
      return {
        items: [],
        newestId: null,
        accountId,
        ok: false,
        error:
          pages === 0
            ? "timeline fetch failed"
            : "timeline pagination failed mid-stream",
      };
    }
    // The first page is the newest, so newest_id from it is the high-water mark.
    if (pages === 0) newestId = resp.meta?.newest_id ?? null;
    for (const t of resp.data ?? []) data.push(t);
    for (const m of resp.includes?.media ?? [])
      if (!mediaById.has(m.media_key)) mediaById.set(m.media_key, m);
    for (const t of resp.includes?.tweets ?? [])
      if (!tweetsById.has(t.id)) tweetsById.set(t.id, t);
    for (const u of resp.includes?.users ?? [])
      if (!usersById.has(u.id)) usersById.set(u.id, u);
    pages += 1;
    pageToken = resp.meta?.next_token;
    if (!pageToken) break;
    if (pages >= MAX_TIMELINE_PAGES) {
      truncatedByPageBudget = true;
      break;
    }
  }

  const combined: XTimelineResponse = {
    data,
    includes: {
      media: [...mediaById.values()],
      tweets: [...tweetsById.values()],
      users: [...usersById.values()],
    },
    meta: { newest_id: newestId ?? undefined },
  };

  // Pull in any quoted/retweeted tweets, authors, and media the timeline
  // expansion left incomplete so the normalizer can resolve full context.
  await hydrateReferences(combined);

  const items = normalizeTimeline(combined, {
    ...source,
    external_account_id: accountId,
  });
  return { items, newestId, accountId, ok: true, truncatedByPageBudget };
}
