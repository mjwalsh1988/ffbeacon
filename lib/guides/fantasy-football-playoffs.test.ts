import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import {
  ABBREVIATION_GROUPS,
  ALL_ABBREVIATIONS,
  ALL_TERMS,
  GLOSSARY_SECTIONS,
} from "./fantasy-football-terms";
import {
  FOOTER_FIXED_GUIDES,
  FOOTER_NEWEST_COUNT,
  FOOTER_PINNED_GUIDE,
  PUBLISHED_GUIDES,
  footerGuideLinks,
  guidesNewestFirst,
  newestPublishedGuide,
} from "./published";

/**
 * The playoff guide's links, and the footer the guides register now feeds.
 *
 * Anchors are typed by hand in several files, and a renamed heading breaks a
 * link silently: the page still loads, it just lands at the top. So every
 * "#..." in the guide, and every "/guides/<slug>#..." pointing into or out of
 * it, is checked against an id the target page actually renders.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const GUIDE_DIR = "app/guides/fantasy-football-playoffs";
const GUIDE_FILES = [
  `${GUIDE_DIR}/page.tsx`,
  `${GUIDE_DIR}/playoff-figures.tsx`,
  `${GUIDE_DIR}/playoff-classroom.tsx`,
];

/** Files that link to a guide anchor as part of this work. */
const LINKING_FILES = [
  ...GUIDE_FILES,
  "lib/guides/fantasy-football-terms.ts",
  "app/guides/faab-strategy/page.tsx",
  "app/guides/fantasy-football-trade-guide/page.tsx",
  "app/guides/dynasty-strategy/page.tsx",
  "components/power-pulse/projected-standings.tsx",
  "app/leagues/[league_id]/schedules/page.tsx",
];

const glossaryIds = new Set([
  ...GLOSSARY_SECTIONS.map((s) => s.id),
  ...ALL_TERMS.map((t) => t.id),
  ...ABBREVIATION_GROUPS.map((g) => g.id),
  ...ALL_ABBREVIATIONS.map((a) => a.id),
]);

/** The ids a guide page renders, read from its source. */
function renderedIds(slug: string): Set<string> {
  if (slug === "fantasy-football-terms") return glossaryIds;
  const src = read(`app/guides/${slug}/page.tsx`);
  return new Set([...src.matchAll(/\bid="([a-z0-9-]+)"/g)].map((m) => m[1]));
}

