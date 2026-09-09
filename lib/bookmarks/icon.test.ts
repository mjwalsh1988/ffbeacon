import { describe, expect, it } from "vitest";
import { bookmarkIconFor } from "./icon";
import { NAV_ICONS } from "@/components/app-shell/nav-icons";

describe("bookmarkIconFor", () => {
  it("matches the longest prefix, not the first", () => {
    expect(bookmarkIconFor("/tools")).toBe("wrench");
    expect(bookmarkIconFor("/tools/faab")).toBe("calculator");
    expect(bookmarkIconFor("/tools/league-pulse")).toBe("workflow");
  });

  it("covers everything under a prefix", () => {
    expect(bookmarkIconFor("/brief/some-story-slug")).toBe("newspaper");
    expect(bookmarkIconFor("/leagues/1234567890/lineups")).toBe("league");
  });

  it("does not give a league the tool's glyph", () => {
    // They used to share one, which made League Pulse and every league saved
    // out of it look identical on a bar where the icon is most of what a
    // reader scans. A league with a logo of its own paints that instead; this
    // is the placeholder for one without.
    expect(bookmarkIconFor("/tools/league-pulse")).toBe("workflow");
    expect(bookmarkIconFor("/leagues/123")).toBe("league");
  });

  it("ignores the query string and the fragment", () => {
    expect(bookmarkIconFor("/leagues/123?tab=teams")).toBe("league");
    expect(bookmarkIconFor("/tools/faab#bids")).toBe("calculator");
  });

  it("gives the homepage the home glyph", () => {
    expect(bookmarkIconFor("/")).toBe("home");
  });

  it("falls back to the bookmark glyph for an unknown page", () => {
    expect(bookmarkIconFor("/something/nobody/mapped")).toBe("bookmark");
  });

  it("does not confuse a prefix with a longer sibling segment", () => {
    // "/tools-of-the-trade" is not under "/tools".
    expect(bookmarkIconFor("/tools-of-the-trade")).toBe("bookmark");
  });

  it("only ever names an icon the shared map actually has", () => {
    const paths = [
      "/",
      "/tools",
      "/tools/faab",
      "/tools/on-the-clock",
      "/leagues/1/decisions",
      "/brief/x",
      "/players/ja-marr-chase",
      "/my-beacon/bookmarks",
      "/u/someone",
      "/nothing/here",
    ];
    for (const path of paths) {
      expect(Object.keys(NAV_ICONS)).toContain(bookmarkIconFor(path));
    }
  });
});
