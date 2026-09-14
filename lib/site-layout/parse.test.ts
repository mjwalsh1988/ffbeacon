import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOLS_NAV } from "@/lib/site";
import { TOOL_CATALOG } from "@/lib/tools-catalog";
import { NAV_TREE_SECTION_IDS } from "@/lib/nav-tree";
import {
  DEFAULT_SITE_LAYOUT,
  NAV_SECTION_IDS,
  TOOL_BADGES,
  TOOL_HREFS,
} from "./default-settings";
import { mergeSiteLayout, validateSiteLayout } from "./parse";

const SHIPPED_ORDER = [
  "/tools/league-pulse",
  "/tools/trade-calculator",
  "/tools/who-should-i-start",
  "/tools/faab",
  "/tools/manager-pulse",
  "/tools/on-the-clock",
];

/** The layout the site carried on 2026-09-14, frozen. What migration 0282 seeds. */
const LAYOUT_2026_09_14 = {
  menu: {
    sectionOrder: [
      "home",
      "tools",
      "rankings",
      "games",
      "brief",
      "guides",
      "my-beacon",
      "about",
      "admin",
    ],
    toolOrder: SHIPPED_ORDER,
  },
  toolsPage: { toolOrder: SHIPPED_ORDER },
  homepage: {
    cards: [
      { href: "/tools/league-pulse", width: 1, badge: "new-features", highlight: "green" },
      { href: "/tools/trade-calculator", width: 1, badge: null, highlight: null },
      { href: "/tools/who-should-i-start", width: 1, badge: "new-features", highlight: "green" },
      { href: "/tools/faab", width: 1, badge: null, highlight: null },
      { href: "/tools/manager-pulse", width: 1, badge: "new-tool", highlight: "cyan" },
      { href: "/tools/on-the-clock", width: 1, badge: null, highlight: null },
    ],
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("the defaults", () => {
  it("are the layout the site carried when this became editable", () => {
    expect(DEFAULT_SITE_LAYOUT.menu.toolOrder).toEqual(SHIPPED_ORDER);
    expect(DEFAULT_SITE_LAYOUT.toolsPage.toolOrder).toEqual(SHIPPED_ORDER);
    expect(DEFAULT_SITE_LAYOUT.homepage.cards.map((c) => c.href)).toEqual(SHIPPED_ORDER);
    expect(
      DEFAULT_SITE_LAYOUT.homepage.cards
        .filter((c) => c.badge || c.highlight)
        .map((c) => [c.href, c.badge, c.highlight]),
    ).toEqual([
      ["/tools/league-pulse", "new-features", "green"],
      ["/tools/who-should-i-start", "new-features", "green"],
      ["/tools/manager-pulse", "new-tool", "cyan"],
    ]);
    expect(DEFAULT_SITE_LAYOUT.homepage.cards.every((c) => c.width === 1)).toBe(true);
  });

  it("match the code order of TOOLS_NAV and TOOL_CATALOG, the fallbacks behind them", () => {
    expect(TOOLS_NAV.map((t) => t.href)).toEqual(DEFAULT_SITE_LAYOUT.menu.toolOrder);
    expect(TOOL_CATALOG.map((t) => t.href)).toEqual(DEFAULT_SITE_LAYOUT.toolsPage.toolOrder);
  });

  it("name every section the navigation tree has, in its own order", () => {
    expect([...NAV_SECTION_IDS]).toEqual(NAV_TREE_SECTION_IDS);
    expect(DEFAULT_SITE_LAYOUT.menu.sectionOrder).toEqual(NAV_TREE_SECTION_IDS);
  });

  it("still read the 0282 seed row the way it was written", () => {
    // Pinned to the frozen 2026-09-14 layout rather than to DEFAULT_SITE_LAYOUT:
    // 0282 is applied and must never be edited, while the defaults will grow
    // the day a tool is added. What has to stay true is that the seed parses
    // cleanly into that layout, whatever the defaults become.
    const sql = readFileSync(
      fileURLToPath(
        new URL("../../supabase/migrations/0282_site_layout_settings.sql", import.meta.url),
      ),
      "utf8",
    );
    const seed = /\$seed\$([\s\S]*?)\$seed\$/.exec(sql)?.[1];
    expect(seed).toBeTruthy();
    const parsed = JSON.parse(seed as string);
    expect(parsed).toEqual(LAYOUT_2026_09_14);
    expect(validateSiteLayout(parsed).ok).toBe(true);
  });

  it("are, today, the layout 0282 seeded", () => {
    // Expected to change when the shipped layout does. Update the defaults and
    // this expectation together; the seed test above stays pinned.
    expect(DEFAULT_SITE_LAYOUT).toEqual(LAYOUT_2026_09_14);
  });

  it("pass the strict validation", () => {
    expect(validateSiteLayout(clone(DEFAULT_SITE_LAYOUT))).toEqual({
      ok: true,
      settings: DEFAULT_SITE_LAYOUT,
    });
  });

  it("use plain ASCII in every tag label", () => {
    for (const badge of Object.values(TOOL_BADGES)) {
      expect(badge.label).toMatch(/^[\x20-\x7E]+$/);
      expect(badge.use).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});

describe("mergeSiteLayout", () => {
  it("falls back to the defaults for an empty or broken row", () => {
    expect(mergeSiteLayout(undefined)).toEqual(DEFAULT_SITE_LAYOUT);
    expect(mergeSiteLayout("nonsense")).toEqual(DEFAULT_SITE_LAYOUT);
    expect(mergeSiteLayout({ menu: 4, homepage: { cards: "x" } })).toEqual(DEFAULT_SITE_LAYOUT);
  });

  it("keeps a stored order and appends a tool the row has never heard of", () => {
    const merged = mergeSiteLayout({
      menu: { toolOrder: ["/tools/faab", "/tools/removed-long-ago", "/tools/league-pulse"] },
    });
    expect(merged.menu.toolOrder.slice(0, 2)).toEqual(["/tools/faab", "/tools/league-pulse"]);
    expect([...merged.menu.toolOrder].sort()).toEqual([...TOOL_HREFS].sort());
  });

  it("cleans each card rather than dropping the row", () => {
    const merged = mergeSiteLayout({
      homepage: {
        cards: [
          { href: "/tools/faab", width: 3, badge: "beta", highlight: "amber" },
          { href: "/tools/faab", width: 1, badge: null, highlight: null },
          { href: "/tools/league-pulse", width: 7, badge: "toString", highlight: "pink" },
        ],
      },
    });
    const [first, second, ...rest] = merged.homepage.cards;
    expect(first).toEqual({ href: "/tools/faab", width: 3, badge: "beta", highlight: "amber" });
    expect(second).toEqual({
      href: "/tools/league-pulse",
      width: 1,
      badge: null,
      highlight: null,
    });
    // The tools the stored cards did not mention keep their default cards.
    expect(rest.find((c) => c.href === "/tools/manager-pulse")).toEqual({
      href: "/tools/manager-pulse",
      width: 1,
      badge: "new-tool",
      highlight: "cyan",
    });
    expect(merged.homepage.cards).toHaveLength(TOOL_HREFS.length);
  });
});

describe("validateSiteLayout", () => {
  it("refuses a list missing a tool", () => {
    const layout = clone(DEFAULT_SITE_LAYOUT);
    layout.toolsPage.toolOrder.pop();
    const result = validateSiteLayout(layout);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^All tools page:/);
  });

  it("refuses a repeated card", () => {
    const layout = clone(DEFAULT_SITE_LAYOUT);
    layout.homepage.cards[1] = { ...layout.homepage.cards[0] };
    expect(validateSiteLayout(layout).ok).toBe(false);
  });

  it("refuses an unknown tag, highlight, width or section", () => {
    const badTag = clone(DEFAULT_SITE_LAYOUT) as unknown as {
      homepage: { cards: Array<Record<string, unknown>> };
    };
    badTag.homepage.cards[0].badge = "hot";
    expect(validateSiteLayout(badTag).ok).toBe(false);

    const badHighlight = clone(DEFAULT_SITE_LAYOUT) as unknown as typeof badTag;
    badHighlight.homepage.cards[0].highlight = "pink";
    expect(validateSiteLayout(badHighlight).ok).toBe(false);

    const badWidth = clone(DEFAULT_SITE_LAYOUT) as unknown as typeof badTag;
    badWidth.homepage.cards[0].width = 4;
    expect(validateSiteLayout(badWidth).ok).toBe(false);

    const badSection = clone(DEFAULT_SITE_LAYOUT) as unknown as {
      menu: { sectionOrder: string[] };
    };
    badSection.menu.sectionOrder[0] = "secret";
    const result = validateSiteLayout(badSection);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Main menu sections:/);
  });

  it("refuses something that is not a layout at all", () => {
    expect(validateSiteLayout(null).ok).toBe(false);
    expect(validateSiteLayout({}).ok).toBe(false);
  });

  it("refuses a key the form never sends", () => {
    const extra = clone(DEFAULT_SITE_LAYOUT) as unknown as {
      homepage: { cards: Array<Record<string, unknown>> };
    };
    extra.homepage.cards[0].className = "anything";
    expect(validateSiteLayout(extra).ok).toBe(false);
  });
});
