import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFaabOgParams, FAAB_OG_KINDS } from "./params";

/**
 * Covers the FAAB share card's parameter contract (section 7.15 of
 * docs/faab/faab-calculator-overhaul-plan.md).
 *
 * The validator is imported from ./params rather than from ./route, the same
 * split app/api/og/start-sit/card-layout.test.ts makes: route.tsx pulls in
 * next/og and lib/og/assets.ts, which reads font files at import time, and
 * none of that is involved in deciding whether a query string is valid.
 *
 * A separate source-level test asserts the ORDER of the two guards in the
 * route, because "validate, then claim a rate-limit slot" is the part of the
 * contract that a rearrangement would silently break: a malformed request
 * would start spending a real reader's budget and every test above would
 * still pass.
 */

const VALID = "p=4046&bid=34&walk=51&budget=100&win=62&k=standard";

function parse(qs: string) {
  return parseFaabOgParams(new URLSearchParams(qs));
}

function expectInvalid(qs: string): string {
  const result = parse(qs);
  if (result.ok) throw new Error("expected invalid, got a parsed card");
  return result.reason;
}

function expectValid(qs: string) {
  const result = parse(qs);
  if (!result.ok) throw new Error(`expected valid, got: ${result.reason}`);
  return result.params;
}

describe("parseFaabOgParams, the valid cases", () => {
  it("accepts a normal request and returns every figure as a number", () => {
    expect(expectValid(VALID)).toEqual({
      playerId: "4046",
      bid: 34,
      walk: 51,
      budget: 100,
      win: 62,
      kind: "standard",
    });
  });

  it("accepts k=chopped", () => {
    expect(
      expectValid("p=4046&bid=1&walk=2&budget=1000&win=5&k=chopped").kind,
    ).toBe("chopped");
  });

  it("accepts both declared kinds and nothing else claims to be one", () => {
    expect(FAAB_OG_KINDS).toEqual(["standard", "chopped"]);
    for (const kind of FAAB_OG_KINDS) {
      expect(
        expectValid(`p=4046&bid=0&walk=0&budget=0&win=0&k=${kind}`).kind,
      ).toBe(kind);
    }
  });

  it("accepts zero for every figure", () => {
    expect(
      expectValid("p=4046&bid=0&walk=0&budget=0&win=0&k=standard"),
    ).toMatchObject({
      bid: 0,
      walk: 0,
      budget: 0,
      win: 0,
    });
  });

  it("accepts the top of each range: 100000 money, 100 percent", () => {
    expect(
      expectValid(
        "p=4046&bid=100000&walk=100000&budget=100000&win=100&k=standard",
      ),
    ).toMatchObject({ bid: 100000, walk: 100000, budget: 100000, win: 100 });
  });

  it("accepts a 32 character player id made of the whole allowed alphabet", () => {
    const id = "aZ0_-bcdefghijklmnopqrstuvwxyz90";
    expect(id).toHaveLength(32);
    expect(
      expectValid(`p=${id}&bid=1&walk=1&budget=1&win=1&k=standard`).playerId,
    ).toBe(id);
  });

  it("accepts a one character player id", () => {
    expect(
      expectValid("p=7&bid=1&walk=1&budget=1&win=1&k=standard").playerId,
    ).toBe("7");
  });

  it("accepts a team defence id, which is letters rather than digits", () => {
    expect(
      expectValid("p=PHI&bid=3&walk=6&budget=100&win=44&k=standard").playerId,
    ).toBe("PHI");
  });

  it("accepts a walk away figure below the bid: the validator judges shape, not sense", () => {
    // Deliberate. Whether walking away above a number lower than the bid is
    // coherent is the calculator's problem; refusing it here would mean a
    // model change could start returning 400s from a share card.
    expect(
      expectValid("p=4046&bid=40&walk=10&budget=100&win=62&k=standard").walk,
    ).toBe(10);
  });

  it("accepts a bid above the budget for the same reason", () => {
    expect(
      expectValid("p=4046&bid=140&walk=150&budget=100&win=62&k=standard").bid,
    ).toBe(140);
  });

  it("ignores unknown extra parameters rather than refusing the request", () => {
    // A crawler or a share sheet appending a tracking parameter must not turn
    // a real card into a 400.
    expect(
      expectValid(`${VALID}&utm_source=discord&league=Some+League`),
    ).toMatchObject({
      playerId: "4046",
      bid: 34,
    });
  });
});

describe("parseFaabOgParams, bad player ids", () => {
  it("refuses an empty p", () => {
    expect(parse("p=&bid=34&walk=51&budget=100&win=62&k=standard")).toEqual({
      ok: false,
      reason: "Invalid player id",
    });
  });

  it("refuses a 33 character p", () => {
    expect(
      parse(`p=${"a".repeat(33)}&bid=1&walk=1&budget=1&win=1&k=standard`).ok,
    ).toBe(false);
  });

  it("refuses a p containing a slash, which is how a path would be smuggled in", () => {
    expect(parse("p=../../etc&bid=1&walk=1&budget=1&win=1&k=standard").ok).toBe(
      false,
    );
  });

  it("refuses a p containing a dot", () => {
    expect(parse("p=40.46&bid=1&walk=1&budget=1&win=1&k=standard").ok).toBe(
      false,
    );
  });

  it("refuses a p with surrounding whitespace", () => {
    expect(
      parse("p=%204046%20&bid=1&walk=1&budget=1&win=1&k=standard").ok,
    ).toBe(false);
  });
});

