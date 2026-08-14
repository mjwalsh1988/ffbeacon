/**
 * Guide page matching. The matcher list is order-sensitive (most specific
 * first) and ends in a single-segment creator-profile catch-all, so adding an
 * entry in the wrong place silently re-points another page's guide.
 */

import { describe, expect, it } from "vitest";
import { resolveGuidePageKey } from "./registry";

describe("resolveGuidePageKey", () => {
  it("matches the tool pages, most specific first", () => {
    expect(resolveGuidePageKey("/tools/league-pulse")).toBe("league-pulse");
    expect(resolveGuidePageKey("/tools/faab")).toBe("faab");
    expect(resolveGuidePageKey("/tools")).toBe("tools");
  });

  it("matches the rest of the site", () => {
    expect(resolveGuidePageKey("/rankings")).toBe("rankings");
    expect(resolveGuidePageKey("/players/brock-purdy-6813")).toBe("player-profile");
    expect(resolveGuidePageKey("/leagues/123")).toBe("league-overview");
    expect(resolveGuidePageKey("/leagues/123/transactions")).toBe("league-transactions");
    expect(resolveGuidePageKey("/games/signal-scout")).toBe("signal-scout");
    expect(resolveGuidePageKey("/my-beacon")).toBe("dashboard");
    expect(resolveGuidePageKey("/")).toBe("home");
  });

  it("does not let a tool page fall through to the creator-profile catch-all", () => {
    // /tools/* is two segments so it could never reach the catch-all, but a
    // single-segment reserved route could, and that is the failure this guards.
    expect(resolveGuidePageKey("/login")).toBeNull();
    expect(resolveGuidePageKey("/somehandle")).toBe("creator-profile");
    expect(resolveGuidePageKey("/u/somehandle")).toBe("creator-profile");
  });

  it("ignores a trailing slash and a query string", () => {
    expect(resolveGuidePageKey("/tools/league-pulse/")).toBe("league-pulse");
    expect(resolveGuidePageKey("/tools/league-pulse?tab=teams")).toBe("league-pulse");
  });
});
