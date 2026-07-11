import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAdminClientMock, getUserMock, loadSettingsMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  loadSettingsMock: vi.fn(),
}));

// unstable_cache is a pass-through in tests so the shared board query runs
// live against fixtures and never returns a stale cross-test cache entry.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/signal-scout/settings", () => ({
  loadSignalScoutSettings: loadSettingsMock,
}));

vi.mock("@/lib/signal-scout/streaks", () => ({
  currentEasternGameDate: () => "2026-07-09",
}));

import { GET } from "./route";
import { scoutFallbackLabel } from "@/lib/user-identity";

const ME = "me-user";
const TODAY = "2026-07-09";

// ---------------------------------------------------------------------------
// Fake Supabase query builder that simulates the PostgREST semantics the route
// relies on: eq / gt filters, `user_id NOT IN (...)` exclusion, multi-key
// ordering, .range() slicing, exact-count head queries, and .maybeSingle().
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const state: {
  userStats: Row[];
  dailyScores: Row[];
  adminPrefs: Row[];
  throwOnResolve: boolean;
} = { userStats: [], dailyScores: [], adminPrefs: [], throwOnResolve: false };

function datasetFor(table: string): Row[] {
  if (table === "signal_scout_daily_scores") return state.dailyScores;
  if (table === "signal_scout_user_stats") return state.userStats;
  if (table === "user_preferences") return state.adminPrefs;
  return [];
}

interface BuilderInternals {
  table: string;
  eqFilters: Record<string, unknown>;
  gt: { col: string; val: unknown } | null;
  notIn: Set<string> | null;
  inFilter: { col: string; vals: Set<unknown> } | null;
  orders: { col: string; ascending: boolean }[];
  head: boolean;
}

function resolveRows(b: BuilderInternals): Row[] {
  if (state.throwOnResolve) throw new Error("relation signal_scout secret detail xyz");
  let rows = [...datasetFor(b.table)];
  for (const [col, val] of Object.entries(b.eqFilters)) {
    rows = rows.filter((r) => r[col] === val);
  }
  if (b.gt) {
    const { col, val } = b.gt;
    rows = rows.filter((r) => (r[col] as number) > (val as number));
  }
  if (b.notIn) {
    rows = rows.filter((r) => !b.notIn!.has(r.user_id as string));
  }
  if (b.inFilter) {
    rows = rows.filter((r) => b.inFilter!.vals.has(r[b.inFilter!.col]));
  }
  if (b.orders.length) {
    rows = rows.sort((a, x) => {
      for (const { col, ascending } of b.orders) {
        const av = a[col] as number | string;
        const xv = x[col] as number | string;
        if (av < xv) return ascending ? -1 : 1;
        if (av > xv) return ascending ? 1 : -1;
      }
      return 0;
    });
  }
  return rows;
}

