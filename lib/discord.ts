/**
 * Discord incoming-webhook client (greenfield).
 *
 * Low-level and reusable beyond The Beacon Brief. Every send applies the
 * "Beacon Relay" identity (username + our logo avatar) and a locked-down
 * allowed_mentions so only explicitly listed role ids can be pinged (never
 * @everyone, never arbitrary users). postWebhookMessage uses ?wait=true so we
 * get the created message id back for later patching. Results are returned (never
 * thrown) and carry the HTTP status + retry-after so the queue worker can back
 * off correctly on 429.
 */

import { SITE } from "@/lib/site";

export const BEACON_RELAY_USERNAME = "Beacon Relay";
const DEFAULT_TIMEOUT_MS = 15_000;

/** Absolute URL to our logo for the bot avatar (never a relative URL). */
export function beaconRelayAvatarUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ?? SITE.url ?? "https://ffbeacon.com";
  const origin = /localhost|127\.0\.0\.1/.test(raw)
    ? "https://ffbeacon.com"
    : raw.replace(/\/$/, "");
  return `${origin}/img/ff-beacon-logo-email.png`;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  /** Left-bar accent color (decimal). Use the FF Beacon purple for post cards. */
  color?: number;
  image?: { url: string };
  author?: { name: string };
  footer?: { text: string };
}

/**
 * A poll attached to a new message.
 *
 * Discord accepts a poll on a webhook execute (not on an edit: a poll is fixed
 * once posted, which is the point of it). The duration is in HOURS and Discord
 * caps it at 32 days. Answer ids are assigned by Discord in the order the
 * answers are sent, starting at 1, which is how the results below are matched
 * back to the sides they belong to.
 */
export interface DiscordPollInput {
  question: string;
  answers: string[];
  /** Hours the poll stays open. */
  durationHours: number;
}

/** What Discord reports back for a poll on a message we fetch. */
export interface DiscordPollResults {
  /**
   * Discord's raw poll object, exactly as returned. Stored so a disputed count
   * has an audit trail and so a change in how Discord assigns answer ids can be
   * re-derived rather than guessed at.
   */
  raw: unknown;
  /**
   * Discord seals a poll's numbers some time AFTER it expires rather than at
   * the instant it does, so this is the flag to prefer and never the flag to
   * wait on forever.
   */
  isFinalized: boolean;
  /**
   * Vote count per answer id. An answer nobody voted for can be MISSING from
   * Discord's array rather than present with a zero, so callers must default a
   * missing id to 0 instead of treating its absence as an error.
   */
  counts: Map<number, number>;
}

/** A binary file uploaded with the message (multipart). */
export interface DiscordAttachment {
  filename: string;
  data: Uint8Array;
  contentType: string;
}

export interface DiscordMessageInput {
  content?: string;
  embeds?: DiscordEmbed[];
  /** Role ids permitted to be mentioned (others in content are not pinged). */
  allowedRoleIds?: string[];
  /**
   * Files uploaded with the message. When present the request is sent as
   * multipart/form-data (payload_json + files[n]); otherwise it is plain JSON.
   */
  attachments?: DiscordAttachment[];
  /** Only honoured on create. Discord ignores a poll on an edit. */
  poll?: DiscordPollInput;
}

export type DiscordResult =
  | { ok: true; id: string | null }
  | { ok: false; status: number; retryAfterMs: number | null; error: string };

/**
 * What a successful post tells us about the message Discord created.
 *
 * A superset of DiscordResult's ok branch, so `ok`, `id` and `error` read the
 * same at every call site. The extra two matter only to a caller that wants to
 * come back later and ask WHO voted on a poll:
 *
 *   channelId       The poll voters endpoint is channel-scoped
 *                   (/channels/{id}/polls/...), and a webhook URL does not name
 *                   its channel. Discord puts it in the create response, which
 *                   we already ask for with wait=true, so it costs nothing to
 *                   keep and cannot be recovered later without it.
 *   pollAnswerIds   Discord's OWN ids for the answers, in the order we sent
 *                   them. Answer ids happen to be 1 and 2 today, and reading
 *                   them back rather than assuming that is what keeps a vote
 *                   attributed to the right side if Discord ever numbers them
 *                   differently.
 */
