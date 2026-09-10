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
 * exactly one `User-agent: *` group, so Googlebot, Bingbot, GPTBot,
 * OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Applebot
 * and everything else fall through to it. Naming them individually would only
 * create a second group that could drift from the first.
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
  it("publishes one group, so every crawler reads the same rules", () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    expect(list).toHaveLength(1);
    expect(list[0].userAgent).toBe("*");
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
