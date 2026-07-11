import { describe, it, expect, vi } from "vitest";
import { unstable_cache } from "next/cache";
import {
  round1,
  identityFor,
  mapRows,
  loadLeaderboardPreview,
  cachedResolveIdentities,
  PREVIEW_SIZE,
  type Client,
  type DailyBoardRow,
  type AllTimeBoardRow,
  type StreakBoardRow,
} from "./leaderboards";
import { scoutFallbackLabel, type ResolvedUserIdentity } from "@/lib/user-identity";

// These cover the pure pieces extracted out of the route (round1, identityFor,
// mapRows shapes). The full HTTP behavior (auth gates, exclusion, your-rank,
// caching) stays pinned by app/api/games/signal-scout/leaderboards/route.test.ts;
// nothing here duplicates those assertions.

// unstable_cache is a pass-through in tests, matching route.test.ts's mock:
// outside a real Next.js request context it does not behave like a cache, so
// the preview loader below runs its query live against fixtures. Wrapped in
// vi.fn(fn) rather than a bare arrow function so the cachedResolveIdentities
// tests below can assert on what was passed to unstable_cache and to the
// spy it returns, without changing the pass-through behavior itself.
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => unknown) => vi.fn(fn)),
}));
vi.mock("./streaks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./streaks")>();
  return { ...actual, currentEasternGameDate: () => "2026-07-09" };
});

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(66.66666)).toBe(66.7);
    expect(round1(50)).toBe(50);
    expect(round1(33.33)).toBe(33.3);
  });
});

describe("identityFor", () => {
  it("returns the resolved identity when present", () => {
    const identities = new Map<string, ResolvedUserIdentity>([
      ["u1", { displayName: "Beacon Fan", avatarUrl: "https://example.com/a.png" }],
    ]);
    expect(identityFor(identities, "u1")).toEqual({
      displayName: "Beacon Fan",
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("falls back to the deterministic Scout-XXXX label when missing from the map", () => {
    const identities = new Map<string, ResolvedUserIdentity>();
    const identity = identityFor(identities, "missing-user");
    expect(identity.displayName).toBe(scoutFallbackLabel("missing-user"));
    expect(identity.avatarUrl).toBeNull();
  });
});

describe("mapRows", () => {
  const identities = new Map<string, ResolvedUserIdentity>([
    ["u1", { displayName: "Scout One", avatarUrl: null }],
    ["u2", { displayName: "Scout Two", avatarUrl: "https://example.com/two.png" }],
  ]);

  it("maps daily rows with page-aware ranks, isYou, and computed accuracy", () => {
    const rawRows = [
      { user_id: "u1", points: 900, rounds: 4, wins: 3, first_play_at: "2026-07-09T10:00:00.000Z" },
      { user_id: "u2", points: 500, rounds: 0, wins: 0, first_play_at: "2026-07-09T11:00:00.000Z" },
    ];
    const rows = mapRows("daily", rawRows, 2, "u1", identities) as DailyBoardRow[];
    expect(rows[0]).toMatchObject({
      rank: 26,
      scout: "Scout One",
      avatarUrl: null,
      isYou: true,
      points: 900,
      rounds: 4,
      accuracy: 75,
    });
    expect(rows[1]).toMatchObject({ rank: 27, isYou: false, accuracy: null });
  });

  it("maps all_time rows with wins/winRate/bestStreak", () => {
    const rawRows = [
      { user_id: "u2", total_points: 1200, rounds_won: 6, rounds_played: 10, best_signal_streak: 5 },
    ];
    const rows = mapRows("all_time", rawRows, 1, null, identities) as AllTimeBoardRow[];
    expect(rows[0]).toMatchObject({
      rank: 1,
      scout: "Scout Two",
      avatarUrl: "https://example.com/two.png",
      isYou: false,
      totalPoints: 1200,
      wins: 6,
      winRate: 60,
      bestStreak: 5,
    });
  });

  it("maps streak rows with bestStreak/currentStreak/totalPoints", () => {
    const rawRows = [
      { user_id: "u1", best_signal_streak: 8, current_signal_streak: 3, total_points: 4200 },
    ];
    const rows = mapRows("streak", rawRows, 1, "u1", identities) as StreakBoardRow[];
    expect(rows[0]).toMatchObject({
      rank: 1,
      scout: "Scout One",
      isYou: true,
      bestStreak: 8,
      currentStreak: 3,
      totalPoints: 4200,
    });
  });
});

// ---------------------------------------------------------------------------
// loadLeaderboardPreview coverage. A minimal fake Supabase client scoped to
// exactly what buildExclusionSet + queryBoardRows(daily) + resolveUserIdentities
// touch. This is deliberately smaller than the full query builder in
// app/api/games/signal-scout/leaderboards/route.test.ts (that file pins the
// paginated route's full HTTP behavior); the preview loader only ever queries
// the daily board, page 1, so it does not need range/count/gt/maybeSingle
// support.
// ---------------------------------------------------------------------------

interface PreviewState {
  dailyScores: Record<string, unknown>[];
  userStats: Record<string, unknown>[];
  userPrefs: Record<string, unknown>[];
}

interface PreviewBuilderInternals {
  table: string;
  eqFilters: Record<string, unknown>;
  notIn: Set<string> | null;
  inFilter: { col: string; vals: Set<unknown> } | null;
  orders: { col: string; ascending: boolean }[];
}

function previewDatasetFor(state: PreviewState, table: string): Record<string, unknown>[] {
  if (table === "signal_scout_daily_scores") return state.dailyScores;
  if (table === "signal_scout_user_stats") return state.userStats;
  if (table === "user_preferences") return state.userPrefs;
  return [];
}

function resolvePreviewRows(
  state: PreviewState,
  b: PreviewBuilderInternals,
): Record<string, unknown>[] {
  let rows = [...previewDatasetFor(state, b.table)];
  for (const [col, val] of Object.entries(b.eqFilters)) rows = rows.filter((r) => r[col] === val);
  if (b.notIn) rows = rows.filter((r) => !b.notIn!.has(r.user_id as string));
  if (b.inFilter) rows = rows.filter((r) => b.inFilter!.vals.has(r[b.inFilter!.col]));
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

function makePreviewBuilder(state: PreviewState, table: string) {
  const internals: PreviewBuilderInternals = { table, eqFilters: {}, notIn: null, inFilter: null, orders: [] };
  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      internals.eqFilters[col] = val;
      return builder;
    },
    in(col: string, vals: unknown[]) {
      internals.inFilter = { col, vals: new Set(vals) };
      return builder;
    },
    not(col: string, op: string, val: string) {
      if (col === "user_id" && op === "in") {
        internals.notIn = new Set(
          val
            .replace(/^\(|\)$/g, "")
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
      return Promise.resolve({ data: resolvePreviewRows(state, internals).slice(from, to + 1), error: null });
    },
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve({ data: resolvePreviewRows(state, internals), error: null }).then(
        onFulfilled,
        onRejected,
      );
    },
  };
  return builder;
}

function fakePreviewAdmin(state: PreviewState): Client {
  return {
    from: (table: string) => makePreviewBuilder(state, table),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: null, error: "not found" })),
          error: null,
        }),
      }),
    },
  } as unknown as Client;
}

