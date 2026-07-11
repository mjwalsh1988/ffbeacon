import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAdminClientMock, getUserMock, maybeSingleMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

import { GET } from "./route";

/** signal_scout_user_stats query builder: from().select().eq().maybeSingle(). */
function adminClient() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: maybeSingleMock,
  };
  return { from: vi.fn(() => builder) };
}

function req(headers: Record<string, string> = { "x-requested-with": "ff-beacon" }): Request {
  return new Request("http://test/api/games/signal-scout/me/stats", { method: "GET", headers });
}

const FULL_ROW = {
  user_id: "user-1",
  total_points: 4200,
  rounds_played: 30,
  rounds_won: 18,
  rounds_solved_late: 4,
  rounds_failed: 5,
  rounds_skipped: 3,
  rounds_burned: 6,
  total_hints: 41,
  total_wrong_guesses: 22,
  current_signal_streak: 2,
  best_signal_streak: 7,
  current_daily_streak: 3,
  best_daily_streak: 9,
  last_played_date: "2026-07-09",
  first_played_at: "2026-06-01T12:00:00.000Z",
  updated_at: "2026-07-09T15:00:00.000Z",
  hidden_from_leaderboards: false,
  hidden_reason: null,
  hidden_by: null,
  hidden_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue(adminClient());
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  maybeSingleMock.mockResolvedValue({ data: FULL_ROW, error: null });
});

describe("GET /api/games/signal-scout/me/stats", () => {
  it("rejects a missing x-requested-with header with 403 and does nothing else", async () => {
    const res = await GET(req({}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns 401 login_required for an anonymous caller", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "login_required" });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns 200 with stats: null for a user who has never played", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stats: null });
  });

  it("returns the full camelCased aggregate shape for an existing row", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stats: {
        totalPoints: 4200,
        roundsPlayed: 30,
        roundsWon: 18,
        roundsSolvedLate: 4,
        roundsFailed: 5,
        roundsSkipped: 3,
        roundsBurned: 6,
        totalHints: 41,
        totalWrongGuesses: 22,
        currentSignalStreak: 2,
        bestSignalStreak: 7,
        currentDailyStreak: 3,
        bestDailyStreak: 9,
        lastPlayedDate: "2026-07-09",
        firstPlayedAt: "2026-06-01T12:00:00.000Z",
        updatedAt: "2026-07-09T15:00:00.000Z",
        hiddenFromLeaderboards: false,
      },
    });
  });

  it("never leaks a raw user id in the response", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("user-1");
  });

  it("maps an unexpected throw to 500 server_error without leaking DB detail", async () => {
    maybeSingleMock.mockRejectedValue(new Error("relation signal_scout_user_stats secret detail xyz"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });
});
