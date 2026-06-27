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
const CACHE = { draft: { sleeperDraftId: "123" }, users: [], rosters: [], picks: [] };

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

  it("serves a warm cache WITHOUT any Sleeper / warm-sync call", async () => {
    readDraftCacheMock.mockResolvedValue(CACHE);
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cache).toEqual(CACHE);
    // The read path must not trigger a sync when the cache is warm.
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("warms a cold cache via one sync, then returns the warmed cache", async () => {
    readDraftCacheMock.mockResolvedValue(null);
    performDraftSyncMock.mockResolvedValue({ status: "synced", cache: CACHE, cooldownRemainingSeconds: 30, lastSyncedAt: null });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache).toEqual(CACHE);
    expect(performDraftSyncMock).toHaveBeenCalledOnce();
  });

  it("returns 404 when a cold draft cannot be warmed", async () => {
    readDraftCacheMock.mockResolvedValue(null);
    performDraftSyncMock.mockResolvedValue({ status: "error", cache: null, cooldownRemainingSeconds: 0, lastSyncedAt: null });
    const res = await GET(req("?draft_id=123"));
    expect(res.status).toBe(404);
  });
});