export type DiscordPostResult =
  | {
      ok: true;
      id: string | null;
      channelId: string | null;
      pollAnswerIds: number[] | null;
    }
  | { ok: false; status: number; retryAfterMs: number | null; error: string };

function buildBody(
  input: DiscordMessageInput,
  withIdentity: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content: input.content ?? "",
    embeds: input.embeds ?? [],
    // parse: [] disables @everyone/@here and broad user/role parsing; only the
    // explicitly listed role ids may be mentioned.
    allowed_mentions: { parse: [], roles: input.allowedRoleIds ?? [] },
  };
  // Identity can only be set on create; Discord ignores it on edit.
  if (withIdentity) {
    body.username = BEACON_RELAY_USERNAME;
    body.avatar_url = beaconRelayAvatarUrl();
  }
  // A poll is likewise create-only, and it is its OWN condition rather than a
  // passenger on the identity branch. Nesting it there happened to work and
  // coupled two unrelated rules: a later change to when identity is set would
  // have silently stopped sending polls.
  if (withIdentity && input.poll) {
    body.poll = {
      question: { text: input.poll.question },
      answers: input.poll.answers.map((text) => ({ poll_media: { text } })),
      duration: input.poll.durationHours,
      allow_multiselect: false,
      layout_type: 1,
    };
  }
  return body;
}

/**
 * Build the fetch body + headers for a message. When attachments are present we
 * send multipart/form-data (payload_json + files[n]) and let fetch set the
 * boundary header itself; otherwise plain JSON. The `attachments` array in
 * payload_json maps each uploaded file (by index) to a filename.
 */
function buildRequest(
  input: DiscordMessageInput,
  withIdentity: boolean,
): { body: BodyInit; headers: Record<string, string> } {
  const payload = buildBody(input, withIdentity);
  const files = input.attachments ?? [];
  // Reflect a caller-supplied attachments array (even empty) so an edit replaces
  // or CLEARS existing files; leaving it absent keeps existing attachments.
  if (input.attachments !== undefined) {
    payload.attachments = files.map((f, i) => ({
      id: i,
      filename: f.filename,
    }));
  }
  if (files.length === 0) {
    return {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    };
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  files.forEach((f, i) => {
    form.append(
      `files[${i}]`,
      // A Uint8Array is a valid BlobPart at runtime; cast past TS's narrowed view type.
      new Blob([f.data as BlobPart], { type: f.contentType }),
      f.filename,
    );
  });
  // No explicit Content-Type: fetch derives the multipart boundary from FormData.
  return { body: form, headers: {} };
}

function retryAfterMs(res: Response, json: unknown): number | null {
  // Discord sends retry_after (seconds, float) in the JSON body on 429, and also
  // a Retry-After header. Prefer the body.
  const fromJson = (json as { retry_after?: unknown })?.retry_after;
  if (typeof fromJson === "number") return Math.ceil(fromJson * 1000);
  const header = res.headers.get("retry-after");
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n)) return Math.ceil(n * 1000);
  }
  return null;
}

/**
 * Post a new webhook message.
 *
 * wait=true, so Discord returns the message it created rather than an empty
 * 204. That is where the message id comes from, and also the channel id and the
 * poll's answer ids, which a later read of who voted needs and which nothing
 * else hands back.
 */
