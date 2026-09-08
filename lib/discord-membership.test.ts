import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchGuildMembership,
  _resetDiscordMembershipCacheForTests,
} from "./discord-membership";

/**
 * Tests go through fetchGuildMembership directly rather than the exported
 * getDiscordMembership/isDiscordMember. Both of those are wrapped in React
 * cache(), which memoizes a zero-argument function for the life of the
 * module/render scope, so two calls with different mocked fetch responses in
 * the same test file would just return the first result again. fetchGuildMembership
 * takes the Discord user id as an argument and holds the actual TTL logic
 * PERF-T042 changed (CACHE_TTL_MS, 5 minutes to 24 hours), so it is the
 * correct unit to test directly.
 */

const ORIGINAL_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ORIGINAL_GUILD = process.env.DISCORD_GUILD_ID;

function statusResponse(status: number): Response {
  return { status } as unknown as Response;
}

describe("fetchGuildMembership", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DISCORD_BOT_TOKEN = "test-token";
    process.env.DISCORD_GUILD_ID = "test-guild";
    _resetDiscordMembershipCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (ORIGINAL_TOKEN === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = ORIGINAL_TOKEN;
    if (ORIGINAL_GUILD === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = ORIGINAL_GUILD;
  });

  it("returns unknown when configuration is missing, and never calls Discord", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const result = await fetchGuildMembership("user-1");
    expect(result).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns member on a 200 and serves it from cache for the 24 hour TTL", async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(200));
    const first = await fetchGuildMembership("user-2");
    expect(first).toBe("member");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still inside the 24 hour window: served from cache, no second call.
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    const second = await fetchGuildMembership("user-2");
    expect(second).toBe("member");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-checks Discord once the 24 hour TTL has elapsed", async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(200));
    const first = await fetchGuildMembership("user-3");
    expect(first).toBe("member");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

    fetchMock.mockResolvedValueOnce(statusResponse(404));
    const second = await fetchGuildMembership("user-3");
    expect(second).toBe("not_member");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns not_member on a 404 and caches it the same way as member", async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(404));
    const first = await fetchGuildMembership("user-4");
    expect(first).toBe("not_member");

    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    const second = await fetchGuildMembership("user-4");
    expect(second).toBe("not_member");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns unknown on a non-200/404 response and does not cache it", async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(429));
    const first = await fetchGuildMembership("user-5");
    expect(first).toBe("unknown");

    // Not cached: the very next call (no time advanced) hits Discord again.
    fetchMock.mockResolvedValueOnce(statusResponse(200));
    const second = await fetchGuildMembership("user-5");
    expect(second).toBe("member");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns unknown when the request throws and does not cache it", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const first = await fetchGuildMembership("user-6");
    expect(first).toBe("unknown");

    fetchMock.mockResolvedValueOnce(statusResponse(200));
    const second = await fetchGuildMembership("user-6");
    expect(second).toBe("member");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries per Discord user id", async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(200));
    fetchMock.mockResolvedValueOnce(statusResponse(404));

    const a = await fetchGuildMembership("user-a");
    const b = await fetchGuildMembership("user-b");
    expect(a).toBe("member");
    expect(b).toBe("not_member");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
