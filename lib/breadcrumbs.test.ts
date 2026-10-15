import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, buildBreadcrumbs } from "./breadcrumbs";
import { RANKINGS_HUB_HREF } from "@/lib/rankings-hub";

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

  it("name the IDP rankings under Rankings", () => {
    expect(items("/rankings/idp").map((i) => i.name)).toEqual(["Home", "Rankings", "IDP Rankings"]);
    expect(buildBreadcrumbs("/rankings/idp").at(-1)).toEqual({ label: "IDP Rankings", href: undefined });
    // The Rankings step goes to the hub, never through to a saved format's board.
    expect(buildBreadcrumbs("/rankings/idp")[0].href).toBe(RANKINGS_HUB_HREF);
  });

  it("put the guillotine calculator under the FAAB calculator", () => {
    expect(buildBreadcrumbs("/tools/faab/guillotine")).toEqual([
      { label: "Tools", href: "/tools" },
      { label: "FAAB Calculator", href: "/tools/faab" },
      { label: "Guillotine Calculator", href: undefined },
    ]);
    expect(items("/tools/faab/guillotine").map((i) => i.name)).toEqual([
      "Home",
      "Tools",
      "FAAB Calculator",
      "Guillotine Calculator",
    ]);
  });
});
