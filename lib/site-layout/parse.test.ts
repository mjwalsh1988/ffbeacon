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

const SHIPPED_ORDER_2026_09_14 = [
  "/tools/league-pulse",
  "/tools/trade-calculator",
  "/tools/who-should-i-start",
  "/tools/faab",
  "/tools/manager-pulse",
  "/tools/on-the-clock",
];

/** 2026-09-26: Beacon Ranker (/tools/custom-rankings) joins last, which is
 * where normalizeOrder puts it in a stored row that predates it. */
const SHIPPED_ORDER = [...SHIPPED_ORDER_2026_09_14, "/tools/custom-rankings"];

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
    toolOrder: SHIPPED_ORDER_2026_09_14,
  },
  toolsPage: { toolOrder: SHIPPED_ORDER_2026_09_14 },
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

/**
 * The layout the site ships TODAY.
 *
 * Deliberately built from the frozen 2026-09-14 one rather than written out
 * again, so this constant can only ever differ from the seed by the changes
 * named here. Add a line per change, with a date and a reason.
 *
 *   2026-09-22: the Waiver Wire section, a new top level between Rankings and
 *   Games. The stored row is migrated to match (migration 0293); a row that is
 *   not gets the id appended by normalizeOrder, which is safe but puts it last.
 *
 *   2026-09-26: Beacon Ranker (/tools/custom-rankings), last in both tool
 *   orders and as a one-column "New tool" homepage card. A stored row that
 *   predates it gets exactly this from normalizeOrder and mergeCards.
 */
const LAYOUT_TODAY = {
  ...LAYOUT_2026_09_14,
  toolsPage: { toolOrder: SHIPPED_ORDER },
  homepage: {
    cards: [
      ...LAYOUT_2026_09_14.homepage.cards,
      { href: "/tools/custom-rankings", width: 1, badge: "new-tool", highlight: "cyan" },
    ],
  },
  menu: {
    ...LAYOUT_2026_09_14.menu,
    toolOrder: SHIPPED_ORDER,
    sectionOrder: [
      "home",
      "tools",
      "rankings",
      "waiver-wire",
      "games",
      "brief",
      "guides",
      "my-beacon",
      "about",
      "admin",
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
      ["/tools/custom-rankings", "new-tool", "cyan"],
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

    // What has to hold about the seed is that the READ path still turns it
    // into a complete, current layout. It is deliberately NOT checked against
    // validateSiteLayout: that is the admin SAVE gate, which requires a full
    // permutation of today's sections, and a row written before a section
    // existed is one short by definition. Treating that as a failure would
    // mean every new section broke this test and, worse, would suggest the
    // stored row needed rewriting when it does not.
    const merged = mergeSiteLayout(parsed);
    // Every section, exactly once, and a section the row predates APPENDED
    // rather than slotted into its default position. That is normalizeOrder's
    // documented behaviour and it is the safe one: a stored order is somebody's
    // deliberate arrangement, so a new entry goes at the end rather than
    // pushing their choices around. The consequence is cosmetic and is why
    // migration 0293 updates the stored row to put Waiver Wire where the code
    // default has it.
    expect([...merged.menu.sectionOrder].sort()).toEqual([...NAV_SECTION_IDS].sort());
    expect(merged.menu.sectionOrder.at(-1)).toBe("waiver-wire");
    expect(validateSiteLayout(merged).ok).toBe(true);
  });

  it("appends a section the stored row predates rather than losing it", () => {
    // The 2026-09-14 row knows nothing about waiver-wire. A reader on that row
    // must still get every section, and must not get a duplicate or a gap.
    const merged = mergeSiteLayout(clone(LAYOUT_2026_09_14));
    expect([...merged.menu.sectionOrder].sort()).toEqual([...NAV_SECTION_IDS].sort());
    expect(new Set(merged.menu.sectionOrder).size).toBe(NAV_SECTION_IDS.length);
  });

  it("are, today, the shipped layout", () => {
    // Expected to change when the shipped layout does. Update the defaults and
    // LAYOUT_TODAY together; the seed test above stays pinned to 0282.
    expect(DEFAULT_SITE_LAYOUT).toEqual(LAYOUT_TODAY);
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
