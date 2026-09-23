import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { config as middlewareConfig } from "@/middleware";
import { RESERVED_ROUTE_SEGMENTS } from "@/lib/signal/reserved-routes";

/**
 * Crawler access to the two machine-readable documents.
 *
 * These files only do their job if a crawler can actually fetch them, and every
 * way they could stop being fetchable is invisible from the routes themselves:
 * a Disallow rule added to robots.ts for something else, a middleware matcher
 * that starts running an auth refresh in front of them, or a handle claiming
 * the segment out from under the route. Each is checked here.
 *
 * There are deliberately no per-crawler Allow rules to test. robots.ts publishes
 * one `User-agent: *` group, so Googlebot, Bingbot, GPTBot, OAI-SearchBot,
 * ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Applebot and everything
 * else fall through to it. Naming them individually would only create a second
 * group that could drift from the first.
 *
 * The one named group is Amazonbot's, and it is `Disallow: /` (see the header
 * of app/robots.ts for why). The tests below pin it to exactly that, so the
 * exception cannot quietly grow into a second rule set, or a block, for any
 * crawler the site wants.
 */

const MACHINE_READABLE = ["/llms.txt", "/llms-full.txt"] as const;

/** The rules from the one `User-agent: *` group. */
function wildcardRules() {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const wildcard = list.find((r) => r.userAgent === "*");
  expect(wildcard, "robots.ts must publish a User-agent: * group").toBeDefined();
  return wildcard!;
}

function asArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

describe("robots.txt", () => {
  it("publishes the wildcard group plus Amazonbot's, and nothing else", () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    expect(list.map((r) => r.userAgent)).toEqual(["*", "Amazonbot"]);
  });

  it("blocks Amazonbot from the whole site and allows it nothing", () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    const amazon = list.find((r) => r.userAgent === "Amazonbot");
    expect(asArray(amazon?.disallow)).toEqual(["/"]);
    expect(asArray(amazon?.allow)).toEqual([]);
  });

  it.each([
    "Googlebot",
    "Bingbot",
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-User",
    "PerplexityBot",
    "Applebot",
    "Mediapartners-Google",
  ])("gives %s no group of its own, so it reads the wildcard rules", (agent) => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    for (const rule of list) {
      for (const named of asArray(rule.userAgent)) {
        if (named === "*") continue;
        // Robots matching is a case-insensitive token match on the product name.
        expect(agent.toLowerCase().includes(named.toLowerCase())).toBe(false);
      }
    }
  });

  it.each(MACHINE_READABLE)("does not disallow %s", (path) => {
    for (const rule of asArray(wildcardRules().disallow)) {
      expect(
        path.startsWith(rule),
        `${path} is blocked by "Disallow: ${rule}"`,
      ).toBe(false);
    }
  });

  it("still blocks admin, API, auth and account routes", () => {
    const disallow = asArray(wildcardRules().disallow);
    for (const blocked of ["/admin", "/api/", "/auth/", "/my-beacon", "/login"]) {
      expect(disallow).toContain(blocked);
    }
  });

  it("keeps the OG image routes fetchable, which link previews depend on", () => {
    expect(asArray(wildcardRules().allow)).toContain("/api/og/");
  });
});

describe("middleware", () => {
  const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);

  it.each(MACHINE_READABLE)(
    "never runs the session refresh in front of %s",
    (path) => {
      expect(matcher.test(path)).toBe(false);
    },
  );
});

describe("route segments", () => {
  it.each(MACHINE_READABLE)(
    "reserves the top-level segment behind %s so no handle can shadow it",
    (path) => {
      expect(RESERVED_ROUTE_SEGMENTS).toContain(path.slice(1));
    },
  );
});
