import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site";
import { playableGames } from "@/lib/games-catalog";
import { TOOL_CATALOG } from "@/lib/tools-catalog";
import { PUBLISHED_GUIDES } from "@/lib/guides/published";
import { buildLlmsTxt } from "./llms-txt";
import { buildLlmsFullTxt } from "./llms-full-txt";
import type { LlmsData } from "./data";

/**
 * The two machine-readable documents.
 *
 * These tests pin the things that are invisible until something downstream
 * silently breaks: the llms.txt v2 SHAPE (exactly one H1, a blockquote, H2
 * sections, `## Optional` last), the rule that every URL is absolute and
 * canonical, and the rule that nothing private, admin, authenticated or
 * per-reader can appear in either file.
 *
 * The builders are pure and take plain data, which is the whole reason they are
 * separate from the routes: the route's job is one read and one response, and
 * neither of those is worth a fixture.
 */

const DATA: LlmsData = {
  formats: [
    {
      slug: "redraft-ppr-std",
      display_name: "Redraft 1QB PPR",
      league_type: "redraft",
      scoring_type: "ppr",
      is_superflex: false,
      te_premium_bonus: 0,
    },
    {
      slug: "dynasty-ppr-sflex",
      display_name: "Dynasty PPR SF",
      league_type: "dynasty",
      scoring_type: "ppr",
      is_superflex: true,
      te_premium_bonus: 0,
    },
    // The pair that used to collide: same league type, same scoring, same
    // superflex, separated only by the tight end premium.
    {
      slug: "dynasty-ppr-tep-sflex",
      display_name: "Dynasty PPR SF TEP",
      league_type: "dynasty",
      scoring_type: "ppr",
      is_superflex: true,
      te_premium_bonus: 0.5,
    },
  ],
  sources: [
    {
      slug: "ffbeacon",
      display: "FF Beacon",
      description: "FF Beacon's own value.",
      isDefault: true,
      supportedFormatSlugs: ["redraft-ppr-std", "dynasty-ppr-sflex"],
    },
    {
      slug: "ktc",
      display: "KTC",
      description: "KeepTradeCut community-sourced trade values",
      isDefault: false,
      supportedFormatSlugs: ["dynasty-ppr-sflex"],
    },
  ],
  categories: [
    {
      slug: "injuries",
      name: "Injuries",
      description: "Who is hurt, how bad, and whether they will play.",
    },
  ],
  articles: [
    {
      slug: "a-real-article",
      title: "A real article",
      summary: "What happened and what it does to a roster.",
      publishedAt: "2026-09-01T12:00:00Z",
    },
  ],
  articleCount: 428,
};

/** Every markdown link target in a document. */
function urlsIn(doc: string): string[] {
  return [...doc.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}

/**
 * Every absolute URL anywhere in the body, link target or not.
 *
 * The forbidden-route check runs over this rather than over the raw text,
 * because the raw text legitimately says the words "/leagues/" and
 * "/tools/manager-pulse/" while EXPLAINING that those pages are excluded. What
 * must never appear is a URL pointing at one.
 */
function allUrlsIn(doc: string): string[] {
  return [...doc.matchAll(/https?:\/\/[^\s)\]>]+/g)].map((m) =>
    m[0].replace(/[.,]+$/, ""),
  );
}

/**
 * Routes that must never be advertised to a crawler or an agent.
 *
 * These are the same surfaces robots.ts disallows, plus the per-reader ones the
 * sitemap deliberately omits. A regex rather than a prefix check, because the
 * failure being guarded against is a URL appearing anywhere in the body, not
 * only as a list item.
 */
