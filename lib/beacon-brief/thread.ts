/**
 * Thread links between source posts: pure helpers, no database.
 *
 * A reporter breaking a story usually posts it more than once: the post, an
 * edit of the post, a quote of it with one more detail, a reply under it. X
 * tells us exactly which post each of those points at, so linking them needs no
 * model and cannot guess wrong about WHICH post is meant. These helpers read
 * those links off the raw X object, order a batch so a post is always processed
 * after the post it points at, and answer two small questions the Discord side
 * asks (when a card was posted, and which post's images a combined card shows).
 *
 * Nothing here decides that two posts are the same story. lib/relays/threads.ts
 * makes that call, and it still requires the two to share a subject.
 */

import type { BeaconBriefMedia, BeaconBriefQuoted, BeaconBriefSourceItem } from "./types";

interface RawReference {
  type?: unknown;
  id?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * The ids of the posts this post quotes, replies to or retweets, read off the
 * raw X object. Empty for anything else, including a raw object we cannot read.
 */
export function referencedPostIds(raw: unknown): string[] {
  const refs = asRecord(raw)?.referenced_tweets;
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const ref of refs as RawReference[]) {
    if (ref?.type !== "quoted" && ref?.type !== "replied_to" && ref?.type !== "retweeted") continue;
    if (typeof ref.id === "string" && ref.id && !out.includes(ref.id)) out.push(ref.id);
  }
  return out;
}

/**
 * The ids of the posts this post REPLIES to, a subset of referencedPostIds. A
 * reply is the weakest of the three links: a reporter's thread can move on to
 * a different player, so a reply alone never earns the long edit window.
 */
export function repliedToIds(raw: unknown): string[] {
  const refs = asRecord(raw)?.referenced_tweets;
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const ref of refs as RawReference[]) {
    if (ref?.type === "replied_to" && typeof ref.id === "string" && ref.id && !out.includes(ref.id)) out.push(ref.id);
  }
  return out;
}

/**
 * Every id in this post's edit history other than its own, newest first. An
 * edited post on X carries the ids of every earlier version; a quote made
 * before the edit points at one of those.
 */
export function earlierEditIds(raw: unknown, selfId: string): string[] {
  const chain = idList(asRecord(raw)?.edit_history_tweet_ids);
  return chain.filter((id) => id !== selfId).reverse();
}

/** Every id a post stands for: its own plus its earlier versions. */
export function ownPostIds(item: Pick<BeaconBriefSourceItem, "source_external_id" | "raw">): string[] {
  return [item.source_external_id, ...earlierEditIds(item.raw, item.source_external_id)];
}

/**
 * Reorder a batch (oldest first on the way in) so a post is processed after any
 * post in the same batch that it quotes, replies to, retweets or edits.
 *
 * Why it matters. An edited post takes the time of its LAST edit, so the
 * version of the Brissett trade post with the photo sorted after the two posts
 * that quoted its first version. Processed in time order, each quote looked for
 * the post it quoted, found nothing yet, and went out as a card of its own.
 *
 * Everything else keeps its time order, and the result holds exactly the same
 * items. A cycle (which X does not produce) is broken by time order rather than
 * looping.
 */
export function orderForThreads<T extends Pick<BeaconBriefSourceItem, "source_external_id" | "raw">>(
  items: T[],
): T[] {
  const ownerOf = new Map<string, number>();
  items.forEach((item, index) => {
    for (const id of ownPostIds(item)) {
      if (!ownerOf.has(id)) ownerOf.set(id, index);
    }
  });
  const deps = items.map((item, index) => {
    const wanted = [
      ...referencedPostIds(item.raw),
      ...earlierEditIds(item.raw, item.source_external_id),
    ];
    const found = new Set<number>();
    for (const id of wanted) {
      const owner = ownerOf.get(id);
      if (owner !== undefined && owner !== index) found.add(owner);
    }
    return [...found].sort((a, b) => a - b);
  });

  const state = new Array<0 | 1 | 2>(items.length).fill(0); // 0 new, 1 visiting, 2 done
  const out: T[] = [];
  const visit = (index: number) => {
    if (state[index] !== 0) return;
    state[index] = 1;
    for (const dep of deps[index]) visit(dep);
    state[index] = 2;
    out.push(items[index]);
  };
  for (let i = 0; i < items.length; i++) visit(i);
  return out;
}

/**
 * How far a source's cursor may advance after some of a reordered batch has
 * been processed: the newest id such that it and every OLDER post in the batch
 * are done. Advancing to the newest processed id instead would skip an older
 * post that a failure stopped short of, because the next poll asks X only for
 * posts after the cursor. Null when not even the oldest post is done.
 */
export function safeCursor(
  chronological: Array<Pick<BeaconBriefSourceItem, "source_external_id">>,
  done: ReadonlySet<string>,
): string | null {
  let cursor: string | null = null;
  for (const item of chronological) {
    if (!done.has(item.source_external_id)) break;
    cursor = item.source_external_id;
  }
  return cursor;
}

/** Discord's epoch (2015-01-01T00:00:00Z) in milliseconds. */
const DISCORD_EPOCH_MS = BigInt(1_420_070_400_000);

/**
 * When a Discord message was created, read out of its id. A Discord id is a
 * snowflake whose high bits are the creation time, so the card's real posting
 * time needs no column of its own. Null for anything that is not a snowflake.
 */
export function discordSnowflakeTimeMs(id: string | null | undefined): number | null {
  if (!id || !/^\d{15,22}$/.test(id)) return null;
  try {
    const ms = Number((BigInt(id) >> BigInt(22)) + DISCORD_EPOCH_MS);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** The media fields of one stored post, as the media chooser reads them. */
export interface CardMediaCandidate {
  media: BeaconBriefMedia[] | null;
  quoted: BeaconBriefQuoted | null;
  retweeted: BeaconBriefQuoted | null;
}

function nonEmpty(list: BeaconBriefMedia[] | null | undefined): boolean {
  return Array.isArray(list) && list.some((m) => m && typeof m.url === "string" && m.url);
}

/**
 * Which post's images a card that carries several posts should show, as an
 * index into the list (which leads with the card's own post).
 *
 * A post's OWN pictures win over anything it merely quotes: the first post in
 * order with its own images (for a retweet, the retweeted post's images, which
 * is how the single-post card already treats it), then the first post whose
 * quoted post has images. Null when nobody has an image.
 */
export function chooseCardMediaIndex(candidates: CardMediaCandidate[]): number | null {
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const primary = c.retweeted ? c.retweeted.media : c.media;
    if (nonEmpty(primary)) return i;
  }
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const context = c.retweeted ? c.media : c.quoted?.media;
    if (nonEmpty(context)) return i;
  }
  return null;
}
