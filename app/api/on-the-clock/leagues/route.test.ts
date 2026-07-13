import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks so tests can control return values and assert call counts.
const {
  getSleeperUserMock,
  getSleeperLeaguesMock,
  claimLookupMock,
  claimIpBudgetMock,
  loadSettingsMock,
} = vi.hoisted(() => ({
  getSleeperUserMock: vi.fn(),
  getSleeperLeaguesMock: vi.fn(),
  claimLookupMock: vi.fn(),
  claimIpBudgetMock: vi.fn(),
  loadSettingsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/on-the-clock/settings", () => ({ loadOnTheClockSettings: loadSettingsMock }));
vi.mock("@/lib/on-the-clock/cache", () => ({
  claimLookup: claimLookupMock,
  claimIpBudget: claimIpBudgetMock,
}));
// Format detection is exercised in its own unit test; here we stub it so the route
// test stays focused on the guard/validation/shaping behavior and does not touch the
// (empty) admin client. detectLeagueFormat returns a canned detected format.
vi.mock("@/lib/on-the-clock/format-detect", () => ({
  ffbeaconFormatCandidates: async () => [],
  detectLeagueFormat: () => ({
    slug: "dynasty-ppr-sflex",
    label: "Dynasty Superflex",
    derivedLabel: "Dynasty PPR Superflex",
    isClosest: false,
  }),
}));
vi.mock("@/lib/sleeper", () => ({
  getSleeperUser: getSleeperUserMock,
  getSleeperLeagues: getSleeperLeaguesMock,
  currentNflSeason: () => "2026",
}));

import { GET } from "./route";

const ENABLED = { feature: { enabled: true }, limits: { maxActiveLeagues: 10 } };

function req(qs: string, headers: Record<string, string> = { "x-requested-with": "ff-beacon" }) {
  return new Request(`http://test/api/on-the-clock/leagues${qs}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSettingsMock.mockResolvedValue(ENABLED);
  claimLookupMock.mockResolvedValue(true);
  claimIpBudgetMock.mockResolvedValue(true);
});

describe("GET /api/on-the-clock/leagues", () => {
  it("rejects a missing header guard with 403 and never calls Sleeper", async () => {
    const res = await GET(req("?username=Mike&season=2026", {}));
    expect(res.status).toBe(403);
    expect(getSleeperUserMock).not.toHaveBeenCalled();
    expect(claimLookupMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid username with 400 before any Sleeper/guard call", async () => {
    const res = await GET(req("?username=bad%20name&season=2026"));
    expect(res.status).toBe(400);
    expect(claimLookupMock).not.toHaveBeenCalled();
    expect(getSleeperUserMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid season with 400", async () => {
    const res = await GET(req("?username=Mike&season=20"));
    expect(res.status).toBe(400);
    expect(getSleeperUserMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the feature is disabled", async () => {
    loadSettingsMock.mockResolvedValue({ feature: { enabled: false }, limits: { maxActiveLeagues: 10 } });
    const res = await GET(req("?username=Mike&season=2026"));
    expect(res.status).toBe(503);
    expect(claimLookupMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the durable lookup guard denies", async () => {
    claimLookupMock.mockResolvedValue(false);
    const res = await GET(req("?username=Mike&season=2026"));
    expect(res.status).toBe(429);
    expect(getSleeperUserMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown Sleeper user", async () => {
    getSleeperUserMock.mockResolvedValue(null);
    const res = await GET(req("?username=Mike&season=2026"));
    expect(res.status).toBe(404);
  });

  it("returns every league with a draft_id staged drafting > pre_draft > completed, with shaped cards", async () => {
    getSleeperUserMock.mockResolvedValue({ user_id: "u1", username: "mike" });
    getSleeperLeaguesMock.mockResolvedValue([
      { league_id: "L_pre", name: "Pre", season: "2026", total_rosters: 12, status: "pre_draft", draft_id: "D_pre", avatar: null },
      { league_id: "L_drft", name: "Drafting", season: "2026", total_rosters: 10, status: "drafting", draft_id: "D_drft", avatar: "a1" },
      { league_id: "L_done", name: "Done", season: "2026", total_rosters: 12, status: "complete", draft_id: "D_done" },
      { league_id: "L_season", name: "InSeason", season: "2026", total_rosters: 12, status: "in_season", draft_id: "D_s" },
      { league_id: "L_nodraft", name: "NoDraft", season: "2026", total_rosters: 12, status: "drafting", draft_id: null },
    ]);

    const res = await GET(req("?username=Mike&season=2026"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.truncated).toBe(false);
    // Completed / in-season drafts ARE included, after active + pre-draft.
    expect(body.leagues.map((l: { leagueId: string }) => l.leagueId)).toEqual([
      "L_drft",
      "L_pre",
      "L_done",
      "L_season",
    ]);
    expect(body.leagues[0]).toMatchObject({
      leagueId: "L_drft",
      draftId: "D_drft",
      season: "2026",
      name: "Drafting",
      totalRosters: 10,
      draftStatus: "drafting",
      stage: "drafting",
      // Format is auto-detected per league (stubbed here) and returned on the card.
      formatSlug: "dynasty-ppr-sflex",
      formatLabel: "Dynasty Superflex",
    });
    expect(body.leagues[2]).toMatchObject({ leagueId: "L_done", stage: "completed" });
    expect(body.leagues[3]).toMatchObject({ leagueId: "L_season", stage: "completed" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("flags truncated when a stage exceeds the cap, without starving other stages", async () => {
    loadSettingsMock.mockResolvedValue({ feature: { enabled: true }, limits: { maxActiveLeagues: 1 } });
    getSleeperUserMock.mockResolvedValue({ user_id: "u1", username: "mike" });
    getSleeperLeaguesMock.mockResolvedValue([
      { league_id: "L1", name: "A", season: "2026", total_rosters: 12, status: "drafting", draft_id: "D1" },
      { league_id: "L2", name: "B", season: "2026", total_rosters: 12, status: "drafting", draft_id: "D2" },
      { league_id: "L3", name: "C", season: "2026", total_rosters: 12, status: "in_season", draft_id: "D3" },
    ]);
    const res = await GET(req("?username=Mike&season=2026"));
    const body = await res.json();
    // One drafting league (capped) + the completed league (its own stage cap).
    expect(body.leagues.map((l: { leagueId: string }) => l.leagueId)).toEqual(["L1", "L3"]);
    expect(body.truncated).toBe(true);
  });
});
