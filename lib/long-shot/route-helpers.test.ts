import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserMock, settingsMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  settingsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
  createAdminClient: () => ({}),
}));
vi.mock("./settings", () => ({ loadLongShotSettings: settingsMock }));
vi.mock("@/lib/rate-limit-claim", () => ({ claimRateLimitSlot: vi.fn(async () => true) }));

import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { LongShotError } from "./errors";
import { guardRequest, handleRouteError } from "./route-helpers";

const req = (headers: Record<string, string> = {}) =>
  new Request("http://test/api/games/long-shot/state", { headers });
const withHeader = () => req({ "x-requested-with": "ff-beacon" });

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
  settingsMock.mockResolvedValue(DEFAULT_LONG_SHOT_SETTINGS);
});

describe("guardRequest", () => {
  it("403 without the header", async () => {
    const r = await guardRequest(req());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      expect(await r.response.json()).toEqual({ error: "forbidden" });
    }
  });

  it("401 without a user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const r = await guardRequest(withHeader());
    expect(!r.ok && r.response.status).toBe(401);
  });

  it("503 when the game is disabled", async () => {
    settingsMock.mockResolvedValue({ ...DEFAULT_LONG_SHOT_SETTINGS, game_enabled: false });
    const r = await guardRequest(withHeader());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(503);
      expect(await r.response.json()).toEqual({ error: "game_disabled" });
    }
  });

  it("passes with header, user and the game on, and responses are no-store", async () => {
    const r = await guardRequest(withHeader());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe("u1");
  });
});

describe("handleRouteError", () => {
  it("maps a LongShotError to its code and never leaks other errors", async () => {
    const known = handleRouteError(new LongShotError("stale_prompt"), "t");
    expect(known.status).toBe(409);
    expect(known.headers.get("Cache-Control")).toContain("no-store");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown = handleRouteError(new Error("db password is hunter2"), "t");
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: "server_error" });
  });
});