describe("loadLeaderboardPreview", () => {
  it("returns up to PREVIEW_SIZE daily rows in board order, excluding hidden/admin users", async () => {
    const state: PreviewState = {
      dailyScores: Array.from({ length: 8 }, (_, i) => ({
        user_id: `u${i}`,
        game_date: "2026-07-09",
        points: 900 - i * 10,
        rounds: 3,
        wins: 2,
        first_play_at: `2026-07-09T10:0${i}:00.000Z`,
      })),
      userStats: [{ user_id: "u1", hidden_from_leaderboards: true }],
      userPrefs: [{ user_id: "u2", is_admin: true }],
    };

    const rows = await loadLeaderboardPreview(fakePreviewAdmin(state), true, null);

    expect(rows).toHaveLength(PREVIEW_SIZE);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.isYou === false)).toBe(true);
    const scouts = rows.map((r) => r.scout);
    expect(scouts).not.toContain(scoutFallbackLabel("u1"));
    expect(scouts).not.toContain(scoutFallbackLabel("u2"));
  });

  it("flags the caller's own row with isYou when meId is on the board, false for everyone else", async () => {
    const state: PreviewState = {
      dailyScores: [
        { user_id: "top", game_date: "2026-07-09", points: 900, rounds: 3, wins: 2, first_play_at: "2026-07-09T10:00:00.000Z" },
        { user_id: "me", game_date: "2026-07-09", points: 800, rounds: 3, wins: 2, first_play_at: "2026-07-09T10:01:00.000Z" },
      ],
      userStats: [],
      userPrefs: [],
    };

    const rows = await loadLeaderboardPreview(fakePreviewAdmin(state), false, "me");

    const mine = rows.find((r) => r.scout === scoutFallbackLabel("me"));
    const other = rows.find((r) => r.scout === scoutFallbackLabel("top"));
    expect(mine?.isYou).toBe(true);
    expect(other?.isYou).toBe(false);
  });

  it("returns an empty array when the daily board has no rows", async () => {
    const rows = await loadLeaderboardPreview(
      fakePreviewAdmin({ dailyScores: [], userStats: [], userPrefs: [] }),
      false,
      null,
    );
    expect(rows).toEqual([]);
  });

  it("swallows errors and returns an empty array instead of throwing", async () => {
    const throwingAdmin = {
      from: () => {
        throw new Error("boom");
      },
    } as unknown as Client;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const rows = await loadLeaderboardPreview(throwingAdmin, false, null);

    expect(rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith("[signal-scout]", expect.any(Error));
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// cachedResolveIdentities: SS-T051 fix 2b. resolveUserIdentities returns a
// Map, which unstable_cache's return-value JSON serialization cannot carry,
// so the cached function converts to a plain [id, identity][] entries array
// and cachedResolveIdentities rebuilds the Map on the way out. These tests
// prove that round trip, not resolveUserIdentities' own field-resolution
// logic (that stays covered by lib/user-identity.test.ts and the leaderboard
// route/page fixtures above).
// ---------------------------------------------------------------------------

interface FakeIdentityAdminOptions {
  prefs?: Record<string, { firstName?: string | null; lastName?: string | null; avatarPath?: string | null }>;
  authUsers?: Record<string, { email?: string | null; displayName?: string | null }>;
  signedUrls?: Record<string, string>;
}

function fakeIdentityAdmin(opts: FakeIdentityAdminOptions): Client {
  const prefs = opts.prefs ?? {};
  const authUsers = opts.authUsers ?? {};
  const signedUrls = opts.signedUrls ?? {};

  return {
    from: (table: string) => {
      if (table !== "user_preferences") {
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      }
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => ({
            data: ids
              .filter((id) => prefs[id])
              .map((id) => ({
                user_id: id,
                first_name: prefs[id]!.firstName ?? null,
                last_name: prefs[id]!.lastName ?? null,
                avatar_path: prefs[id]!.avatarPath ?? null,
              })),
            error: null,
          }),
        }),
      };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const entry = authUsers[id];
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
        },
      },
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({
            path,
            signedUrl: signedUrls[path] ?? null,
            error: signedUrls[path] ? null : "not found",
          })),
          error: null,
        }),
      }),
    },
  } as unknown as Client;
}

