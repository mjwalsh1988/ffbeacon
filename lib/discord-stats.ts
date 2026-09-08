import "server-only";
import { unstable_cache } from "next/cache";

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
 * payload returns null. The hero renders gracefully without the numbers when
 * this is null.
 *
 * Caching: wrapped in unstable_cache with a 24 hour TTL (owner-approved
 * 2026-09-08; a day's lag on a member count is fine). This replaces the old
 * module-level TTL memo: unlike an in-process map, the Next data cache is
 * shared across server instances and survives a cold start, so a fresh
 * deploy or a scaled-out instance doesn't have to pay for its own Discord
 * call. A future admin "refresh" action can force a re-fetch with
 * revalidateTag("discord-guild-stats").
 */

export type DiscordGuildStats = {
  /** Total members in the guild (Discord's approximate_member_count). */
  memberCount: number;
  /** Members online right now (Discord's approximate_presence_count). */
  onlineCount: number;
};

const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 8_000;

async function fetchGuildStats(): Promise<DiscordGuildStats | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  // Missing configuration is a deploy problem, not a user state. Fail soft to
  // null so the hero simply omits the live numbers.
  if (!token || !guildId) return null;

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}?with_counts=true`,
      {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // The Next data cache below is what manages the TTL now; never let the
        // fetch layer cache this response on top of it.
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      approximate_member_count?: unknown;
      approximate_presence_count?: unknown;
    };
    const memberCount = json.approximate_member_count;
    const onlineCount = json.approximate_presence_count;
    if (typeof memberCount !== "number" || typeof onlineCount !== "number") {
      return null;
    }
    return { memberCount, onlineCount };
  } catch {
    return null;
  }
}

/**
 * Live guild stats, cached 24 hours in the Next data cache. Returns null when
 * the numbers cannot be resolved (config missing, API error, malformed
 * payload). A null result is cached for the same 24 hours as a real one: the
 * owner accepted that trade-off when approving the longer TTL, since it only
 * means the hero omits the numbers instead of showing stale ones. Use
 * revalidateTag("discord-guild-stats") to force an earlier retry.
 */
export const getDiscordGuildStats = unstable_cache(
  fetchGuildStats,
  ["discord-guild-stats"],
  { revalidate: 86_400, tags: ["discord-guild-stats"] },
);