function makeBuilder(table: string) {
  const internals: BuilderInternals = {
    table,
    eqFilters: {},
    gt: null,
    notIn: null,
    inFilter: null,
    orders: [],
    head: false,
  };
  const builder = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      internals.head = Boolean(opts?.head);
      return builder;
    },
    eq(col: string, val: unknown) {
      internals.eqFilters[col] = val;
      return builder;
    },
    gt(col: string, val: unknown) {
      internals.gt = { col, val };
      return builder;
    },
    in(col: string, vals: unknown[]) {
      internals.inFilter = { col, vals: new Set(vals) };
      return builder;
    },
    not(col: string, op: string, val: string) {
      if (col === "user_id" && op === "in") {
        const inner = val.replace(/^\(|\)$/g, "");
        internals.notIn = new Set(
          inner
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
      return builder;
    },
    order(col: string, opts: { ascending: boolean }) {
      internals.orders.push({ col, ascending: opts.ascending });
      return builder;
    },
    range(from: number, to: number) {
      const rows = resolveRows(internals);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
    maybeSingle() {
      const rows = resolveRows(internals);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    // Thenable so `await builder` resolves for exclusion-set fetches (data) and
    // exact-count head queries (count).
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      try {
        const rows = resolveRows(internals);
        const result = internals.head
          ? { count: rows.length, error: null }
          : { data: rows, error: null };
        return Promise.resolve(result).then(onFulfilled);
      } catch (err) {
        return Promise.reject(err).then(onFulfilled, onRejected);
      }
    },
  };
  return builder;
}

// ---------------------------------------------------------------------------
// Auth + storage mocks feeding lib/user-identity.ts resolveUserIdentities().
// Default behavior returns no-data shapes so identities fall back to
// Scout-XXXX labels, keeping the pre-existing label assertions unchanged.
// ---------------------------------------------------------------------------

const authGetUserByIdMock = vi.fn();
const storageCreateSignedUrlsMock = vi.fn();
const rpcMock = vi.fn();

/** The p_identity_key argument passed to the rate-claim RPC on the last call. */
function claimIdentityKey(): string {
  const call = rpcMock.mock.calls.find(([name]) => name === "try_claim_signal_scout_action");
  return (call![1] as { p_identity_key: string }).p_identity_key;
}

function adminClient() {
  return {
    from: (table: string) => makeBuilder(table),
    auth: { admin: { getUserById: authGetUserByIdMock } },
    storage: { from: (_bucket: string) => ({ createSignedUrls: storageCreateSignedUrlsMock }) },
    rpc: rpcMock,
  };
}

/** Registers auth users by id for authGetUserByIdMock; unlisted ids resolve to no user. */
function mockAuthUsers(
  users: Record<string, { email?: string | null; displayName?: string | null }>,
) {
  authGetUserByIdMock.mockImplementation(async (id: string) => {
    const entry = users[id];
    if (!entry) return { data: { user: null }, error: null };
    return {
      data: {
        user: {
          id,
          email: entry.email ?? null,
          user_metadata: entry.displayName !== undefined ? { display_name: entry.displayName } : {},
        },
      },
      error: null,
    };
  });
}

/** Registers signed avatar URLs by storage path for storageCreateSignedUrlsMock. */
function mockSignedUrls(map: Record<string, string>) {
  storageCreateSignedUrlsMock.mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({
      path,
      signedUrl: map[path] ?? null,
      error: map[path] ? null : "not found",
    })),
    error: null,
  }));
}

const ENABLED_LEADERBOARDS = {
  leaderboard_enabled: true,
  daily_enabled: true,
  all_time_enabled: true,
  streak_enabled: true,
  require_login: true,
  hide_admin_users: true,
};

function settings(overrides: Partial<typeof ENABLED_LEADERBOARDS> = {}) {
  return { leaderboards: { ...ENABLED_LEADERBOARDS, ...overrides } };
}