describe("cachedResolveIdentities", () => {
  it("rebuilds a Map from the cached entries array, so rows still resolve display names and avatarUrls", async () => {
    const admin = fakeIdentityAdmin({
      prefs: { u1: { avatarPath: "avatars/u1.png" } },
      authUsers: { u1: { displayName: "Beacon Fan" }, u2: { email: "abcdef@example.com" } },
      signedUrls: { "avatars/u1.png": "https://signed.example.com/u1.png" },
    });

    const result = await cachedResolveIdentities(admin, ["u2", "u1"]);

    expect(result).toBeInstanceOf(Map);
    expect(result.get("u1")).toEqual({
      displayName: "Beacon Fan",
      avatarUrl: "https://signed.example.com/u1.png",
    });
    expect(result.get("u2")).toEqual({ displayName: "ab***", avatarUrl: null });
  });

  it("falls back to the deterministic Scout-XXXX label for an id absent from every source", async () => {
    const admin = fakeIdentityAdmin({});
    const result = await cachedResolveIdentities(admin, ["ghost"]);
    expect(result.get("ghost")).toEqual({ displayName: scoutFallbackLabel("ghost"), avatarUrl: null });
  });

  it("sorts ids before invoking the cache, so the key does not depend on Set iteration order", async () => {
    const admin = fakeIdentityAdmin({ authUsers: { u1: { displayName: "A" }, u2: { displayName: "B" } } });

    await cachedResolveIdentities(admin, ["u2", "u1"]);

    const cachedSpy = vi.mocked(unstable_cache).mock.results.at(-1)!.value as ReturnType<typeof vi.fn>;
    expect(cachedSpy.mock.calls[0][0]).toEqual(["u1", "u2"]);
  });

  it("wraps the resolved identities in a plain JSON-round-trippable entries array before handing them to unstable_cache", async () => {
    const admin = fakeIdentityAdmin({
      prefs: { u1: { avatarPath: "avatars/u1.png" } },
      authUsers: { u1: { displayName: "Beacon Fan" } },
      signedUrls: { "avatars/u1.png": "https://signed.example.com/u1.png" },
    });

    await cachedResolveIdentities(admin, ["u1"]);

    // The function passed to unstable_cache is what actually gets JSON-
    // serialized into the cache entry, so its raw return value (not the
    // Map cachedResolveIdentities rebuilds afterward) is what must survive
    // serialization.
    const innerFn = vi.mocked(unstable_cache).mock.calls.at(-1)![0] as (
      ids: string[],
    ) => Promise<unknown>;
    const raw = await innerFn(["u1"]);
    expect(Array.isArray(raw)).toBe(true);
    expect(raw).toEqual(JSON.parse(JSON.stringify(raw)));
    expect(raw).toEqual([["u1", { displayName: "Beacon Fan", avatarUrl: "https://signed.example.com/u1.png" }]]);
  });
});
