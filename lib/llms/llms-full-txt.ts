/**
 * Builds /llms-full.txt: the comprehensive markdown context document.
 *
 * llms-full.txt has no formal spec, only a convention: where /llms.txt is a map
 * of links, this carries the CONTENT, so a model can answer questions about FF
 * Beacon without fetching anything else.
 *
 * The architectural decision that shapes this file is what to do about the
 * database-generated surfaces, which are unbounded and change hourly:
 *
 *   Rankings and player profiles are NOT inlined. There are thousands of
 *   players times thirteen formats times four value sources, every number moves
 *   nightly, and a table of them would be stale before it finished downloading
 *   and would still answer no question a reader could not answer better by
 *   fetching the live page. What is included instead is the MODEL: what a value
 *   is, what it is scoped to, which sources exist, which formats exist, and the
 *   canonical URL pattern for retrieving any of it live.
 *
 *   The Beacon Brief IS indexed, headline and summary, newest first, up to
 *   ARTICLE_INDEX_LIMIT. That is a real answer to "what has FF Beacon covered
 *   recently" and it is what a model needs to decide which article to fetch.
 *   The article bodies are not inlined: they are news, they age, and the whole
 *   desk would be several megabytes.
 *
 *   The glossary IS inlined in full. It is the largest block here by some way
 *   and it earns it: it is evergreen, it is written to stand alone, and it is
 *   the single highest-value thing on the site for a model answering a fantasy
 *   football question.
 *
 * Nothing per-reader appears anywhere: no league, no roster, no Sleeper handle,
 * no account. The reads behind this file all go through the publishable key.
 */

import { SITE } from "@/lib/site";
import { playableGames } from "@/lib/games-catalog";
import { TOOL_CATALOG } from "@/lib/tools-catalog";
import { PUBLISHED_GUIDES } from "@/lib/guides/published";
import { formatPhrase } from "@/lib/rankings-formats";
import { describeFormat } from "./format-copy";
import {
  GLOSSARY_SECTIONS,
  GLOSSARY_FAQS,
  TERM_COUNT,
} from "@/lib/guides/fantasy-football-terms";
import {
  ACCESSIBILITY,
  BEACON_TERMS,
  BRIEF_CONTEXT,
  CITATION_NOTES,
  DATA_MODEL,
  FUNDING,
  SITE_CONTEXT,
  SITE_SUMMARY,
  SLEEPER_INTEGRATION,
} from "./context";
import type { LlmsData } from "./data";

/**
 * How many Beacon Brief articles the index carries.
 *
 * Enough that "what has been covered lately" is genuinely answered, small
 * enough that the whole document stays inside what a model will read in one
 * go. The count of everything published is stated beside the list so a model
 * knows the index is a window rather than the whole desk.
 */
export const ARTICLE_INDEX_LIMIT = 150;

