import "server-only";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Discord guild membership resolution (server-only).
 *
 * Purpose: decide whether the signed-in user is already a member of the FF
 * Beacon Discord server so the UI can stop showing them "Join our Discord"
 * CTAs (wasted real estate) and offer something more useful instead.
 *
 * Security posture:
 *   - This module is `server-only`. The bot token NEVER reaches the browser.
 *   - The Discord user id is derived from the authenticated Supabase session
 *     (the linked Discord identity's provider_id). It is NEVER accepted from
 *     the client, so a caller cannot probe arbitrary Discord ids against our
 *     guild.
 *
 * Data flow: Supabase session -> linked Discord identity -> provider_id ->
 * GET /guilds/{guildId}/members/{discordUserId} with `Authorization: Bot ...`.
 *   - 200  -> member
 *   - 404  -> not a member
 *   - else -> unknown (network error, rate limit, misconfig). Treated as
 *             "not confirmed" so the default Join CTA still shows.
 *
 * Caching:
 *   - React `cache()` dedupes the whole resolution within a single server
 *     render pass (a page may read it once and pass it down, but this keeps
 *     repeat reads free).
 *   - A short module-level TTL map keyed by Discord id avoids hammering the
 *     Discord API across separate requests from the same warm instance. Only
 *     definitive answers (member / not_member) are cached; `unknown` is left
 *     uncached so a transient failure retries on the next navigation.
 */

export type DiscordMembership = "member" | "not_member" | "no_link" | "unknown";

const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { status: Exclude<DiscordMembership, "no_link">; expires: number };
const membershipCache = new Map<string, CacheEntry>();

/**
 * Pull the Discord snowflake id from the user's linked Discord identity.
 * Returns null when no Discord provider is linked (or no user).
 */
function extractDiscordUserId(user: User | null): string | null {
  if (!user) return null;
  const identity = (user.identities ?? []).find((i) => i.provider === "discord");
  if (!identity) return null;
  // Supabase stores the provider's stable id under identity_data.provider_id
  // (mirrored as `sub`). Fall back to the identity's own id as a last resort.
  const data = identity.identity_data as
    | { provider_id?: string; sub?: string }
    | undefined;
  return data?.provider_id ?? data?.sub ?? identity.id ?? null;
}

/**
 * Raw guild membership check against the Discord API. Cached per Discord id
 * for CACHE_TTL_MS. Returns "unknown" on any non-definitive outcome.
 */
async function fetchGuildMembership(
  discordUserId: string,
): Promise<Exclude<DiscordMembership, "no_link">> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  // Missing configuration is a deploy problem, not a user state. Treat as
  // unknown so we fail open to the default Join CTA rather than hiding it.
  if (!token || !guildId) return "unknown";

  const now = Date.now();
  const cached = membershipCache.get(discordUserId);
  if (cached && cached.expires > now) return cached.status;

  let status: Exclude<DiscordMembership, "no_link">;
  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordUserId)}`,
      {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Membership is volatile relative to Next's data cache; we manage our
        // own TTL above, so never let the fetch layer cache this response.
        cache: "no-store",
      },
    );
    if (res.status === 200) status = "member";
    else if (res.status === 404) status = "not_member";
    else status = "unknown";
  } catch {
    status = "unknown";
  }

  // Only persist definitive answers; let "unknown" retry next time.
  if (status !== "unknown") {
    membershipCache.set(discordUserId, {
      status,
      expires: now + CACHE_TTL_MS,
    });
  }
  return status;
}

/**
 * Full membership status for the current request's authenticated user.
 * Wrapped in React cache() so repeated reads in one render are free.
 */
export const getDiscordMembership = cache(
  async (): Promise<DiscordMembership> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const discordUserId = extractDiscordUserId(user);
    if (!discordUserId) return "no_link";
    return fetchGuildMembership(discordUserId);
  },
);

/**
 * Convenience boolean used by CTA components. True ONLY when we have
 * positively confirmed the user is in the guild. Every other state
 * (no Discord linked, 404, error, misconfig) is false, so the default
 * "Join our Discord" CTA keeps showing when we cannot be sure.
 */
export const isDiscordMember = cache(async (): Promise<boolean> => {
  return (await getDiscordMembership()) === "member";
});
