import { describe, it, expect, vi, beforeEach } from "vitest";

const { performDraftSyncMock, loadSettingsMock } = vi.hoisted(() => ({
  performDraftSyncMock: vi.fn(),
  loadSettingsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/on-the-clock/settings", () => ({ loadOnTheClockSettings: loadSettingsMock }));
// Mock the server-only sync helper (its real module imports "server-only", which
// throws when imported directly in a node test).
vi.mock("@/lib/on-the-clock/sleeper-sync", () => ({ performDraftSync: performDraftSyncMock }));

import { POST } from "./route";

const ENABLED = { feature: { enabled: true }, sync: { cooldownSeconds: 30, lockSeconds: 15 } };

function post(body: unknown, headers: Record<string, string> = { "x-requested-with": "ff-beacon" }) {
  return new Request("http://test/api/on-the-clock/draft/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSettingsMock.mockResolvedValue(ENABLED);
});

describe("POST /api/on-the-clock/draft/sync", () => {
  it("rejects a missing header guard with 403 and never syncs", async () => {
    const res = await POST(post({ draft_id: "123" }, {}));
    expect(res.status).toBe(403);
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid draft id with 400 and never syncs", async () => {
    const res = await POST(post({ draft_id: "not-numeric" }));
    expect(res.status).toBe(400);
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed league_id with 400", async () => {
    const res = await POST(post({ draft_id: "123", league_id: "abc" }));
    expect(res.status).toBe(400);
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the feature is disabled", async () => {
    loadSettingsMock.mockResolvedValue({ feature: { enabled: false }, sync: { cooldownSeconds: 30, lockSeconds: 15 } });
    const res = await POST(post({ draft_id: "123" }));
    expect(res.status).toBe(503);
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("passes a synced outcome through with ok:true", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "synced",
      cooldownRemainingSeconds: 30,
      lastSyncedAt: "2026-06-26T00:00:00Z",
      cache: { draft: { sleeperDraftId: "123" }, users: [], rosters: [], picks: [] },
    });
    const res = await POST(post({ draft_id: "123", league_id: "456", season: "2026" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("synced");
    expect(performDraftSyncMock).toHaveBeenCalledWith(expect.anything(), {
      draftId: "123",
      leagueId: "456",
      season: "2026",
      cooldownSeconds: 30,
      lockSeconds: 15,
    });
  });

  it("surfaces a cooldown status with remaining seconds and the cached shape", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "cooldown",
      cooldownRemainingSeconds: 18,
      lastSyncedAt: "2026-06-26T00:00:00Z",
      cache: { draft: { sleeperDraftId: "123" }, users: [], rosters: [], picks: [] },
    });
    const res = await POST(post({ draft_id: "123" }));
    const body = await res.json();
    expect(body.status).toBe("cooldown");
    expect(body.cooldownRemainingSeconds).toBe(18);
    expect(body.cache).not.toBeNull();
  });

  it("surfaces a synced-by-other status", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "synced-by-other",
      cooldownRemainingSeconds: 0,
      lastSyncedAt: null,
      cache: { draft: { sleeperDraftId: "123" }, users: [], rosters: [], picks: [] },
    });
    const res = await POST(post({ draft_id: "123" }));
    const body = await res.json();
    expect(body.status).toBe("synced-by-other");
  });

  it("returns ok:false with a safe error on the sync error path", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "error",
      cooldownRemainingSeconds: 0,
      lastSyncedAt: null,
      cache: null,
      error: "Sync failed. Try again shortly.",
    });
    const res = await POST(post({ draft_id: "123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
    expect(body.error).toBe("Sync failed. Try again shortly.");
  });

  it("returns 400 on a malformed JSON body", async () => {
    const res = await POST(
      new Request("http://test/api/on-the-clock/draft/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "ff-beacon" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });
});