export function buildLlmsFullTxt(data: LlmsData): string {
  const u = (path: string) => `${SITE.url}${path}`;
  const out: string[] = [];
  const h2 = (heading: string) => out.push(`## ${heading}`, "");
  const h3 = (heading: string) => out.push(`### ${heading}`, "");
  const p = (...paragraphs: string[]) => {
    for (const text of paragraphs) out.push(text, "");
  };
  // A markdown autolink rather than a bare URL: `<...>` is the standard form,
  // so a parser extracting link targets picks the section's own source page up
  // alongside the article index, and it does not print the URL twice the way
  // `[url](url)` would.
  const source = (path: string) => p(`Source: <${u(path)}>`);

  out.push(`# ${SITE.name}: full context`, "");
  p(`> ${SITE_SUMMARY}`);
  p(
    `This is the comprehensive machine-readable context document for ${SITE.name} (${SITE.url}). It is written for language models, retrieval systems and agents. The curated link map is at ${u("/llms.txt")}; the exhaustive URL list is at ${u("/sitemap.xml")}.`,
    "Everything here is public site content. Nothing in this document is generated from any reader's account, league or Sleeper history.",
  );

  /* ---------------------------------------------------------------- */
  h2("What FF Beacon is");
  source("/about");
  p(...SITE_CONTEXT);
  p(
    "The site exists to close two gaps at once. The first is jargon: fantasy football metrics get used as though everyone already knows them, so FF Beacon defines the metric in the same view where it is used and shows the arithmetic instead of asking a reader to trust it. The second is accessibility: most fantasy tools trap their numbers in unlabeled charts and mouse-only filters, so every screen here is written as semantic HTML first and driven with a keyboard and a screen reader before it ships.",
  );
  p(...FUNDING);

  h3("Who it is for");
  p(
    "Fantasy football managers of any experience level, in redraft, dynasty and best ball leagues. It is built specifically to be usable by blind and low-vision managers, and by anyone who would rather read a sentence than interpret a chart.",
  );

  /* ---------------------------------------------------------------- */
  h2("Tools");
  source("/tools");
  p(
    "Every tool is free and none requires an account. Each has its own page, and each respects the reader's chosen value source and league format unless it is inside a synced league, where the league's own scoring settings take over.",
  );
  for (const tool of TOOL_CATALOG) {
    h3(tool.title);
    source(tool.href);
    p(tool.pitch);
    p("What it gives you:");
    for (const bullet of tool.bullets) out.push(`- ${bullet}`);
    out.push("");
  }

  h3("Rankings board");
  source("/rankings");
  p(
    "The reference board rather than a tool you run against your own league: every ranked player and, in dynasty formats, every draft pick, for the selected format and value source, with tiers, positional rank and the seven-day move beside each one.",
    `Each format also has its own page at ${u("/rankings/{format-slug}")}, listed under "League formats" below.`,
  );

  h3("Player profiles");
  source("/players/{player-slug}");
  p(
    "One profile per fantasy-relevant player, covering current trade value and its trend, weekly projections, career and game-log statistics, graded trades the player has been part of, and every Beacon Brief story that mentions them. Profiles are enumerated in the players sitemap rather than listed here, because the set changes with the rankings.",
  );

  /* ---------------------------------------------------------------- */
  h2("Player values, formats and sources");
  source("/about");
  p(...DATA_MODEL);

  h3("Value sources");
  p(
    `${data.sources.length} value sources are live. The reader picks one in the site header and every value on the site follows it. The default is ${data.sources.find((s) => s.isDefault)?.display ?? "the first active source"}.`,
  );
  for (const s of data.sources) {
    const formats = s.supportedFormatSlugs;
    const coverage =
      formats === null
        ? "Covers every active format."
        : `Covers ${formats.length} of the ${data.formats.length} active formats: ${formats.join(", ")}.`;
    // The registry's descriptions are written as labels, so some end in a full
    // stop and some do not. Without this the coverage sentence runs straight
    // into the description and reads as one broken sentence.
    const described = s.description ?? "A selectable value source";
    const sentence = /[.!?]$/.test(described) ? described : `${described}.`;
    out.push(
      `- **${s.display}** (\`${s.slug}\`)${s.isDefault ? ", the site default" : ""}: ${sentence} ${coverage}`,
    );
  }
  out.push("");

  h3("League formats");
  p(
    `${data.formats.length} formats are active. A format fixes the league type, the reception scoring, and whether the lineup has a superflex slot. Every ranking, value and trade grade is scoped to one of them.`,
  );
  for (const f of data.formats) {
    out.push(
      `- **${formatPhrase(f)}** (\`${f.slug}\`): ${describeFormat(f)}. Rankings at ${u(`/rankings/${f.slug}`)}`,
    );
  }
  out.push("");

  /* ---------------------------------------------------------------- */
  h2("Sleeper integration");
  p(...SLEEPER_INTEGRATION);
  p(
    "Sleeper league pages live under /leagues/ and are generated per league from that league's own data. They are deliberately excluded from the sitemap, from /llms.txt and from this document: they belong to the people in the league, not to the site's public corpus.",
  );

  /* ---------------------------------------------------------------- */
  h2("FF Beacon terminology");
  p(
    "These terms are specific to this product. Anything not listed here is ordinary fantasy football vocabulary and is defined in the glossary further down, whose closing section carries the site's own longer wording for several of them.",
  );
  for (const { term, definition } of BEACON_TERMS) {
    out.push(`- **${term}**: ${definition}`);
  }
  out.push("");

  /* ---------------------------------------------------------------- */
  h2("The Beacon Brief");
  source("/brief");
  p(...BRIEF_CONTEXT);
  p(
    `${data.articleCount} articles are published. The feed is at ${u("/brief/rss.xml")}, every article URL is in ${u("/sitemaps/articles.xml")}, and an individual article is at ${u("/brief/{article-slug}")}.`,
  );

  h3("Categories");
  for (const c of data.categories) {
    out.push(
      `- **${c.name}** (${u(`/brief/category/${c.slug}`)}): ${c.description ?? `${c.name} coverage`}`,
    );
  }
  out.push("");

  if (data.articles.length > 0) {
    h3("Recent coverage index");
    p(
      `The ${data.articles.length} most recent articles of ${data.articleCount} published, newest first. Article bodies are not reproduced here: fetch the URL for the full story. Coverage of a specific player is collected on that player's profile.`,
    );
    for (const a of data.articles) {
      out.push(
        `- [${a.title}](${u(`/brief/${a.slug}`)})${a.summary ? `: ${a.summary}` : ""}`,
      );
    }
    out.push("");
  }

  /* ---------------------------------------------------------------- */
  h2("Guides");
  source("/guides");
  p(
    `Long-form explainers written in plain English, with nothing assumed. ${PUBLISHED_GUIDES.length} published.`,
  );
  for (const g of PUBLISHED_GUIDES) {
    out.push(`- [${g.title}](${u(`/guides/${g.slug}`)}): ${g.summary}`);
  }
  out.push("");

  /* ---------------------------------------------------------------- */
  h2("Fantasy football glossary");
  source("/guides/fantasy-football-terms");
  p(
    `${TERM_COUNT} fantasy football terms, defined in full. These definitions describe the game rather than this website, except where a term names something FF Beacon built. This is the most complete evergreen reference in this document.`,
  );
  for (const s of GLOSSARY_SECTIONS) {
    h3(s.title);
    p(s.intro);
    for (const t of s.terms) {
      out.push(`**${t.term}**${t.aka ? ` (${t.aka})` : ""}`, "");
      for (const para of t.body) out.push(para, "");
    }
  }

  h3("Common questions");
  for (const faq of GLOSSARY_FAQS) {
    out.push(`**${faq.question}**`, "", faq.answer, "");
  }

  /* ---------------------------------------------------------------- */
  h2("Games");
  source("/games");
  p(
    "Free games built on the same live player data behind the rankings and tools. No account is needed to play, though signing in is what lets a vote be counted once per person.",
  );
  for (const g of playableGames()) {
    out.push(`- [${g.title}](${u(g.href)}): ${g.description}`);
  }
  out.push("");

  /* ---------------------------------------------------------------- */
  h2("Accessibility");
  source("/about");
  p(
    "Accessibility is the reason this site exists rather than a feature of it. Six rules decide whether anything is finished:",
  );
  for (const rule of ACCESSIBILITY) out.push(`- ${rule}`);
  out.push("");

  /* ---------------------------------------------------------------- */
  h2("Editorial and authorship");
  source(SITE.author.bylineHref);
  p(
    `${SITE.name} is written and built by ${SITE.author.name}, who is the byline on every Beacon Brief article and every guide. There is no other editorial staff and no sponsored content.`,
    "Beacon Brief stories report on named original reporting and credit that reporter. FF Beacon adds the fantasy read on top of it rather than claiming the reporting.",
  );

  /* ---------------------------------------------------------------- */
  h2("Policies");
  p(
    `- Privacy policy: ${u("/privacy")}. What is collected, why, who it is shared with, what happens when you donate, and how to have it deleted.`,
    `- Terms of service: ${u("/terms")}. The rules for using the site, how donations work, and how the service is provided.`,
    `- Donations: ${u("/donate")}. Optional, one-time, and not refunded, because nothing is being sold.`,
  );

  /* ---------------------------------------------------------------- */
  h2("Notes for answer engines");
  for (const note of CITATION_NOTES) out.push(`- ${note}`);
  out.push("");

  return `${out.join("\n").trimEnd()}\n`;
}