describe("parseFaabOgParams, out of range numbers", () => {
  it("refuses a bid above 100000", () => {
    expect(parse("p=4046&bid=100001&walk=1&budget=1&win=1&k=standard")).toEqual(
      {
        ok: false,
        reason: "Invalid bid",
      },
    );
  });

  it("refuses a walk away figure above 100000", () => {
    expect(
      expectInvalid("p=4046&bid=1&walk=100001&budget=1&win=1&k=standard"),
    ).toBe("Invalid walk away figure");
  });

  it("refuses a budget above 100000", () => {
    expect(
      expectInvalid("p=4046&bid=1&walk=1&budget=999999&win=1&k=standard"),
    ).toBe("Invalid budget");
  });

  it("refuses a win chance above 100", () => {
    expect(
      expectInvalid("p=4046&bid=1&walk=1&budget=1&win=101&k=standard"),
    ).toBe("Invalid win chance");
  });

  it("refuses a negative figure", () => {
    expect(
      expectInvalid("p=4046&bid=-1&walk=1&budget=1&win=1&k=standard"),
    ).toBe("Invalid bid");
  });

  it("refuses a figure beyond the safe integer range", () => {
    expect(
      parse("p=4046&bid=99999999999999999999&walk=1&budget=1&win=1&k=standard")
        .ok,
    ).toBe(false);
  });
});

describe("parseFaabOgParams, non-integer numbers", () => {
  it("refuses a decimal bid", () => {
    expect(
      expectInvalid("p=4046&bid=34.5&walk=1&budget=1&win=1&k=standard"),
    ).toBe("Invalid bid");
  });

  it("refuses a decimal win chance, including one that would round into range", () => {
    expect(parse("p=4046&bid=1&walk=1&budget=1&win=62.0&k=standard").ok).toBe(
      false,
    );
  });

  it("refuses a signed integer", () => {
    expect(parse("p=4046&bid=%2B34&walk=1&budget=1&win=1&k=standard").ok).toBe(
      false,
    );
  });

  it("refuses exponent notation", () => {
    expect(parse("p=4046&bid=1e3&walk=1&budget=1&win=1&k=standard").ok).toBe(
      false,
    );
  });

  it("refuses hex notation", () => {
    expect(parse("p=4046&bid=0x20&walk=1&budget=1&win=1&k=standard").ok).toBe(
      false,
    );
  });

  it("refuses a padded number, because Number would happily trim it", () => {
    expect(
      parse("p=4046&bid=%2034%20&walk=1&budget=1&win=1&k=standard").ok,
    ).toBe(false);
  });

  it("refuses a word", () => {
    expect(
      expectInvalid("p=4046&bid=lots&walk=1&budget=1&win=1&k=standard"),
    ).toBe("Invalid bid");
  });
});

describe("parseFaabOgParams, bad k", () => {
  it("refuses an unknown kind", () => {
    expect(parse("p=4046&bid=1&walk=1&budget=1&win=1&k=guillotine")).toEqual({
      ok: false,
      reason: "Invalid league kind",
    });
  });

  it("refuses a kind that differs only in case", () => {
    expect(parse("p=4046&bid=1&walk=1&budget=1&win=1&k=Chopped").ok).toBe(
      false,
    );
  });

  it("refuses an empty k", () => {
    expect(parse("p=4046&bid=1&walk=1&budget=1&win=1&k=").ok).toBe(false);
  });

  it("refuses a prototype key masquerading as a kind", () => {
    expect(parse("p=4046&bid=1&walk=1&budget=1&win=1&k=constructor").ok).toBe(
      false,
    );
  });
});

describe("parseFaabOgParams, missing params", () => {
  it("refuses an empty query string", () => {
    expect(parse("")).toEqual({ ok: false, reason: "Invalid player id" });
  });

  it("refuses each single missing parameter in turn", () => {
    const cases: Array<[string, string]> = [
      ["p", "Invalid player id"],
      ["bid", "Invalid bid"],
      ["walk", "Invalid walk away figure"],
      ["budget", "Invalid budget"],
      ["win", "Invalid win chance"],
      ["k", "Invalid league kind"],
    ];
    for (const [key, reason] of cases) {
      const params = new URLSearchParams(VALID);
      params.delete(key);
      expect(parseFaabOgParams(params)).toEqual({ ok: false, reason });
    }
  });

  it("a missing figure is never read as zero", () => {
    // Number("") is 0, so a validator built on Number alone would draw a
    // confident "Bid 0 of 0" card for a request that supplied neither.
    const params = new URLSearchParams(VALID);
    params.delete("bid");
    params.delete("budget");
    expect(parseFaabOgParams(params).ok).toBe(false);
  });
});

describe("route source", () => {
  const source = readFileSync(join(__dirname, "route.tsx"), "utf8");

  it("validates before it claims a rate-limit slot", () => {
    const validateAt = source.indexOf("parseFaabOgParams(url.searchParams)");
    const claimAt = source.indexOf("await claimSlot(request)");
    expect(validateAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(validateAt);
  });

  it("uses the shared try_claim_rate_limit helper on its own bucket, 20 per 60 seconds", () => {
    expect(source).toContain("try_claim_rate_limit");
    expect(source).toContain('const RATE_BUCKET = "og_faab"');
    expect(source).toContain("const RATE_MAX = 20");
    expect(source).toContain("const RATE_WINDOW_SECONDS = 60");
  });

  it("runs on the node runtime and serves the house OG cache header", () => {
    expect(source).toContain('export const runtime = "nodejs"');
    expect(source).toContain(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  it("reads no parameter that could carry a league, team or manager name", () => {
    const reads = [
      ...source.matchAll(/searchParams\.get\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    const paramsSource = readFileSync(join(__dirname, "params.ts"), "utf8");
    const validatorReads = [
      ...paramsSource.matchAll(/searchParams\.get\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    expect(new Set([...reads, ...validatorReads])).toEqual(
      new Set(["p", "bid", "walk", "budget", "win", "k"]),
    );
  });
});
