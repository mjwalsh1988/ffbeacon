import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FantasyPlayerRow } from "@/lib/player-search";

const {
  createAdminClientMock,
  getUserMock,
  searchFantasyPlayersMock,
  loadSettingsMock,
  rpcMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getUserMock: vi.fn(),
  searchFantasyPlayersMock: vi.fn(),
  loadSettingsMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: createAdminClientMock,
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/player-search", () => ({
  searchFantasyPlayers: searchFantasyPlayersMock,
}));

vi.mock("@/lib/signal-scout/settings", () => ({
  loadSignalScoutSettings: loadSettingsMock,
}));

import { GET } from "./route";
import { SCOUT_GUEST_COOKIE } from "@/lib/signal-scout/route-helpers";

const ELIGIBLE = ["QB", "RB", "WR", "TE"];
const VALID_GUEST_ID = "11111111-1111-4111-8111-111111111111";

/** The p_identity_key argument passed to the rate-claim RPC on the last call. */
function claimIdentityKey(): string {
  const call = rpcMock.mock.calls.find(([name]) => name === "try_claim_signal_scout_action");
  return (call![1] as { p_identity_key: string }).p_identity_key;
}

function req(q?: string, headers: Record<string, string> = { "x-requested-with": "ff-beacon" }): Request {
  const url = new URL("http://test/api/games/signal-scout/search");
  if (q !== undefined) url.searchParams.set("q", q);
  return new Request(url, { method: "GET", headers });
}

/** Minimal player row in the shape searchFantasyPlayers returns. */
function row(overrides: Partial<FantasyPlayerRow> = {}): FantasyPlayerRow {
  return {
    id: "p1",
    slug: "player-one",
    first_name: "Player",
    last_name: "One",
    full_name: "Player One",
    position: "WR",
    team: "SF",
    external_ids: { sleeper: "4001" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
  rpcMock.mockResolvedValue({ data: true, error: null });
  getUserMock.mockResolvedValue({ data: { user: null } });
  loadSettingsMock.mockResolvedValue({ pool: { eligible_positions: ELIGIBLE } });
  searchFantasyPlayersMock.mockResolvedValue([]);
});

describe("GET /api/games/signal-scout/search", () => {
  it("rejects a missing x-requested-with header with 403 and does nothing else", async () => {
    const res = await GET(req("mahomes", {}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(searchFantasyPlayersMock).not.toHaveBeenCalled();
  });

  it("returns empty results for a sub-2-char query WITHOUT spending a claim", async () => {
    const res = await GET(req("a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    // No identity resolution, no rate claim, no search on a keystroke this short.
    expect(getUserMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(searchFantasyPlayersMock).not.toHaveBeenCalled();
  });

  it("treats a query that is only whitespace as sub-length and spends no claim", async () => {
    const res = await GET(req("   "));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(searchFantasyPlayersMock).not.toHaveBeenCalled();
  });

  it("truncates a query over 50 chars before it reaches searchFantasyPlayers", async () => {
    const long = "a".repeat(60);
    await GET(req(long));
    expect(searchFantasyPlayersMock).toHaveBeenCalledTimes(1);
    const arg = searchFantasyPlayersMock.mock.calls[0][1] as { query: string };
    expect(arg.query).toBe("a".repeat(50));
    expect(arg.query.length).toBe(50);
  });

  it("returns 429 rate_limited when the search claim is denied", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const res = await GET(req("mahomes"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(searchFantasyPlayersMock).not.toHaveBeenCalled();
  });

  it("filters results to eligible positions and caps at 10", async () => {
    // 11 eligible rows plus 1 kicker: the kicker must be dropped and the
    // survivors capped to 10.
    const rows: FantasyPlayerRow[] = [
      ...Array.from({ length: 11 }, (_, i) => row({ id: `p${i}`, position: "WR" })),
      row({ id: "kicker", position: "K" }),
    ];
    searchFantasyPlayersMock.mockResolvedValue(rows);

    const res = await GET(req("mahomes"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string; position: string | null }[] };
    expect(body.results).toHaveLength(10);
    expect(body.results.every((r) => r.position !== "K")).toBe(true);
    expect(body.results.some((r) => r.id === "kicker")).toBe(false);
  });

  it("maps each row to exactly { id, name, position, team, sleeperId }", async () => {
    searchFantasyPlayersMock.mockResolvedValue([
      row({
        id: "p42",
        full_name: "Patrick Mahomes",
        position: "QB",
        team: "KC",
        external_ids: { sleeper: "4046" },
      }),
    ]);

    const res = await GET(req("mahomes"));
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([
      { id: "p42", name: "Patrick Mahomes", position: "QB", team: "KC", sleeperId: "4046" },
    ]);
  });

  it("falls back to first + last name and null sleeper id when data is sparse", async () => {
    searchFantasyPlayersMock.mockResolvedValue([
      row({
        id: "p7",
        full_name: null,
        first_name: "Bijan",
        last_name: "Robinson",
        external_ids: null,
      }),
    ]);

    const res = await GET(req("bijan"));
    const body = (await res.json()) as { results: { name: string; sleeperId: string | null }[] };
    expect(body.results[0].name).toBe("Bijan Robinson");
    expect(body.results[0].sleeperId).toBeNull();
  });

  it("rate-limits a cookie-less caller by IP hash, not a throwaway guest id", async () => {
    // No cookie -> resolveRoundIdentity mints a fresh guest id that will never
    // recur, so the claim key must fall back to the salted IP hash.
    const res = await GET(req("mahomes"));
    expect(res.status).toBe(200);
    expect(claimIdentityKey()).toMatch(/^ip:/);
  });

  it("rate-limits a cookie-carrying guest by their stable per-cookie key", async () => {
    const res = await GET(
      req("mahomes", {
        "x-requested-with": "ff-beacon",
        cookie: `${SCOUT_GUEST_COOKIE}=${VALID_GUEST_ID}`,
      }),
    );
    expect(res.status).toBe(200);
    expect(claimIdentityKey()).toBe(`guest:${VALID_GUEST_ID}`);
  });

  it("maps a lib throw to 500 server_error without leaking detail", async () => {
    searchFantasyPlayersMock.mockRejectedValue(
      new Error("relation players violates secret constraint xyz"),
    );
    const res = await GET(req("mahomes"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server_error" });
    expect(JSON.stringify(body)).not.toContain("secret constraint");
  });
});
