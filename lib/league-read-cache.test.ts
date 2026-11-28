/**
 * The signed-out league read cache.
 *
 * Pinned here: who may be answered from memory (the anonymous role on a
 * counted anonymous view, nobody else), that a failure is never remembered,
 * that a sync or a derived pass voids every answer asked for before it, and
 * that identical reads in flight share one request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LEAGUE_READ_TTL_MS,
  createLeagueReadCachingFetch,
  leagueSyncedAt,
  noteLeagueDerived,
  noteLeagueSync,
  resetLeagueReadCache,
  type LeagueReadMode,
} from "@/lib/league-read-cache";

const KEY = "publishable-test-key";
const URL_A = "https://example.supabase.co/rest/v1/rosters?league_id=eq.abc";

/** supabase-js sends a Headers object, so the tests do too. */
function anonInit(extra: Record<string, string> = {}): RequestInit {
  return {
    method: "GET",
    headers: new Headers({ authorization: `Bearer ${KEY}`, apikey: KEY, ...extra }),
  };
}

function setup(mode: LeagueReadMode = "use") {
  const state: { mode: LeagueReadMode; league: string | null } = { mode, league: "L1" };
  let clock = 1_000_000;
  let calls = 0;
  const answers: Array<() => Response | Promise<Response>> = [];
  const base = vi.fn(async () => {
    calls += 1;
    const next = answers.shift();
    if (next) return next();
    return new Response(JSON.stringify([{ n: calls }]), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "0-0/1" },
    });
  });
  const cachedFetch = createLeagueReadCachingFetch(
    base as unknown as typeof fetch,
    () => state,
    () => clock,
  );
  return {
    state,
    base,
    answers,
    cachedFetch,
    clock: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", KEY);
  resetLeagueReadCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a counted anonymous league view", () => {
  it("answers a repeat read from memory, headers included", async () => {
    const { cachedFetch, base } = setup();
    const first = await cachedFetch(URL_A, anonInit());
    const second = await cachedFetch(URL_A, anonInit());

    expect(base).toHaveBeenCalledTimes(1);
    expect(await first.json()).toEqual([{ n: 1 }]);
    expect(await second.json()).toEqual([{ n: 1 }]);
    expect(second.status).toBe(200);
    expect(second.headers.get("content-range")).toBe("0-0/1");
  });

  it("reads again once the window has passed", async () => {
    const { cachedFetch, base, advance } = setup();
    await cachedFetch(URL_A, anonInit());
    advance(LEAGUE_READ_TTL_MS + 1);
    const later = await cachedFetch(URL_A, anonInit());

    expect(base).toHaveBeenCalledTimes(2);
    expect(await later.json()).toEqual([{ n: 2 }]);
  });

  it("keeps reads apart when a header changes the answer", async () => {
    const { cachedFetch, base } = setup();
    await cachedFetch(URL_A, anonInit({ accept: "application/json" }));
    await cachedFetch(URL_A, anonInit({ accept: "application/vnd.pgrst.object+json" }));
    await cachedFetch(URL_A, anonInit({ accept: "application/json", range: "0-999" }));
    await cachedFetch(URL_A, anonInit({ accept: "application/json", prefer: "count=exact" }));

    expect(base).toHaveBeenCalledTimes(4);
  });

  it("never remembers a failed read", async () => {
    const { cachedFetch, base, answers } = setup();
    answers.push(() => new Response("upstream down", { status: 503 }));
    const failed = await cachedFetch(URL_A, anonInit());
    const retried = await cachedFetch(URL_A, anonInit());

    expect(failed.status).toBe(503);
    expect(retried.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("shares one request between identical reads in flight", async () => {
    const { cachedFetch, base, answers } = setup();
    let release: (r: Response) => void = () => {};
    answers.push(() => new Promise<Response>((resolve) => (release = resolve)));
    const a = cachedFetch(URL_A, anonInit());
    const b = cachedFetch(URL_A, anonInit());
    await Promise.resolve();
    release(new Response(JSON.stringify([{ n: "shared" }]), { status: 200 }));

    expect(await (await a).json()).toEqual([{ n: "shared" }]);
    expect(await (await b).json()).toEqual([{ n: "shared" }]);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("asks for itself when the read it joined failed", async () => {
    const { cachedFetch, base, answers } = setup();
    let release: (r: Response) => void = () => {};
    answers.push(() => new Promise<Response>((resolve) => (release = resolve)));
    const a = cachedFetch(URL_A, anonInit());
    const b = cachedFetch(URL_A, anonInit());
    await Promise.resolve();
    release(new Response("nope", { status: 500 }));

    expect((await a).status).toBe(500);
    expect((await b).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });
});

describe("who is never answered from memory", () => {
  it("a request that was not counted as an anonymous league view", async () => {
    const { cachedFetch, base } = setup("off");
    await cachedFetch(URL_A, anonInit());
    await cachedFetch(URL_A, anonInit());
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("a read that carries a member token, and it is not stored for others", async () => {
    const { cachedFetch, base } = setup();
    const member = {
      method: "GET",
      headers: new Headers({ authorization: "Bearer member-jwt", apikey: KEY }),
    };
    await cachedFetch(URL_A, member);
    await cachedFetch(URL_A, member);
    await cachedFetch(URL_A, anonInit());
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("writes, rpc calls and non-REST requests", async () => {
    const { cachedFetch, base } = setup();
    const post = { ...anonInit(), method: "POST" };
    await cachedFetch(URL_A, post);
    await cachedFetch(URL_A, post);
    const rpc = "https://example.supabase.co/rest/v1/rpc/some_function?x=1";
    await cachedFetch(rpc, anonInit());
    await cachedFetch(rpc, anonInit());
    const auth = "https://example.supabase.co/auth/v1/user";
    await cachedFetch(auth, anonInit());
    await cachedFetch(auth, anonInit());
    expect(base).toHaveBeenCalledTimes(6);
  });
});

describe("what voids a remembered answer", () => {
  it("a sync of the reader league, whoever did it", async () => {
    const { cachedFetch, base, clock, advance } = setup();
    await cachedFetch(URL_A, anonInit());
    advance(1_000);
    noteLeagueSync("L1", "row-1", clock());
    advance(1_000);
    const fresh = await cachedFetch(URL_A, anonInit());
    const again = await cachedFetch(URL_A, anonInit());

    expect(await fresh.json()).toEqual([{ n: 2 }]);
    expect(await again.json()).toEqual([{ n: 2 }]);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("a stored copy whose sync stamp is older than the answer does not", async () => {
    const { cachedFetch, base, clock } = setup();
    noteLeagueSync("L1", "row-1", clock() - 60_000);
    await cachedFetch(URL_A, anonInit());
    noteLeagueSync("L1", "row-1", clock() - 60_000);
    await cachedFetch(URL_A, anonInit());
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("a derived pass finishing for that league", async () => {
    const { cachedFetch, base, clock, advance } = setup();
    noteLeagueSync("L1", "row-1", clock() - 60_000);
    await cachedFetch(URL_A, anonInit());
    advance(500);
    noteLeagueDerived("row-1", clock());
    advance(500);
    await cachedFetch(URL_A, anonInit());
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("a change to another league does not", async () => {
    const { cachedFetch, base, clock, advance } = setup();
    await cachedFetch(URL_A, anonInit());
    advance(1_000);
    noteLeagueSync("L2", "row-2", clock());
    noteLeagueDerived("row-2", clock());
    await cachedFetch(URL_A, anonInit());
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("a read sent before the sync is not remembered when it lands after it", async () => {
    const { cachedFetch, base, answers, clock, advance } = setup();
    let release: (r: Response) => void = () => {};
    answers.push(() => new Promise<Response>((resolve) => (release = resolve)));
    const early = cachedFetch(URL_A, anonInit());
    await Promise.resolve();
    advance(1_000);
    noteLeagueSync("L1", "row-1", clock());
    advance(1_000);
    release(new Response(JSON.stringify([{ n: "pre-sync" }]), { status: 200 }));
    expect(await (await early).json()).toEqual([{ n: "pre-sync" }]);

    const later = await cachedFetch(URL_A, anonInit());
    expect(await later.json()).toEqual([{ n: 2 }]);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("reports the last sync it was told about, by league row", () => {
    expect(leagueSyncedAt("row-9")).toBe(0);
    noteLeagueSync("L9", "row-9", 5_000);
    noteLeagueSync("L9", "row-9", 4_000);
    noteLeagueSync("L9", "row-9", Number.NaN);
    expect(leagueSyncedAt("row-9")).toBe(5_000);
  });
});

describe("requests it leaves alone", () => {
  it("passes through when the publishable key is not configured", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const { cachedFetch, base } = setup();
    await cachedFetch(URL_A, anonInit());
    await cachedFetch(URL_A, anonInit());
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("passes through a Request object and a HEAD", async () => {
    const { cachedFetch, base } = setup();
    await cachedFetch(new Request(URL_A, anonInit()));
    await cachedFetch(new Request(URL_A, anonInit()));
    await cachedFetch(URL_A, { ...anonInit(), method: "HEAD" });
    await cachedFetch(URL_A, { ...anonInit(), method: "HEAD" });
    expect(base).toHaveBeenCalledTimes(4);
  });

  it("does not remember a 206", async () => {
    const { cachedFetch, base, answers } = setup();
    answers.push(() => new Response("[]", { status: 206 }));
    const partial = await cachedFetch(URL_A, anonInit());
    await cachedFetch(URL_A, anonInit());
    expect(partial.status).toBe(206);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("lets a joiner ask for itself when the read it joined threw", async () => {
    const { cachedFetch, base, answers } = setup();
    let fail: (e: Error) => void = () => {};
    answers.push(() => new Promise<Response>((_, reject) => (fail = reject)));
    const a = cachedFetch(URL_A, anonInit());
    const b = cachedFetch(URL_A, anonInit());
    await Promise.resolve();
    fail(new Error("socket closed"));

    await expect(a).rejects.toThrow("socket closed");
    expect((await b).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });
});
