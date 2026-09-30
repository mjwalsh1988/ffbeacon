import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, buildBreadcrumbs } from "./breadcrumbs";

const SITE = "https://ffbeacon.com";

type ListItem = { name: string; item: string };
function items(pathname: string): ListItem[] {
  const ld = breadcrumbJsonLd(pathname, SITE) as { itemListElement: ListItem[] } | null;
  return ld?.itemListElement ?? [];
}

describe("crumbs with no page of their own", () => {
  it("do not link /{handle}/rankings, which has no page", () => {
    const crumbs = buildBreadcrumbs("/somebody/rankings/abc123");
    expect(crumbs.map((c) => c.href)).toEqual(["/somebody", undefined, undefined]);
  });

  it("still link My Beacon's own rankings list, which is a real page", () => {
    const crumbs = buildBreadcrumbs("/my-beacon/rankings/abc123");
    expect(crumbs[1].href).toBe("/my-beacon/rankings");
  });

  it("do not link /brief/relay, which has no page", () => {
    const crumbs = buildBreadcrumbs("/brief/relay/some-report");
    expect(crumbs.map((c) => c.href)).toEqual(["/brief", undefined, undefined]);
  });

  it("leave the non-navigable step out of the structured data", () => {
    expect(items("/somebody/rankings/abc123").map((i) => i.item)).toEqual([
      `${SITE}/`,
      `${SITE}/somebody`,
      `${SITE}/somebody/rankings/abc123`,
    ]);
    // Every step names a URL, and no URL but the page's own is repeated.
    const urls = items("/tools/trade-calculator/v/xyz").map((i) => i.item);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("number the remaining steps without gaps", () => {
    const ld = breadcrumbJsonLd("/somebody/rankings/abc123", SITE) as {
      itemListElement: Array<{ position: number }>;
    };
    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
  });
});

describe("ordinary trails", () => {
  it("link every step but the last", () => {
    const crumbs = buildBreadcrumbs("/tools/faab");
    expect(crumbs).toEqual([
      { label: "Tools", href: "/tools" },
      { label: "FAAB Calculator", href: undefined },
    ]);
  });

  it("keep every step in the structured data when each has a page", () => {
    expect(items("/tools/faab").map((i) => i.name)).toEqual(["Home", "Tools", "FAAB Calculator"]);
  });
});
