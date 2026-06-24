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
  image?: { url: string };
  author?: { name: string };
  footer?: { text: string };
}

export interface DiscordMessageInput {
  content?: string;
  embeds?: DiscordEmbed[];
  /** Role ids permitted to be mentioned (others in content are not pinged). */
  allowedRoleIds?: string[];
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
    const res = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(input, true)),
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

/** Edit an existing webhook message (content/embeds/mentions only). */
export async function patchWebhookMessage(
  webhookUrl: string,
  messageId: string,
  input: DiscordMessageInput,
): Promise<DiscordResult> {
  try {
    const res = await fetch(
      `${webhookUrl}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(input, false)),
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
