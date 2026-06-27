import { describe, it, expect, vi, beforeEach } from "vitest";

const { loadSettingsMock, loadBoardMock } = vi.hoisted(() => ({
  loadSettingsMock: vi.fn(),
  loadBoardMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/on-the-clock/settings", () => ({ loadOnTheClockSettings: loadSettingsMock }));
vi.mock("@/lib/on-the-clock/board-loader", () => ({ loadRankedBoard: loadBoardMock }));
vi.mock("@/lib/sleeper", () => ({ currentNflSeason: () => "2026" }));

import { GET } from "./route";

function req(qs: string, headers: Record<string, string> = { "x-requested-with": "ff-beacon" }) {
  return new Request(`http://test/api/on-the-clock/board${qs}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSettingsMock.mockResolvedValue({ feature: { enabled: true } });
  loadBoardMock.mockResolvedValue({ status: "ok", players: [], sourceSlug: "ffbeacon", sourceActive: true });
});

describe("GET /api/on-the-clock/board", () => {
  it("rejects a missing header guard with 403", async () => {
    const res = await GET(req("?format=dynasty-ppr-sflex", {}));
    expect(res.status).toBe(403);
    expect(loadBoardMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid format slug with 400", async () => {
    const res = await GET(req("?format=Not_A_Slug"));
    expect(res.status).toBe(400);
    expect(loadBoardMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the feature is disabled", async () => {
    loadSettingsMock.mockResolvedValue({ feature: { enabled: false } });
    const res = await GET(req("?format=dynasty-ppr-sflex"));
    expect(res.status).toBe(503);
    expect(loadBoardMock).not.toHaveBeenCalled();
  });

  it("loads the board for the requested format (source forced to FF Beacon by the loader)", async () => {
    const res = await GET(req("?format=dynasty-ppr-sflex"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.board.sourceSlug).toBe("ffbeacon");
    // The route never passes a source; the loader forces FF Beacon.
    expect(loadBoardMock).toHaveBeenCalledWith(expect.anything(), {
      formatSlug: "dynasty-ppr-sflex",
      rookieSeason: "2026",
    });
  });
});
