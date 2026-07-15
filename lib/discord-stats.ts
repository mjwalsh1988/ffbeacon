import "server-only";
import { cache } from "react";

/**
 * Live FF Beacon Discord guild stats (server-only).
 *
 * Purpose: surface REAL community numbers on the homepage hero (total members
 * and how many are online right now) instead of invented figures. The two
 * counts come straight from Discord's own guild object.
 *
 * Security posture:
 *   - `server-only`: the bot token never reaches the browser. The page fetches
 *     these numbers during its server render and passes plain integers down.
 *   - No user input is involved; we only ever read our own guild id from env.
 *
 * Data source: GET /guilds/{guildId}?with_counts=true with `Authorization: Bot`
 *   - `approximate_member_count`   -> total members
 *   - `approximate_presence_count` -> members online right now
 * Discord computes both server-side; they are the same numbers Discord shows in
 * its own widgets.
 *
 * We deliberately expose ONLY these two counts. Message totals, "questions
 * answered", "trades analyzed" and similar are not available from a single API
 * read and we will not fabricate them, so the hero shows only what is real.
 *
 * Failure semantics: any missing config, network error, non-200, or malformed
 * payload returns the last good cached value if we have one, otherwise null.
 * The hero renders gracefully without the numbers when this is null.
 *
 * Caching: a short module-level TTL keeps us from hitting Discord on every
 * render of a warm instance, and React `cache()` dedupes reads within one
 * render pass.
 */

export type DiscordGuildStats = {
  /** Total members in the guild (Discord's approximate_member_count). */
  memberCount: number;
  /** Members online right now (Discord's approximate_presence_count). */
  onlineCount: number;
};

const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedStats: { stats: DiscordGuildStats; expires: number } | null = null;

async function fetchGuildStats(): Promise<DiscordGuildStats | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  // Missing configuration is a deploy problem, not a user state. Fail soft to
  // null so the hero simply omits the live numbers.
  if (!token || !guildId) return null;

  const now = Date.now();
  if (cachedStats && cachedStats.expires > now) return cachedStats.stats;

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}?with_counts=true`,
      {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // These counts are volatile; manage our own TTL and never let the fetch
        // layer cache the response.
        cache: "no-store",
      },
    );
    if (!res.ok) return cachedStats?.stats ?? null;
    const json = (await res.json()) as {
      approximate_member_count?: unknown;
      approximate_presence_count?: unknown;
    };
    const memberCount = json.approximate_member_count;
    const onlineCount = json.approximate_presence_count;
    if (typeof memberCount !== "number" || typeof onlineCount !== "number") {
      return cachedStats?.stats ?? null;
    }
    const stats: DiscordGuildStats = { memberCount, onlineCount };
    cachedStats = { stats, expires: now + CACHE_TTL_MS };
    return stats;
  } catch {
    return cachedStats?.stats ?? null;
  }
}

/**
 * Live guild stats for the current render, deduped per render pass. Returns
 * null when the numbers cannot be resolved (config missing, API error, etc.).
 */
export const getDiscordGuildStats = cache(fetchGuildStats);
