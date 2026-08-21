import { describe, it, expect, vi, beforeEach } from "vitest";

const { performDraftSyncMock, loadSettingsMock, claimSyncRequestBudgetMock } = vi.hoisted(() => ({
  performDraftSyncMock: vi.fn(),
  loadSettingsMock: vi.fn(),
  claimSyncRequestBudgetMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/on-the-clock/settings", () => ({ loadOnTheClockSettings: loadSettingsMock }));
vi.mock("@/lib/on-the-clock/cache", () => ({
  claimSyncRequestBudget: claimSyncRequestBudgetMock,
  SYNC_REQUEST_BUDGET_WINDOW_SECONDS: 60,
}));
// Mock the server-only sync helper (its real module imports "server-only", which
// throws when imported directly in a node test).
vi.mock("@/lib/on-the-clock/sleeper-sync", () => ({ performDraftSync: performDraftSyncMock }));

import { POST } from "./route";

const SYNC = {
  cooldownSeconds: 30,
  lockSeconds: 15,
  autoRefreshEnabled: true,
  autoRefreshSeconds: 60,
};
const ENABLED = { feature: { enabled: true }, sync: SYNC };

/** A stamp `seconds` ago, for exercising the two shared windows. */
function ago(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

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
  claimSyncRequestBudgetMock.mockResolvedValue(true);
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
    loadSettingsMock.mockResolvedValue({ feature: { enabled: false }, sync: SYNC });
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
      // Trusted client IP threaded through for the identifier-independent budget.
      ipKey: expect.any(String),
    });
  });

  it("claims an automatic refresh against the longer shared window", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "synced",
      cooldownRemainingSeconds: 60,
      lastSyncedAt: ago(0),
      cache: null,
    });
    await POST(post({ draft_id: "123", league_id: "456", season: "2026", trigger: "auto" }));
    expect(performDraftSyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cooldownSeconds: 60 }),
    );
  });

  it("treats an unknown trigger as a manual press, not as the longer window", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "synced",
      cooldownRemainingSeconds: 30,
      lastSyncedAt: ago(0),
      cache: null,
    });
    await POST(post({ draft_id: "123", trigger: "AUTO" }));
    expect(performDraftSyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cooldownSeconds: 30 }),
    );
  });

  it("does no work at all for an automatic refresh when auto refresh is off", async () => {
    loadSettingsMock.mockResolvedValue({
      feature: { enabled: true },
      sync: { ...SYNC, autoRefreshEnabled: false },
    });
    const res = await POST(post({ draft_id: "123", trigger: "auto" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.autoRefreshEnabled).toBe(false);
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("still serves a manual press when auto refresh is off", async () => {
    loadSettingsMock.mockResolvedValue({
      feature: { enabled: true },
      sync: { ...SYNC, autoRefreshEnabled: false },
    });
    performDraftSyncMock.mockResolvedValue({
      status: "synced",
      cooldownRemainingSeconds: 30,
      lastSyncedAt: ago(0),
      cache: null,
    });
    const res = await POST(post({ draft_id: "123" }));
    expect(res.status).toBe(200);
    expect(performDraftSyncMock).toHaveBeenCalled();
  });

  it("reports BOTH windows from the draft stamp, whatever the caller claimed", async () => {
    performDraftSyncMock.mockResolvedValue({
      // An automatic refresh denied inside the claim reports its remainder against
      // the 60s window; the response still has to carry the manual number too.
      status: "cooldown",
      cooldownRemainingSeconds: 20,
      lastSyncedAt: ago(40),
      cache: null,
    });
    const res = await POST(post({ draft_id: "123", trigger: "auto" }));
    const body = await res.json();
    // 40s elapsed: the manual window (30s) is open, the auto window (60s) is not.
    expect(body.cooldownRemainingSeconds).toBe(0);
    expect(body.autoRemainingSeconds).toBeGreaterThan(0);
    expect(body.autoRemainingSeconds).toBeLessThanOrEqual(20);
  });

  it("surfaces a cooldown status with remaining seconds and the cached shape", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "cooldown",
      cooldownRemainingSeconds: 18,
      lastSyncedAt: ago(12),
      cache: { draft: { sleeperDraftId: "123" }, users: [], rosters: [], picks: [] },
    });
    const res = await POST(post({ draft_id: "123" }));
    const body = await res.json();
    expect(body.status).toBe("cooldown");
    // Recomputed from the stamp rather than echoed: 12s into a 30s window.
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

  it("refuses past the per-network request ceiling before touching settings", async () => {
    claimSyncRequestBudgetMock.mockResolvedValue(false);
    const res = await POST(post({ draft_id: "123" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryInSeconds).toBe(60);
    // The ceiling has to come before the work it exists to bound.
    expect(loadSettingsMock).not.toHaveBeenCalled();
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("fails closed when the request ceiling cannot be evaluated", async () => {
    claimSyncRequestBudgetMock.mockRejectedValue(new Error("rpc down"));
    const res = await POST(post({ draft_id: "123" }));
    expect(res.status).toBe(429);
    expect(performDraftSyncMock).not.toHaveBeenCalled();
  });

  it("passes the caller's held stamp through so an unchanged draft is not resent", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "cooldown",
      cooldownRemainingSeconds: 5,
      lastSyncedAt: ago(5),
      cache: null,
    });
    await POST(post({ draft_id: "123", known_last_synced_at: "2026-08-20T18:00:00.000Z" }));
    expect(performDraftSyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ knownLastSyncedAt: "2026-08-20T18:00:00.000Z" }),
    );
  });

  it("ignores an over-long stamp rather than trusting it", async () => {
    performDraftSyncMock.mockResolvedValue({
      status: "cooldown",
      cooldownRemainingSeconds: 5,
      lastSyncedAt: ago(5),
      cache: null,
    });
    await POST(post({ draft_id: "123", known_last_synced_at: "x".repeat(500) }));
    expect(performDraftSyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ knownLastSyncedAt: undefined }),
    );
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