describe("the playoff guide's own anchors", () => {
  const page = read(`${GUIDE_DIR}/page.tsx`);
  const ids = renderedIds("fantasy-football-playoffs");

  it("renders every table of contents entry", () => {
    const toc = [...page.matchAll(/\{ id: "([a-z0-9-]+)", label:/g)].map((m) => m[1]);
    expect(toc.length).toBe(13);
    for (const id of toc) expect(ids.has(id), id).toBe(true);
  });

  it("sends every in-page jump link to an id the page renders", () => {
    const hrefs = GUIDE_FILES.flatMap((f) =>
      [...read(f).matchAll(/href[=:]\s*"#([a-z0-9-]+)"/g)].map((m) => m[1]),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(8);
    for (const id of hrefs) expect(ids.has(id), id).toBe(true);
  });
});

describe("links into and out of the guide", () => {
  const links = LINKING_FILES.flatMap((f) =>
    [...read(f).matchAll(/"\/guides\/([a-z0-9-]+)#([a-z0-9-]+)"/g)].map((m) => ({
      file: f,
      slug: m[1],
      anchor: m[2],
    })),
  );

  it("finds the links this work added", () => {
    const intoPlayoffs = links.filter((l) => l.slug === "fantasy-football-playoffs");
    // Glossary (7), FAAB (1), trade guide (2), dynasty (1), Power Pulse (1), Schedules (1).
    expect(intoPlayoffs.length).toBeGreaterThanOrEqual(13);
  });

  it("resolves every one to an id its target page renders", () => {
    for (const l of links) {
      expect(existsSync(join(root, `app/guides/${l.slug}/page.tsx`)), l.slug).toBe(true);
      expect(renderedIds(l.slug).has(l.anchor), `${l.file} -> ${l.slug}#${l.anchor}`).toBe(true);
    }
  });
});

describe("the model facts the guide quotes", () => {
  it("still match the shipped opponent-adjustment defaults", () => {
    // Lesson 5 and the matchup figure say: at most 15 percent either way, and
    // no adjustment at all for receivers and quarterbacks, by default.
    const o = DEFAULT_POWER_PULSE_SETTINGS.opponent;
    expect(o.minMultiplier).toBe(0.85);
    expect(o.maxMultiplier).toBe(1.15);
    expect(o.positionReliability.WR).toBe(0);
    expect(o.positionReliability.QB).toBe(0);
    expect(o.positionReliability.RB).toBeGreaterThan(0);
  });
});

describe("the guide's copy", () => {
  it("uses plain ASCII punctuation only", () => {
    // Em dash, en dash, curly quotes, ellipsis, middle dot, non-breaking space.
    const banned = /[\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00B7\u00A0]/;
    for (const f of [...GUIDE_FILES, "lib/guides/playoff-odds.ts", "lib/guides/playoff-luck-example.ts"]) {
      const lines = read(f).split("\n");
      lines.forEach((line, i) => expect(banned.test(line), `${f}:${i + 1}`).toBe(false));
    }
  });
});

describe("the guides register", () => {
  it("lists the playoff guide, with a page behind it", () => {
    const g = PUBLISHED_GUIDES.find((x) => x.slug === "fantasy-football-playoffs");
    expect(g).toBeDefined();
    expect(existsSync(join(root, `${GUIDE_DIR}/page.tsx`))).toBe(true);
  });

  it("gives every guide a short label and a page", () => {
    for (const g of PUBLISHED_GUIDES) {
      expect(g.navLabel.length, g.slug).toBeGreaterThan(0);
      expect(g.navLabel.length, g.slug).toBeLessThanOrEqual(26);
      expect(existsSync(join(root, `app/guides/${g.slug}/page.tsx`)), g.slug).toBe(true);
    }
  });

  it("orders guides newest first, deterministically on a tie", () => {
    const order = guidesNewestFirst().map((g) => g.slug);
    expect(order[0]).toBe(newestPublishedGuide().slug);
    for (let i = 1; i < order.length; i++) {
      const a = PUBLISHED_GUIDES.find((g) => g.slug === order[i - 1])!;
      const b = PUBLISHED_GUIDES.find((g) => g.slug === order[i])!;
      expect(Date.parse(a.publishedAt)).toBeGreaterThanOrEqual(Date.parse(b.publishedAt));
    }
    expect(guidesNewestFirst().map((g) => g.slug)).toEqual(order);
  });
});

describe("footerGuideLinks", () => {
  const links = footerGuideLinks();

  it("pins the glossary first and ends on the full shelf with the count", () => {
    expect(links[0].href).toBe(`/guides/${FOOTER_PINNED_GUIDE}`);
    expect(links[links.length - 1]).toEqual({
      label: `All ${PUBLISHED_GUIDES.length} guides`,
      href: "/guides",
    });
  });

  it("shows the newest guides in between, and nothing twice", () => {
    const middle = links.slice(1, -1).map((l) => l.href);
    const expected = guidesNewestFirst()
      .filter((g) => g.slug !== FOOTER_PINNED_GUIDE && !FOOTER_FIXED_GUIDES.includes(g.slug))
      .slice(0, FOOTER_NEWEST_COUNT)
      .map((g) => `/guides/${g.slug}`);
    expect(middle).toEqual(expected);
    expect(new Set(links.map((l) => l.href)).size).toBe(links.length);
  });

  it("stays short however many guides are published", () => {
    expect(links.length).toBeLessThanOrEqual(FOOTER_NEWEST_COUNT + 2);
  });

  it("leaves the fixed links to the footer column itself", () => {
    for (const slug of FOOTER_FIXED_GUIDES) {
      expect(links.some((l) => l.href === `/guides/${slug}`)).toBe(false);
    }
  });
});