const FORBIDDEN = [
  /\/admin\b/,
  /\/api\/(?!og\b)/,
  /\/auth\b/,
  /\/my-beacon\b/,
  /\/login\b/,
  // A concrete league, handle or share id. The URL PATTERNS with a {placeholder}
  // are fine and are how a model is told where live data lives.
  /\/leagues\/(?!\{)/,
  /\/tools\/signal-check\/v\//,
  /\/tools\/manager-pulse\/(?!\{)/,
];

describe.each([
  ["llms.txt", () => buildLlmsTxt(DATA)],
  ["llms-full.txt", () => buildLlmsFullTxt(DATA)],
])("%s", (_name, build) => {
  it("has exactly one H1 and it names the site", () => {
    const doc = build();
    const h1s = doc.split("\n").filter((l) => /^# /.test(l));
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toContain(SITE.name);
  });

  it("opens with the H1 on the very first line", () => {
    expect(build().split("\n")[0]).toMatch(/^# /);
  });

  it("carries a blockquote summary", () => {
    expect(build()).toMatch(/^> \S/m);
  });

  it("uses only absolute canonical URLs", () => {
    const urls = allUrlsIn(build());
    expect(urls.length).toBeGreaterThan(10);
    for (const url of urls) {
      // The bare origin is legitimate: the full document names the site once.
      const canonical = url === SITE.url || url.startsWith(`${SITE.url}/`);
      expect(canonical, `relative or foreign URL: ${url}`).toBe(true);
    }
  });

  it("never advertises an admin, API, auth, account or per-reader URL", () => {
    const urls = allUrlsIn(build());
    expect(urls.length).toBeGreaterThan(10);
    for (const url of urls) {
      const path = url.slice(SITE.url.length);
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(path), `${url} matched ${pattern}`).toBe(false);
      }
    }
  });

  it("carries no query strings, fragments or trailing-slash duplicates", () => {
    for (const url of urlsIn(build())) {
      expect(url).not.toContain("?");
      expect(url).not.toContain("#");
      expect(url.endsWith("/"), `trailing slash: ${url}`).toBe(
        url === `${SITE.url}/`,
      );
    }
  });

  it("lists no URL twice inside one markdown list item set", () => {
    // A duplicate LINK is fine (the map points at /about from two sections on
    // purpose); a duplicate LINE is a copy-paste mistake.
    const lines = build()
      .split("\n")
      .filter((l) => l.startsWith("- ["));
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("ends with exactly one trailing newline", () => {
    const doc = build();
    expect(doc.endsWith("\n")).toBe(true);
    expect(doc.endsWith("\n\n")).toBe(false);
  });
});

describe("llms.txt structure", () => {
  const doc = buildLlmsTxt(DATA);

  it("puts every resource under an H2, and no deeper heading exists", () => {
    expect(doc).toMatch(/^## Start here$/m);
    expect(doc).not.toMatch(/^### /m);
  });

  it("keeps `## Optional` as the very last section", () => {
    // The v2 shape reserves Optional for what an agent may skip, so nothing may
    // follow it: an agent trimming context drops from that heading down. The
    // notes that used to sit after it are now free-form prose above the first
    // H2, where the shape allows them and where they cannot be discarded.
    const headings = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings.at(-1)).toBe("Optional");
  });

  it("carries the citation and scope notes above the first section", () => {
    const firstHeading = doc.indexOf("\n## ");
    const preamble = doc.slice(0, firstHeading);
    expect(preamble).toContain("value sources and");
    expect(preamble).toContain("/leagues/");
    expect(preamble).toContain("Attribution is welcome");
  });

  it("names each format the way its own rankings page names it", () => {
    // display_name is the abbreviated header-popover label. formatPhrase is what
    // the page's own title and h1 use, and what a reader would type.
    expect(doc).toContain("Dynasty Superflex PPR TE Premium rankings");
    expect(doc).not.toContain("Dynasty PPR SF rankings");
  });

  it("tells two formats apart when only the tight end premium separates them", () => {
    const descriptions = doc
      .split("\n")
      .filter((l) => l.includes("/rankings/dynasty-ppr"))
      .map((l) => l.slice(l.indexOf("): ") + 3));
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("links every tool, guide and game exactly once", () => {
    for (const tool of TOOL_CATALOG) {
      expect(doc).toContain(`(${SITE.url}${tool.href})`);
    }
    for (const guide of PUBLISHED_GUIDES) {
      expect(doc).toContain(`(${SITE.url}/guides/${guide.slug})`);
    }
    for (const game of playableGames()) {
      expect(doc).toContain(`(${SITE.url}${game.href})`);
    }
  });

  it("links the full corpus, the sitemap and robots", () => {
    expect(doc).toContain(`(${SITE.url}/llms-full.txt)`);
    expect(doc).toContain(`(${SITE.url}/sitemap.xml)`);
    expect(doc).toContain(`(${SITE.url}/robots.txt)`);
  });

  it("gives every link a description rather than a bare bullet", () => {
    const items = doc.split("\n").filter((l) => l.startsWith("- ["));
    expect(items.length).toBeGreaterThan(15);
    for (const item of items) {
      expect(item, `no description: ${item}`).toMatch(/\): \S/);
      const description = item.slice(item.indexOf("): ") + 3);
      expect(description.length, `thin description: ${item}`).toBeGreaterThan(20);
    }
  });

  it("never truncates a description mid-sentence", () => {
    // `oneLine` appends an ellipsis past its cap. A map entry that ends in one
    // has lost the half of the sentence a model needed to pick the link.
    for (const item of doc.split("\n").filter((l) => l.startsWith("- ["))) {
      expect(item.endsWith("..."), `truncated: ${item}`).toBe(false);
    }
  });

  it("stays a map rather than becoming a second sitemap", () => {
    // No article list: the Brief is represented by its index and its categories.
    expect(doc).not.toContain("/brief/a-real-article");
    // Small enough that an agent can read it before deciding anything.
    expect(Buffer.byteLength(doc, "utf8")).toBeLessThan(16_000);
  });
});

describe("llms-full.txt content", () => {
  const doc = buildLlmsFullTxt(DATA);

  it("carries substantially more than the map does", () => {
    expect(Buffer.byteLength(doc, "utf8")).toBeGreaterThan(
      Buffer.byteLength(buildLlmsTxt(DATA), "utf8") * 5,
    );
  });

  it("answers the questions the map only points at", () => {
    for (const phrase of [
      "Signal Check",
      "Power Pulse",
      "Positional WAR",
      "Manager Pulse",
      "Beacon Breakdown",
      "FAAB Calculator",
      "The Beacon Brief",
      "Sleeper",
      "Accessibility",
      "glossary",
    ]) {
      expect(doc, `missing: ${phrase}`).toContain(phrase);
    }
  });

  it("names every live format and value source", () => {
    for (const f of DATA.formats) expect(doc).toContain(f.slug);
    for (const s of DATA.sources) expect(doc).toContain(s.display);
  });

  it("reads the guide count from the register rather than typing one", () => {
    expect(doc).toContain(`${PUBLISHED_GUIDES.length} published.`);
  });

  it("indexes the news desk without inlining article bodies", () => {
    expect(doc).toContain(`(${SITE.url}/brief/a-real-article)`);
    expect(doc).toContain(String(DATA.articleCount));
  });

  it("keeps FF Beacon's own values distinct from third-party sources", () => {
    expect(doc).toMatch(/separate (model|opinion)/);
  });

  it("states that league pages are excluded rather than silently omitting them", () => {
    expect(doc).toMatch(/\/leagues\/ .*(excluded|not)/i);
  });
});