function req(
  path = "/api/games/signal-scout/leaderboards",
  headers: Record<string, string> = { "x-requested-with": "ff-beacon" },
): Request {
  return new Request(`http://test${path}`, { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.userStats = [];
  state.dailyScores = [];
  state.adminPrefs = [];
  state.throwOnResolve = false;
  createAdminClientMock.mockReturnValue(adminClient());
  getUserMock.mockResolvedValue({ data: { user: { id: ME } } });
  loadSettingsMock.mockResolvedValue(settings());
  rpcMock.mockResolvedValue({ data: true, error: null });
  // No auth users and no signed avatar URLs by default, so every row's
  // identity degrades to the deterministic Scout-XXXX fallback, keeping the
  // pre-existing label assertions unchanged.
  mockAuthUsers({});
  mockSignedUrls({});
});

describe("GET /api/games/signal-scout/leaderboards", () => {
  it("rejects a missing x-requested-with header with 403", async () => {
    const res = await GET(req("/api/games/signal-scout/leaderboards", {}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(loadSettingsMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for an unknown board", async () => {
    const res = await GET(req("/api/games/signal-scout/leaderboards?board=nonsense"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns 503 leaderboards_disabled when the master flag is off", async () => {
    loadSettingsMock.mockResolvedValue(settings({ leaderboard_enabled: false }));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "leaderboards_disabled" });
  });

  it("returns 503 leaderboards_disabled when the requested board's flag is off", async () => {
    loadSettingsMock.mockResolvedValue(settings({ daily_enabled: false }));
    const res = await GET(req("/api/games/signal-scout/leaderboards?board=daily"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "leaderboards_disabled" });
  });

  it("returns 401 login_required when require_login is on and there is no session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "login_required" });
  });

  it("coerces and caps the page param", async () => {
    const capped = await GET(req("/api/games/signal-scout/leaderboards?board=all_time&page=999"));
    expect((await capped.json()).page).toBe(200);

    const defaulted = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    expect((await defaulted.json()).page).toBe(1);
  });

  it("excludes hidden users and admins from the all_time rows", async () => {
    state.userStats = [
      { user_id: "normalA", total_points: 1000, rounds_won: 5, rounds_played: 10, best_signal_streak: 3, current_signal_streak: 1, hidden_from_leaderboards: false },
      { user_id: "hiddenU", total_points: 2000, rounds_won: 9, rounds_played: 10, best_signal_streak: 8, current_signal_streak: 2, hidden_from_leaderboards: true },
      { user_id: "adminU", total_points: 1500, rounds_won: 7, rounds_played: 10, best_signal_streak: 6, current_signal_streak: 4, hidden_from_leaderboards: false },
      { user_id: "normalB", total_points: 500, rounds_won: 2, rounds_played: 10, best_signal_streak: 1, current_signal_streak: 0, hidden_from_leaderboards: false },
    ];
    state.adminPrefs = [{ user_id: "adminU", is_admin: true }];

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    const scouts = body.rows.map((r: { scout: string }) => r.scout);
    expect(scouts).toEqual([scoutFallbackLabel("normalA"), scoutFallbackLabel("normalB")]);
    expect(scouts).not.toContain(scoutFallbackLabel("hiddenU"));
    expect(scouts).not.toContain(scoutFallbackLabel("adminU"));
    const serialized = JSON.stringify(body);
    for (const id of ["normalA", "hiddenU", "adminU", "normalB"]) {
      expect(serialized).not.toContain(id);
    }
  });

  it("excludes hidden users and admins from the daily board via the cross-table set", async () => {
    // hiddenU has a daily row but is flagged hidden on user_stats; adminU has a
    // daily row and is an admin. Both must drop from the daily board even
    // though signal_scout_daily_scores has no hidden flag of its own.
    state.dailyScores = [
      { user_id: "normalA", game_date: TODAY, points: 500, rounds: 4, wins: 3, first_play_at: "2026-07-09T10:00:00.000Z" },
      { user_id: "hiddenU", game_date: TODAY, points: 900, rounds: 5, wins: 5, first_play_at: "2026-07-09T09:00:00.000Z" },
      { user_id: "adminU", game_date: TODAY, points: 800, rounds: 5, wins: 4, first_play_at: "2026-07-09T08:00:00.000Z" },
      { user_id: "normalB", game_date: TODAY, points: 300, rounds: 3, wins: 0, first_play_at: "2026-07-09T11:00:00.000Z" },
    ];
    state.userStats = [
      { user_id: "hiddenU", total_points: 9000, rounds_won: 5, rounds_played: 5, best_signal_streak: 5, current_signal_streak: 5, hidden_from_leaderboards: true },
    ];
    state.adminPrefs = [{ user_id: "adminU", is_admin: true }];
    getUserMock.mockResolvedValue({ data: { user: { id: "outsider" } } });

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=daily"));
    const body = await res.json();
    const scouts = body.rows.map((r: { scout: string }) => r.scout);
    expect(scouts).toEqual([scoutFallbackLabel("normalA"), scoutFallbackLabel("normalB")]);
    expect(JSON.stringify(body)).not.toContain("hiddenU");
    expect(JSON.stringify(body)).not.toContain("adminU");
  });

  it("computes daily accuracy to one decimal and nulls it at zero rounds", async () => {
    state.dailyScores = [
      { user_id: "playerA", game_date: TODAY, points: 900, rounds: 4, wins: 3, first_play_at: "2026-07-09T10:00:00.000Z" },
      { user_id: "playerB", game_date: TODAY, points: 800, rounds: 0, wins: 0, first_play_at: "2026-07-09T11:00:00.000Z" },
    ];
    getUserMock.mockResolvedValue({ data: { user: { id: "outsider" } } });

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=daily"));
    const body = await res.json();
    expect(body.rows[0].accuracy).toBe(75);
    expect(body.rows[1].accuracy).toBeNull();
  });

  it("assigns page-aware ranks (page 2 starts at rank 26)", async () => {
    state.userStats = Array.from({ length: 30 }, (_, i) => ({
      user_id: `u${i}`,
      total_points: 3000 - i,
      rounds_won: 1,
      rounds_played: 2,
      best_signal_streak: 1,
      current_signal_streak: 0,
      hidden_from_leaderboards: false,
    }));
    getUserMock.mockResolvedValue({ data: { user: { id: "outsider" } } });

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time&page=2"));
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.rows).toHaveLength(5);
    expect(body.rows[0].rank).toBe(26);
    expect(body.rows[4].rank).toBe(30);
  });

  it("flags the caller's own row with isYou", async () => {
    state.userStats = [
      { user_id: "top", total_points: 2000, rounds_won: 9, rounds_played: 10, best_signal_streak: 8, current_signal_streak: 1, hidden_from_leaderboards: false },
      { user_id: ME, total_points: 1000, rounds_won: 5, rounds_played: 10, best_signal_streak: 4, current_signal_streak: 2, hidden_from_leaderboards: false },
    ];

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    const mine = body.rows.find((r: { scout: string }) => r.scout === scoutFallbackLabel(ME));
    const other = body.rows.find((r: { scout: string }) => r.scout === scoutFallbackLabel("top"));
    expect(mine.isYou).toBe(true);
    expect(other.isYou).toBe(false);
  });

  it("computes the your-rank strip with strictly-better math so ties share the better rank", async () => {
    state.userStats = [
      { user_id: "leader", total_points: 2000, rounds_won: 9, rounds_played: 10, best_signal_streak: 8, current_signal_streak: 1, hidden_from_leaderboards: false },
      { user_id: ME, total_points: 1000, rounds_won: 5, rounds_played: 10, best_signal_streak: 4, current_signal_streak: 2, hidden_from_leaderboards: false },
      { user_id: "tied", total_points: 1000, rounds_won: 4, rounds_played: 10, best_signal_streak: 3, current_signal_streak: 0, hidden_from_leaderboards: false },
      { user_id: "below", total_points: 500, rounds_won: 2, rounds_played: 10, best_signal_streak: 1, current_signal_streak: 0, hidden_from_leaderboards: false },
    ];

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    expect(body.yourRank).not.toBeNull();
    // Only "leader" (2000) is strictly better than 1000, so both 1000-point
    // rows share rank 2.
    expect(body.yourRank.rank).toBe(2);
    expect(body.yourRank.isYou).toBe(true);
    expect(body.yourRank.totalPoints).toBe(1000);
    expect(body.yourRank.winRate).toBe(50);
  });

  it("returns yourRank null when the caller has no row on the board", async () => {
    state.userStats = [
      { user_id: "someone", total_points: 2000, rounds_won: 9, rounds_played: 10, best_signal_streak: 8, current_signal_streak: 1, hidden_from_leaderboards: false },
    ];
    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    expect(body.yourRank).toBeNull();
  });

  it("never places a raw user id in the response, only Scout-XXXX labels", async () => {
    state.userStats = [
      { user_id: "abcd-secret-id", total_points: 1000, rounds_won: 5, rounds_played: 10, best_signal_streak: 4, current_signal_streak: 2, hidden_from_leaderboards: false },
    ];
    getUserMock.mockResolvedValue({ data: { user: { id: "outsider" } } });

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("abcd-secret-id");
    expect(body.rows[0].scout).toBe(scoutFallbackLabel("abcd-secret-id"));
    expect(body.rows[0].scout).toMatch(/^Scout-[0-9a-f]{4}$/);
  });

  it("resolves a scout's display name from user_metadata.display_name", async () => {
    state.userStats = [
      { user_id: "namedUser", total_points: 1200, rounds_won: 6, rounds_played: 10, best_signal_streak: 5, current_signal_streak: 2, hidden_from_leaderboards: false },
    ];
    getUserMock.mockResolvedValue({ data: { user: { id: "outsider" } } });
    mockAuthUsers({ namedUser: { displayName: "Beacon Fan", email: "named@example.com" } });

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    expect(body.rows[0].scout).toBe("Beacon Fan");
  });

  it("falls back to the masked email local part, never the raw local part, when only an email exists", async () => {
    state.userStats = [
      { user_id: "emailOnly", total_points: 900, rounds_won: 3, rounds_played: 10, best_signal_streak: 2, current_signal_streak: 1, hidden_from_leaderboards: false },
    ];
    getUserMock.mockResolvedValue({ data: { user: { id: "outsider" } } });
    mockAuthUsers({ emailOnly: { email: "abcdef@example.com" } });

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    expect(body.rows[0].scout).toBe("ab***");
    expect(JSON.stringify(body)).not.toContain("abcdef");
  });

  it("includes avatarUrl (null or a signed URL) on every row", async () => {
    state.userStats = [
      { user_id: "withAvatar", total_points: 1000, rounds_won: 5, rounds_played: 10, best_signal_streak: 3, current_signal_streak: 1, hidden_from_leaderboards: false },
      { user_id: "withoutAvatar", total_points: 800, rounds_won: 4, rounds_played: 10, best_signal_streak: 2, current_signal_streak: 0, hidden_from_leaderboards: false },
    ];
    state.adminPrefs = [{ user_id: "withAvatar", avatar_path: "avatars/withAvatar.png" }];
    getUserMock.mockResolvedValue({ data: { user: { id: "outsider" } } });
    mockSignedUrls({ "avatars/withAvatar.png": "https://signed.example.com/withAvatar.png" });

    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    const body = await res.json();
    expect(body.rows.every((r: { avatarUrl: string | null }) => "avatarUrl" in r)).toBe(true);
    const withAvatarRow = body.rows.find(
      (r: { scout: string }) => r.scout === scoutFallbackLabel("withAvatar"),
    );
    const withoutAvatarRow = body.rows.find(
      (r: { scout: string }) => r.scout === scoutFallbackLabel("withoutAvatar"),
    );
    expect(withAvatarRow.avatarUrl).toBe("https://signed.example.com/withAvatar.png");
    expect(withoutAvatarRow.avatarUrl).toBeNull();
  });

  it("returns 429 rate_limited when the leaderboards claim is denied", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("does not spend a rate claim on the require_login 401 path", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("keys the rate claim on the signed-in user id when a session exists", async () => {
    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    expect(res.status).toBe(200);
    expect(claimIdentityKey()).toBe(`user:${ME}`);
  });

  it("keys the rate claim on the salted IP hash for an anonymous caller when require_login is off", async () => {
    loadSettingsMock.mockResolvedValue(settings({ require_login: false }));
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(
      req("/api/games/signal-scout/leaderboards?board=all_time", {
        "x-requested-with": "ff-beacon",
        "x-forwarded-for": "203.0.113.5",
      }),
    );
    expect(res.status).toBe(200);
    expect(claimIdentityKey()).toMatch(/^ip:/);
  });

  it("maps an unexpected throw to 500 server_error without leaking DB detail", async () => {
    state.throwOnResolve = true;
    const res = await GET(req("/api/games/signal-scout/leaderboards?board=all_time"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });
});
