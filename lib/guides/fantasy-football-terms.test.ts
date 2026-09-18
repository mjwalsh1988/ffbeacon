import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABBREVIATION_GROUPS,
  ALL_ABBREVIATIONS,
  ALL_TERMS,
  GLOSSARY_FAQS,
  GLOSSARY_QUICK_LINKS,
  GLOSSARY_SECTIONS,
  buildGlossarySearchIndex,
} from "./fantasy-football-terms";
import { normalizeGlossaryQuery, searchGlossary } from "./glossary-search";

/**
 * The glossary's ids are permanent URLs, and the page renders every string
 * here twice (as copy and as structured data), so these tests hold the lines
 * a hand edit is most likely to cross.
 */

describe("glossary anchors", () => {
  it("never reuses an id across sections, terms, abbreviation groups and abbreviations", () => {
    const ids = [
      ...GLOSSARY_SECTIONS.map((s) => s.id),
      ...ALL_TERMS.map((t) => t.id),
      ...ABBREVIATION_GROUPS.map((g) => g.id),
      ...ALL_ABBREVIATIONS.map((a) => a.id),
      "faq",
      "closing",
      "abbreviations",
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prefixes every abbreviation id so it cannot collide with a future term", () => {
    for (const a of ALL_ABBREVIATIONS) expect(a.id.startsWith("abbr-")).toBe(true);
    for (const g of ABBREVIATION_GROUPS) expect(g.id.startsWith("abbr-")).toBe(true);
  });

  it("sends every hardcoded jump link to an id the page renders", () => {
    const rendered = new Set([
      ...GLOSSARY_SECTIONS.map((s) => s.id),
      ...ALL_TERMS.map((t) => t.id),
      ...ABBREVIATION_GROUPS.map((g) => g.id),
      ...ALL_ABBREVIATIONS.map((a) => a.id),
    ]);
    for (const link of GLOSSARY_QUICK_LINKS) expect(rendered.has(link.id), link.id).toBe(true);

    // The figures carry their own in-page links, typed as href="#..." strings.
    const figures = readFileSync(
      join(process.cwd(), "app/guides/fantasy-football-terms/glossary-figures.tsx"),
      "utf8",
    );
    const hrefs = [...figures.matchAll(/href:\s*"#([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(10);
    for (const id of hrefs) expect(rendered.has(id), id).toBe(true);
  });

  it("points every abbreviation's termId at a term that exists", () => {
    const termIds = new Set(ALL_TERMS.map((t) => t.id));
    for (const a of ALL_ABBREVIATIONS) {
      if (a.termId) expect(termIds.has(a.termId), `${a.abbr} -> ${a.termId}`).toBe(true);
    }
  });
});

describe("glossary copy", () => {
  const everyString = [
    ...GLOSSARY_SECTIONS.flatMap((s) => [s.title, s.intro]),
    ...ALL_TERMS.flatMap((t) => [t.term, t.aka ?? "", ...t.body, t.link?.label ?? ""]),
    ...ABBREVIATION_GROUPS.flatMap((g) => [g.title, g.intro]),
    ...ALL_ABBREVIATIONS.flatMap((a) => [a.abbr, a.stands, a.meaning, a.more ?? ""]),
    ...GLOSSARY_FAQS.flatMap((f) => [f.question, f.answer]),
  ];

  it("uses plain ASCII punctuation only", () => {
    // Em dash, en dash, curly quotes, ellipsis, middle dot, non-breaking space.
    const banned = /[–—‘’“”…· ]/;
    for (const s of everyString) expect(banned.test(s), s).toBe(false);
  });

  it("opens every abbreviation with a sentence that names the letters", () => {
    for (const a of ALL_ABBREVIATIONS) {
      const first = a.abbr.split(",")[0].trim().toLowerCase();
      expect(a.meaning.toLowerCase().includes(first), a.abbr).toBe(true);
    }
  });
});

describe("the find-a-term box", () => {
  const index = buildGlossarySearchIndex();

  it("strips the words every question shares", () => {
    expect(normalizeGlossaryQuery("What does BN mean in fantasy football?")).toBe("bn");
    expect(normalizeGlossaryQuery("what is a be in fantasy")).toBe("be");
    expect(normalizeGlossaryQuery("what does it mean")).toBe("it");
    expect(normalizeGlossaryQuery("what does mean")).toBe("");
  });

  it("puts the exact abbreviation first", () => {
    expect(searchGlossary(index, "what does be mean in fantasy football")[0].id).toBe("abbr-bn");
    expect(searchGlossary(index, "cel meaning fantasy football")[0].id).toBe("abbr-cel");
    expect(searchGlossary(index, "OPRK")[0].id).toBe("abbr-oprk");
    expect(searchGlossary(index, "q")[0].id).toBe("abbr-q");
    expect(searchGlossary(index, "tep")[0].id).toBe("abbr-tep");
  });

  it("answers a short exact abbreviation with that abbreviation only", () => {
    expect(searchGlossary(index, "what does be mean").map((e) => e.id)).toEqual(["abbr-bn"]);
  });

  it("ignores punctuation, so W/R/T and wrt are the same search", () => {
    expect(searchGlossary(index, "wrt")[0].id).toBe("abbr-wrt");
    expect(searchGlossary(index, "W/R/T")[0].id).toBe("abbr-wrt");
  });

  it("falls back to one word at a time when the whole phrase matches nothing", () => {
    const ids = searchGlossary(index, "what does pf and pa mean").map((e) => e.id);
    expect(ids).toContain("abbr-pf-pa");
  });

  it("finds full terms by name", () => {
    expect(searchGlossary(index, "handcuff")[0].id).toBe("handcuff");
    expect(searchGlossary(index, "superflex").map((e) => e.id)).toContain("superflex");
  });

  it("returns nothing for an empty or all-filler query", () => {
    expect(searchGlossary(index, "")).toEqual([]);
    expect(searchGlossary(index, "what does it mean in fantasy football").length).toBeLessThanOrEqual(8);
    expect(searchGlossary(index, "what does mean")).toEqual([]);
  });

  it("caps the list", () => {
    expect(searchGlossary(index, "e", 5).length).toBeLessThanOrEqual(5);
  });
});
