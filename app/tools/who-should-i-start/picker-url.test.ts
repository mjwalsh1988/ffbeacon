import { describe, it, expect } from "vitest";
import { buildStartSitHref } from "./picker-url";

describe("buildStartSitHref", () => {
  it("builds p and start from slugs in add order", () => {
    const href = buildStartSitHref({
      basePath: "/tools/who-should-i-start",
      slugs: ["bijan-robinson", "josh-jacobs"],
      start: 1,
    });
    expect(href).toBe("/tools/who-should-i-start?p=bijan-robinson%2Cjosh-jacobs&start=1");
  });

  it("preserves other current params such as week, league and roster", () => {
    const preserve = new URLSearchParams({
      week: "5",
      league: "123",
      roster: "4",
      format: "dynasty-ppr-sflex",
    });
    const href = buildStartSitHref({
      basePath: "/tools/who-should-i-start",
      slugs: ["bijan-robinson", "josh-jacobs"],
      start: 1,
      preserve,
    });
    const url = new URL(href, "https://example.com");
    expect(url.searchParams.get("week")).toBe("5");
    expect(url.searchParams.get("league")).toBe("123");
    expect(url.searchParams.get("roster")).toBe("4");
    expect(url.searchParams.get("format")).toBe("dynasty-ppr-sflex");
    expect(url.searchParams.get("p")).toBe("bijan-robinson,josh-jacobs");
    expect(url.searchParams.get("start")).toBe("1");
  });

  it("strips a stale p, start, and the retired a/b aliases from preserve", () => {
    const preserve = new URLSearchParams({
      p: "old-slug",
      start: "3",
      a: "old-a",
      b: "old-b",
      week: "5",
    });
    const href = buildStartSitHref({
      basePath: "/tools/who-should-i-start",
      slugs: ["bijan-robinson", "josh-jacobs", "alvin-kamara"],
      start: 1,
      preserve,
    });
    const url = new URL(href, "https://example.com");
    expect(url.searchParams.get("p")).toBe("bijan-robinson,josh-jacobs,alvin-kamara");
    expect(url.searchParams.get("start")).toBe("1");
    expect(url.searchParams.get("a")).toBeNull();
    expect(url.searchParams.get("b")).toBeNull();
    expect(url.searchParams.get("week")).toBe("5");
  });

  it("clamps start to 1..N-1 using the shared clampStartCount", () => {
    const href = buildStartSitHref({
      basePath: "/tools/who-should-i-start",
      slugs: ["a", "b", "c"],
      start: 9,
    });
    const url = new URL(href, "https://example.com");
    expect(url.searchParams.get("start")).toBe("2");
  });

  it("floors a requested start below 1 back to 1", () => {
    const href = buildStartSitHref({
      basePath: "/tools/who-should-i-start",
      slugs: ["a", "b"],
      start: 0,
    });
    const url = new URL(href, "https://example.com");
    expect(url.searchParams.get("start")).toBe("1");
  });

  it("omits p and start entirely with no players", () => {
    const href = buildStartSitHref({
      basePath: "/tools/who-should-i-start",
      slugs: [],
      start: 1,
      preserve: new URLSearchParams({ week: "5" }),
    });
    expect(href).toBe("/tools/who-should-i-start?week=5");
  });

  it("returns the bare basePath with nothing to preserve and no players", () => {
    const href = buildStartSitHref({
      basePath: "/tools/who-should-i-start",
      slugs: [],
      start: 1,
    });
    expect(href).toBe("/tools/who-should-i-start");
  });
});
