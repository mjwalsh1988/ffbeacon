import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * next/cache's unstable_cache is a build-time/runtime construct that only
 * behaves as a real cache inside a Next.js server. Outside of one (this test
 * file), it is mocked as a thin passthrough that also records the key parts
 * and options getDiscordGuildStats was registered with, the same pattern
 * lib/positional-war/load.test.ts uses. That lets this file assert the
 * PERF-T042 24 hour TTL directly, and still exercise fetchGuildStats's own
 * success/failure logic through the exported wrapper.
 */
// vi.mock factories are hoisted above the rest of the file, so the array they
// close over has to be created through vi.hoisted rather than a plain const,
// or the reference inside the factory throws before it's initialized.
const { capturedCacheCalls } = vi.hoisted(() => ({
  capturedCacheCalls: [] as { keyParts: string[]; options: unknown }[],
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown, keyParts: string[], options: unknown) => {
      capturedCacheCalls.push({ keyParts, options });
      return async (...args: unknown[]) => fn(...args);
    },
}));

import { getDiscordGuildStats } from "./discord-stats";

const ORIGINAL_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ORIGINAL_GUILD = process.env.DISCORD_GUILD_ID;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("getDiscordGuildStats caching (PERF-T042)", () => {
  it("registers the underlying fetch with a 24 hour revalidate and the discord-guild-stats tag", () => {
    expect(capturedCacheCalls).toHaveLength(1);
    expect(capturedCacheCalls[0].keyParts).toEqual(["discord-guild-stats"]);
    expect(capturedCacheCalls[0].options).toEqual({
      revalidate: 86_400,
      tags: ["discord-guild-stats"],
    });
  });
});

describe("getDiscordGuildStats", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DISCORD_BOT_TOKEN = "test-token";
    process.env.DISCORD_GUILD_ID = "test-guild";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_TOKEN === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = ORIGINAL_TOKEN;
    if (ORIGINAL_GUILD === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = ORIGINAL_GUILD;
  });

  it("returns member and online counts from a successful fetch", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        approximate_member_count: 1234,
        approximate_presence_count: 56,
      }),
    );
    const result = await getDiscordGuildStats();
    expect(result).toEqual({ memberCount: 1234, onlineCount: 56 });
  });

  it("returns null when configuration is missing, and never calls fetch", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const result = await getDiscordGuildStats();
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    const result = await getDiscordGuildStats();
    expect(result).toBeNull();
  });

  it("returns null on a malformed payload (non-numeric counts)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { approximate_member_count: "many", approximate_presence_count: 5 }),
    );
    const result = await getDiscordGuildStats();
    expect(result).toBeNull();
  });

  it("returns null when the request throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await getDiscordGuildStats();
    expect(result).toBeNull();
  });
});
