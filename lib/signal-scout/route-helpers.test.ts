import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

import {
  requireFfBeaconHeader,
  privateJson,
  clientIp,
  hashGuestIp,
  resolveRoundIdentity,
  identityKeyFor,
  engineErrorStatus,
  claimAction,
  uuidSchema,
  tierSchema,
  confirmBurnSchema,
  SCOUT_GUEST_COOKIE,
  SCOUT_GUEST_COOKIE_OPTIONS,
} from "./route-helpers";

const VALID_GUEST_ID = "11111111-1111-4111-8111-111111111111";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/games/signal-scout/round", { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: null } });
});

describe("requireFfBeaconHeader", () => {
  it("passes with the exact header value", () => {
    expect(requireFfBeaconHeader(req({ "x-requested-with": "ff-beacon" }))).toBe(true);
  });

  it("rejects a missing or wrong header", () => {
    expect(requireFfBeaconHeader(req())).toBe(false);
    expect(requireFfBeaconHeader(req({ "x-requested-with": "other" }))).toBe(false);
  });
});

describe("privateJson", () => {
  it("sets private, no-store and no-referrer headers plus the body/status", async () => {
    const res = privateJson({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("defaults to status 200", () => {
    expect(privateJson({}).status).toBe(200);
  });
});

describe("clientIp", () => {
  it("reads the first entry of x-forwarded-for, trimmed", () => {
    expect(clientIp(req({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(clientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    expect(clientIp(req())).toBe("unknown");
  });
});

describe("hashGuestIp", () => {
  const originalSalt = process.env.SIGNAL_SCOUT_IP_SALT;

  afterEach(() => {
    if (originalSalt === undefined) delete process.env.SIGNAL_SCOUT_IP_SALT;
    else process.env.SIGNAL_SCOUT_IP_SALT = originalSalt;
  });

  it("never returns empty, even for an empty/unknown input", () => {
    expect(hashGuestIp("")).not.toBe("");
    expect(hashGuestIp("unknown")).not.toBe("");
  });

  it("is deterministic for the same ip and salt", () => {
    delete process.env.SIGNAL_SCOUT_IP_SALT;
    expect(hashGuestIp("1.2.3.4")).toBe(hashGuestIp("1.2.3.4"));
  });

  it("produces different hashes for different ips", () => {
    delete process.env.SIGNAL_SCOUT_IP_SALT;
    expect(hashGuestIp("1.2.3.4")).not.toBe(hashGuestIp("5.6.7.8"));
  });

  it("changes output when SIGNAL_SCOUT_IP_SALT is set vs the fallback", () => {
    delete process.env.SIGNAL_SCOUT_IP_SALT;
    const withFallback = hashGuestIp("1.2.3.4");
    process.env.SIGNAL_SCOUT_IP_SALT = "a-different-secret";
    const withEnvSalt = hashGuestIp("1.2.3.4");
    expect(withEnvSalt).not.toBe(withFallback);
  });

  it("treats empty and 'unknown' ip identically (both coalesce to 'unknown')", () => {
    delete process.env.SIGNAL_SCOUT_IP_SALT;
    expect(hashGuestIp("")).toBe(hashGuestIp("unknown"));
  });
});

describe("resolveRoundIdentity", () => {
  it("resolves a logged-in user first, ignoring any guest cookie", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const { identity, mintedGuestId } = await resolveRoundIdentity(
      req({ cookie: `${SCOUT_GUEST_COOKIE}=${VALID_GUEST_ID}` }),
    );
    expect(identity).toEqual({ kind: "user", userId: "user-1" });
    expect(mintedGuestId).toBeNull();
  });

  it("reuses a valid guest cookie without minting a new id", async () => {
    const { identity, mintedGuestId } = await resolveRoundIdentity(
      req({ cookie: `${SCOUT_GUEST_COOKIE}=${VALID_GUEST_ID}` }),
    );
    expect(identity).toMatchObject({ kind: "guest", guestId: VALID_GUEST_ID });
    if (identity.kind === "guest") {
      expect(identity.ipHash).toBeTruthy();
    }
    expect(mintedGuestId).toBeNull();
  });

  it("mints a fresh guest id when no cookie is present", async () => {
    const { identity, mintedGuestId } = await resolveRoundIdentity(req());
    expect(mintedGuestId).toBeTruthy();
    expect(uuidSchema.safeParse(mintedGuestId).success).toBe(true);
    expect(identity).toMatchObject({ kind: "guest", guestId: mintedGuestId });
  });

  it("mints a fresh guest id when the existing cookie is malformed", async () => {
    const { identity, mintedGuestId } = await resolveRoundIdentity(
      req({ cookie: `${SCOUT_GUEST_COOKIE}=not-a-uuid` }),
    );
    expect(mintedGuestId).toBeTruthy();
    expect(identity).toMatchObject({ kind: "guest", guestId: mintedGuestId });
  });
});

describe("identityKeyFor", () => {
  it("namespaces user and guest identities", () => {
    expect(identityKeyFor({ kind: "user", userId: "u1" })).toBe("user:u1");
    expect(identityKeyFor({ kind: "guest", guestId: "g1", ipHash: "h" })).toBe("guest:g1");
  });
});

describe("engineErrorStatus", () => {
  it("maps every documented code to its status", () => {
    expect(engineErrorStatus("not_found")).toBe(404);
    expect(engineErrorStatus("round_not_active")).toBe(409);
    expect(engineErrorStatus("active_round_exists")).toBe(409);
    expect(engineErrorStatus("game_disabled")).toBe(503);
    expect(engineErrorStatus("pool_empty")).toBe(503);
    expect(engineErrorStatus("guess_duplicate")).toBe(409);
    expect(engineErrorStatus("guess_out_of_pool")).toBe(400);
    expect(engineErrorStatus("invalid_tier")).toBe(400);
    expect(engineErrorStatus("signal_burned")).toBe(409);
    expect(engineErrorStatus("tier_disabled")).toBe(400);
    expect(engineErrorStatus("tier_limit_reached")).toBe(409);
    expect(engineErrorStatus("tier_exhausted")).toBe(409);
    expect(engineErrorStatus("burn_confirmation_required")).toBe(409);
    expect(engineErrorStatus("guest_limit_reached")).toBe(429);
    expect(engineErrorStatus("guest_play_disabled")).toBe(403);
    expect(engineErrorStatus("rate_limited")).toBe(429);
  });
});

describe("zod schemas", () => {
  it("uuidSchema accepts uuids and rejects garbage", () => {
    expect(uuidSchema.safeParse(VALID_GUEST_ID).success).toBe(true);
    expect(uuidSchema.safeParse("nope").success).toBe(false);
  });

  it("tierSchema accepts only the four signal tiers", () => {
    for (const tier of ["weak", "clear", "ping", "scan"]) {
      expect(tierSchema.safeParse(tier).success).toBe(true);
    }
    expect(tierSchema.safeParse("legendary").success).toBe(false);
  });

  it("confirmBurnSchema requires a strict boolean", () => {
    expect(confirmBurnSchema.safeParse(true).success).toBe(true);
    expect(confirmBurnSchema.safeParse(false).success).toBe(true);
    expect(confirmBurnSchema.safeParse("true").success).toBe(false);
    expect(confirmBurnSchema.safeParse(1).success).toBe(false);
  });
});

describe("claimAction", () => {
  function makeAdmin(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn().mockResolvedValue(result);
    return { admin: { rpc } as unknown as Parameters<typeof claimAction>[0], rpc };
  }

  it("calls try_claim_signal_scout_action with a namespaced key, action, ET game_date, and window", async () => {
    const { admin, rpc } = makeAdmin({ data: true, error: null });
    const claimed = await claimAction(admin, "guest:g1", "round_start", 5);
    expect(claimed).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "try_claim_signal_scout_action",
      expect.objectContaining({
        p_identity_key: "guest:g1",
        p_action: "round_start",
        p_window_seconds: 5,
        p_game_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("returns false when the RPC denies the claim", async () => {
    const { admin } = makeAdmin({ data: false, error: null });
    expect(await claimAction(admin, "user:u1", "round_start", 5)).toBe(false);
  });

  it("throws on an RPC error rather than silently allowing", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "boom" } });
    await expect(claimAction(admin, "user:u1", "round_start", 5)).rejects.toThrow(/boom/);
  });
});

describe("SCOUT_GUEST_COOKIE_OPTIONS", () => {
  it("is httpOnly, lax, path / with a 1-year max age", () => {
    expect(SCOUT_GUEST_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(SCOUT_GUEST_COOKIE_OPTIONS.sameSite).toBe("lax");
    expect(SCOUT_GUEST_COOKIE_OPTIONS.path).toBe("/");
    expect(SCOUT_GUEST_COOKIE_OPTIONS.maxAge).toBe(60 * 60 * 24 * 365);
  });
});
