/**
 * The league page budget.
 *
 * What is pinned here is the part a later edit could quietly undo: the ORDER
 * the anonymous budgets are claimed in (a refused request must never spend a
 * later, shared budget), that a member never touches the anonymous budgets,
 * what happens when the counter cannot be reached, and that every league page
 * asks before it reads anything.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ANON_PER_IP_MAX,
  ANON_PER_LEAGUE_MAX,
  ANON_SITE_MAX,
  MEMBER_MAX,
  MEMBER_SITE_MAX,
  claimLeagueView,
} from "@/lib/league-view-gate";

const requestHeaders = () => new Headers({ "x-real-ip": "203.0.113.9" });

/** Answers each claim from a list, in order, and records the bucket asked for. */
function stubClaims(answers: Array<boolean | "throw" | number>) {
  const buckets: Array<{ bucket: string; key: string; max: number }> = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    buckets.push({ bucket: body.p_bucket, key: body.p_key, max: body.p_max_requests });
    const answer = answers[buckets.length - 1];
    if (answer === "throw") throw new Error("network down");
    if (typeof answer === "number") return new Response("nope", { status: answer });
    return new Response(JSON.stringify(answer), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { buckets, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  vi.stubEnv("SIGNAL_SCOUT_IP_SALT", "test-salt");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("claimLeagueView for an anonymous reader", () => {
  it("claims address, then league, then site, and allows when all three pass", async () => {
    const { buckets } = stubClaims([true, true, true]);
    const verdict = await claimLeagueView(requestHeaders(), "123", null);

    expect(verdict).toEqual({ allowed: true });
    expect(buckets.map((b) => b.bucket)).toEqual([
      "league-view:ip",
      "league-view:league",
      "league-view:site",
    ]);
    expect(buckets.map((b) => b.max)).toEqual([
      ANON_PER_IP_MAX,
      ANON_PER_LEAGUE_MAX,
      ANON_SITE_MAX,
    ]);
    expect(buckets[1].key).toBe("123");
  });

  it("stores a hash of the address, never the address", async () => {
    const { buckets } = stubClaims([true, true, true]);
    await claimLeagueView(requestHeaders(), "123", null);

    expect(buckets[0].key).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(buckets[0].key).not.toContain("203.0.113.9");
  });

  it("stops at the address budget without spending the shared ones", async () => {
    const { buckets } = stubClaims([false]);
    const verdict = await claimLeagueView(requestHeaders(), "123", null);

    expect(verdict).toEqual({ allowed: false, reason: "address" });
    expect(buckets).toHaveLength(1);
  });

  it("stops at the league budget without spending the site one", async () => {
    const { buckets } = stubClaims([true, false]);
    const verdict = await claimLeagueView(requestHeaders(), "123", null);

    expect(verdict).toEqual({ allowed: false, reason: "league" });
    expect(buckets).toHaveLength(2);
  });

  it("refuses on the site budget", async () => {
    stubClaims([true, true, false]);
    expect(await claimLeagueView(requestHeaders(), "123", null)).toEqual({
      allowed: false,
      reason: "site",
    });
  });

  it("fails closed when the counter cannot be reached", async () => {
    stubClaims(["throw"]);
    expect(await claimLeagueView(requestHeaders(), "123", null)).toEqual({
      allowed: false,
      reason: "unavailable",
    });

    stubClaims([true, 503]);
    expect(await claimLeagueView(requestHeaders(), "123", null)).toEqual({
      allowed: false,
      reason: "unavailable",
    });
  });
});

describe("claimLeagueView for a signed-in member", () => {
  it("counts against the account and the member ceiling, never the anonymous budgets", async () => {
    const { buckets } = stubClaims([true, true]);
    const verdict = await claimLeagueView(requestHeaders(), "123", "user-1");

    expect(verdict).toEqual({ allowed: true });
    expect(buckets).toEqual([
      { bucket: "league-view:member", key: "user:user-1", max: MEMBER_MAX },
      { bucket: "league-view:members", key: "all", max: MEMBER_SITE_MAX },
    ]);
  });

  it("refuses a member who is over their own budget, without spending the shared one", async () => {
    const { buckets } = stubClaims([false]);
    expect(await claimLeagueView(requestHeaders(), "123", "user-1")).toEqual({
      allowed: false,
      reason: "member",
    });
    expect(buckets).toHaveLength(1);
  });

  it("refuses when all members together are over the ceiling", async () => {
    stubClaims([true, false]);
    expect(await claimLeagueView(requestHeaders(), "123", "user-1")).toEqual({
      allowed: false,
      reason: "site",
    });
  });

  it("lets a member through when the counter cannot be reached", async () => {
    stubClaims(["throw"]);
    expect(await claimLeagueView(requestHeaders(), "123", "user-1")).toEqual({
      allowed: true,
    });
  });
});

describe("every league page", () => {
  /** Every page.tsx under app/leagues/[league_id]. */
  function leaguePages(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return leaguePages(full);
      return entry.name === "page.tsx" ? [full] : [];
    });
  }

  it("asks the budget before its body reads anything", () => {
    const pages = leaguePages(join(process.cwd(), "app", "leagues", "[league_id]"));
    expect(pages.length).toBeGreaterThanOrEqual(13);

    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      const body = source.slice(source.indexOf("export default async function "));
      const params = body.search(/await params;/);
      const check = body.indexOf("const refused = await refuseLeagueView(sleeperLeagueId);");
      expect(check, `${page} does not call refuseLeagueView`).toBeGreaterThan(-1);
      // Nothing between reading the params and asking: no other await may sit
      // in front of the check.
      const between = body.slice(params + "await params;".length, check);
      expect(between, `${page} awaits something before the budget check`).not.toMatch(
        /\bawait\b/,
      );
      expect(body.slice(check)).toMatch(/^.*\r?\n\s*if \(refused\) return refused;/);
    }
  });
});
