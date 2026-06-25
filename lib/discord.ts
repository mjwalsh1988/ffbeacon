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
}

export type DiscordResult =
  | { ok: true; id: string | null }
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

/** Post a new webhook message; returns the created message id (wait=true). */
export async function postWebhookMessage(
  webhookUrl: string,
  input: DiscordMessageInput,
): Promise<DiscordResult> {
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
    const id = (json as { id?: string } | null)?.id ?? null;
    return { ok: true, id };
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
