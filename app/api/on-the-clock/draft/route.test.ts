import { describe, it, expect, vi, beforeEach } from "vitest";

const { readDraftCacheMock, performDraftSyncMock, loadSettingsMock } = vi.hoisted(() => ({
  readDraftCacheMock: vi.fn(),
  performDraftSyncMock: vi.fn(),
  loadSettingsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/on-the-clock/settings", () => ({ loadOnTheClockSettings: loadSettingsMock }));
vi.mock("@/lib/on-the-clock/cache", () => ({ readDraftCache: readDraftCacheMock }));
vi.mock("@/lib/on-the-clock/sleeper-sync", () => ({ performDraftSync: performDraftSyncMock }));

import { GET } from "./route";

const ENABLED = { feature: { enabled: true }, sync: { cooldownSeconds: 30, lockSeconds: 15 } };
const CACHE = {
  draft: { sleeperDraftId: "123", sleeperLeagueId: "456", season: "2026" },
  users: [],
  rosters: [],
  picks: [],
};

function req(qs: string, headers: Record<string, string> = { "x-requested-with": "ff-beacon" }) {
  return new Request(`http://test/api/on-the-clock/draft${qs}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSettingsMock.mockResolvedValue(ENABLED);
});

describe("GET /api/on-the-clock/draft", () => {
  it("rejects a missing header guard with 403", async () => {
    const res = await GET(req("?draft_id=123", {}));
    expect(res.status).toBe(403);
    expect(readDraftCacheMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid draft id with 400", async () => {
    const res = await GET(req("?draft_id=nope"));
    expect(res.status).toBe(400);
    expect(readDraftCacheMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the feature is disabled", async () => {
    loadSettingsMock.mockResolvedValue({ feature: { enabled: false }, sync: { cooldownSeconds: 30, lockSeconds: 15 } });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(503);
  });

  it("auto-resyncs a warm cache through the lock, passing the known league/season", async () => {
    readDraftCacheMock.mockResolvedValue(CACHE);
    const fresh = { ...CACHE, picks: [{ pickNo: 1 }] };
    performDraftSyncMock.mockResolvedValue({
      status: "synced",
      cache: fresh,
      cooldownRemainingSeconds: 30,
      lastSyncedAt: null,
    });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Returns the freshly re-synced cache, not the stale pre-read.
    expect(body.cache).toEqual(fresh);
    expect(performDraftSyncMock).toHaveBeenCalledOnce();
    // The claim is made with the league/season from the existing cache so the
    // warm-and-fresh path never pre-fetches Sleeper just to resolve them.
    expect(performDraftSyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ draftId: "123", leagueId: "456", season: "2026" }),
    );
  });

  it("returns the existing cache when the resync is denied by the cooldown", async () => {
    readDraftCacheMock.mockResolvedValue(CACHE);
    // Within the cooldown window the claim is denied inside the RPC; performDraftSync
    // returns the current cache with a "cooldown" status and no Sleeper call.
    performDraftSyncMock.mockResolvedValue({
      status: "cooldown",
      cache: CACHE,
      cooldownRemainingSeconds: 12,
      lastSyncedAt: null,
    });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache).toEqual(CACHE);
  });

  it("warms a cold cache via one sync, then returns the warmed cache", async () => {
    readDraftCacheMock.mockResolvedValue(null);
    performDraftSyncMock.mockResolvedValue({ status: "synced", cache: CACHE, cooldownRemainingSeconds: 30, lastSyncedAt: null });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache).toEqual(CACHE);
    expect(performDraftSyncMock).toHaveBeenCalledOnce();
    // No existing cache, so league/season are left for performDraftSync to resolve.
    expect(performDraftSyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ draftId: "123", leagueId: undefined, season: undefined }),
    );
  });

  it("returns 404 when a cold draft cannot be warmed", async () => {
    readDraftCacheMock.mockResolvedValue(null);
    performDraftSyncMock.mockResolvedValue({ status: "error", cache: null, cooldownRemainingSeconds: 0, lastSyncedAt: null });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(404);
  });

  it("falls back to the existing cache when the resync attempt yields none", async () => {
    readDraftCacheMock.mockResolvedValue(CACHE);
    // A transient resync error still returns the cache the route pre-read.
    performDraftSyncMock.mockResolvedValue({ status: "error", cache: null, cooldownRemainingSeconds: 0, lastSyncedAt: null });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache).toEqual(CACHE);
  });
});