export async function postWebhookMessage(
  webhookUrl: string,
  input: DiscordMessageInput,
): Promise<DiscordPostResult> {
  try {
    const req = buildRequest(input, true);
    const res = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        retryAfterMs: retryAfterMs(res, json),
        error: `Discord post ${res.status}`,
      };
    }
    const created = json as {
      id?: string;
      channel_id?: string;
      poll?: { answers?: Array<{ answer_id?: number }> };
    } | null;
    const answerIds = (created?.poll?.answers ?? [])
      .map((a) => a?.answer_id)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    return {
      ok: true,
      id: created?.id ?? null,
      channelId: created?.channel_id ?? null,
      // Null rather than [] when there was no poll, so "this message had no
      // poll" and "the poll had no answers" stay distinguishable.
      pollAnswerIds: answerIds.length > 0 ? answerIds : null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      retryAfterMs: null,
      error: err instanceof Error ? err.message : "discord post failed",
    };
  }
}

/**
 * Delete an existing webhook message. A 204 is success; a 404 (or Discord code
 * 10008 "Unknown Message") means the message is already gone, which is the same
 * desired end state, so we report ok in that case too.
 */
export async function deleteWebhookMessage(
  webhookUrl: string,
  messageId: string,
): Promise<DiscordResult> {
  try {
    const res = await fetch(
      `${webhookUrl}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
    );
    if (res.ok || res.status === 404) return { ok: true, id: messageId };
    const json = await res.json().catch(() => null);
    if ((json as { code?: number } | null)?.code === 10008)
      return { ok: true, id: messageId };
    return {
      ok: false,
      status: res.status,
      retryAfterMs: retryAfterMs(res, json),
      error: `Discord delete ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      retryAfterMs: null,
      error: err instanceof Error ? err.message : "discord delete failed",
    };
  }
}

/** Edit an existing webhook message (content/embeds/mentions only). */
export async function patchWebhookMessage(
  webhookUrl: string,
  messageId: string,
  input: DiscordMessageInput,
): Promise<DiscordResult> {
  try {
    const req = buildRequest(input, false);
    const res = await fetch(
      `${webhookUrl}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        retryAfterMs: retryAfterMs(res, json),
        error: `Discord patch ${res.status}`,
      };
    }
    return { ok: true, id: messageId };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      retryAfterMs: null,
      error: err instanceof Error ? err.message : "discord patch failed",
    };
  }
}

/**
 * Read a message back through the webhook that created it.
 *
 * The only reason this exists: a poll's results live on the message, and this
 * endpoint returns them without a bot token or a channel id. `GET /webhooks/
 * {id}/{token}/messages/{message_id}` is authenticated by the webhook token
 * already in the URL, so nothing new has to be configured to read a poll we
 * posted ourselves.
 *
 * A 404 means the message is gone (deleted in the channel, or the webhook was
 * recreated). That is reported as a failure rather than as an empty poll,
 * because "nobody voted" and "we cannot see it" are different answers and only
 * one of them should ever be written into a tally.
 */
export type DiscordPollFetch =
  | { ok: true; poll: DiscordPollResults | null }
  | { ok: false; status: number; retryAfterMs: number | null; error: string };

export async function fetchWebhookPoll(
  webhookUrl: string,
  messageId: string,
): Promise<DiscordPollFetch> {
  try {
    const res = await fetch(
      `${webhookUrl}/messages/${encodeURIComponent(messageId)}`,
      { method: "GET", signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) },
    );
    const json = (await res.json().catch(() => null)) as {
      poll?: {
        results?: {
          is_finalized?: boolean;
          answer_counts?: Array<{ id?: number; count?: number }>;
        };
      };
    } | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        retryAfterMs: retryAfterMs(res, json),
        error: `Discord message fetch ${res.status}`,
      };
    }
    const results = json?.poll?.results;
    if (!results) return { ok: true, poll: null };
    const counts = new Map<number, number>();
    for (const entry of results.answer_counts ?? []) {
      if (typeof entry?.id === "number" && typeof entry?.count === "number") {
        counts.set(entry.id, entry.count);
      }
    }
    return {
      ok: true,
      poll: {
        raw: json?.poll ?? null,
        isFinalized: Boolean(results.is_finalized),
        counts,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      retryAfterMs: null,
      error: err instanceof Error ? err.message : "discord message fetch failed",
    };
  }
}
