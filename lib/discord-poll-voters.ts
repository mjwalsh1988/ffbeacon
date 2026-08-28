/**
 * Who voted on a Discord poll.
 *
 * The webhook that posts a poll can read that poll's RESULTS back, but results
 * are aggregate counts: "41 picked the first answer". Names are only available
 * from a different endpoint, which is channel-scoped and needs the bot rather
 * than the webhook:
 *
 *   GET /channels/{channel_id}/polls/{message_id}/answers/{answer_id}
 *
 * It returns `{ users: [{ id }, ...] }`, up to 100 at a time, paginated with
 * `after` set to the last id of the previous page. That is the whole mechanism.
 *
 * WHY THIS IS WORTH THE EXTRA DEPENDENCY. A count cannot be deduplicated. Post
 * the same trade twice and a person who votes on both is inside both counts,
 * and the doubled total is indistinguishable from twice as many people. A list
 * of ids can be deduplicated, so with it a repeat vote on the same trade is
 * dropped and the tally stays honest.
 *
 * THREE REQUIREMENTS, AND A MISSING ONE IS NOT AN ERROR. DISCORD_BOT_TOKEN has
 * to be set, the bot has to be in the server the poll was posted to, and it
 * needs to be able to view that channel and read its history. Any of those can
 * be false for a webhook someone added to a server we were never invited to, so
 * every failure returns a reason rather than throwing, and the caller falls
 * back to the aggregate counts it can always get.
 */

const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 15_000;

/** Discord's own cap for this endpoint. Asking for more is rejected. */
const PAGE_SIZE = 100;

/**
 * A stop on runaway pagination. 100 pages is 10,000 voters on one answer, far
 * past any poll we would post, and it is what stops a Discord bug that keeps
 * returning full pages from looping until the function times out.
 */
const MAX_PAGES = 100;

export type PollVotersResult =
  | { ok: true; userIds: string[] }
  | { ok: false; reason: string };

/** Whether the bot is configured at all. Cheap enough to check before looping. */
export function hasDiscordBotToken(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
}

/**
 * Every Discord user id that picked one answer.
 *
 * Pages until Discord returns a short page, which is how this endpoint says
 * "that is all of them"; it does not report a total.
 */
export async function fetchPollAnswerVoters(args: {
  channelId: string;
  messageId: string;
  answerId: number;
}): Promise<PollVotersResult> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { ok: false, reason: "DISCORD_BOT_TOKEN is not set." };

  const seen: string[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (after) params.set("after", after);
    const url =
      `${DISCORD_API}/channels/${encodeURIComponent(args.channelId)}` +
      `/polls/${encodeURIComponent(args.messageId)}` +
      `/answers/${encodeURIComponent(String(args.answerId))}?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Vote lists are volatile and this runs on a cron; never let the fetch
        // layer hand back a cached page.
        cache: "no-store",
      });
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Discord poll voters fetch failed.",
      };
    }

    if (res.status === 429) {
      // Deliberately NOT retried here. This runs inside an hourly cron that
      // will come back on its own, and sleeping through a rate limit inside a
      // request risks the whole ingestion sweep timing out. Reported, and the
      // caller falls back to the aggregate counts for this poll.
      return { ok: false, reason: "Discord rate limited the poll voters read." };
    }
    if (res.status === 403 || res.status === 404) {
      // The usual honest cases: the bot is not in that server, cannot see that
      // channel, or the message is gone. Named apart from a generic failure so
      // an admin reading the log knows it is a permissions problem, not an
      // outage.
      return {
        ok: false,
        reason: `The bot cannot read that poll (${res.status}). Check it is in the server and can view the channel.`,
      };
    }
    if (!res.ok) {
      return { ok: false, reason: `Discord poll voters ${res.status}.` };
    }

    const json = (await res.json().catch(() => null)) as {
      users?: Array<{ id?: string }>;
    } | null;
    const ids = (json?.users ?? [])
      .map((u) => u?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    seen.push(...ids);
    // A short page is the end. An empty one is too, and is what a poll nobody
    // voted on returns on its first request.
    if (ids.length < PAGE_SIZE) return { ok: true, userIds: seen };
    after = ids[ids.length - 1];
  }

  return { ok: false, reason: "Too many pages of poll voters; refusing to keep reading." };
}
