/**
 * Builds /llms.txt: the CURATED MAP of FF Beacon, following the llms.txt v2
 * shape (llmstxt.org). One H1, one blockquote, optional plain paragraphs, then
 * H2 sections of markdown links, with `## Optional` last for the things an
 * agent can skip when it is short of context.
 *
 * It is deliberately NOT a second sitemap. sitemap.xml already enumerates every
 * URL for a crawler that wants all of them; this exists so a model can learn
 * the SHAPE of the site in one fetch and pick the two or three pages it
 * actually needs. So: no article list, no player pages, no tag archives, no
 * per-league URLs, no query strings. The corpus lives in /llms-full.txt and the
 * exhaustive URL list lives in the sitemap, and both are linked from here.
 *
 * Every entry is generated from a registry the rest of the site already reads,
 * so a tool, guide, format, value source or Brief category cannot exist in the
 * product and be missing here. See ./data.ts and ./context.ts.
 */

import { SITE } from "@/lib/site";
import { playableGames } from "@/lib/games-catalog";
import { TOOL_CATALOG } from "@/lib/tools-catalog";
import { PUBLISHED_GUIDES } from "@/lib/guides/published";
import { TERM_COUNT } from "@/lib/guides/fantasy-football-terms";
import { formatPhrase } from "@/lib/rankings-formats";
import { describeFormat } from "./format-copy";
import { SITE_SUMMARY, SITE_CONTEXT } from "./context";
import { oneLine, type LlmsData } from "./data";

/**
 * A markdown list item: `- [name](url): description`.
 *
 * The cap is generous because every description here is written to be read
 * whole. `oneLine` is the backstop against a category description from the
 * database growing without anyone noticing, not the thing that shapes the copy.
 */
const DESCRIPTION_CAP = 280;

function link(name: string, url: string, description: string): string {
  return `- [${name}](${url}): ${oneLine(description, DESCRIPTION_CAP)}`;
}

/**
 * The opening of a pitch, trimmed to what a map entry needs.
 *
 * The catalog's `pitch` is a full paragraph written for a person reading a
 * marketing section. A model scanning a map wants to know what the tool
 * answers, not to read the pitch, so this takes whole sentences off the front
 * until there is enough to be useful.
 *
 * Sentences, not a character slice, because a slice cuts mid-word. More than
 * one sentence when the first is short: Beacon Breakdown's pitch opens "Two
 * players. One verdict.", and "Two players." on its own describes nothing.
 *
 * The upper bound matters as much as the lower one. `link()` runs the result
 * through `oneLine`, which appends an ellipsis past its cap, and Beacon
 * Breakdown's second sentence lands two characters short of it: one more clause
 * in that pitch and the map entry would silently truncate mid-sentence, in the
 * one file whose whole job is letting a model pick a link without fetching it.
 * So a sentence that would cross the cap is not taken, unless nothing has been
 * taken yet and there is no shorter honest answer.
 */
const MIN_DESCRIPTION = 60;
const MAX_DESCRIPTION = 240;

function opening(pitch: string): string {
  const sentences = pitch.split(/(?<=\.)\s+/);
  const taken: string[] = [];
  for (const sentence of sentences) {
    const next = [...taken, sentence].join(" ");
    if (taken.length > 0 && next.length > MAX_DESCRIPTION) break;
    taken.push(sentence);
    if (next.length >= MIN_DESCRIPTION) break;
  }
  return taken.join(" ");
}

export function buildLlmsTxt(data: LlmsData): string {
  const u = (path: string) => `${SITE.url}${path}`;
  const out: string[] = [];
  const section = (heading: string, entries: string[]) => {
    if (entries.length === 0) return;
    out.push(`## ${heading}`, "", ...entries, "");
  };

  const formatNames = data.formats.map((f) => formatPhrase(f));

  out.push(`# ${SITE.name}`, "");
  out.push(`> ${SITE_SUMMARY}`, "");
  for (const paragraph of SITE_CONTEXT) out.push(paragraph, "");

  // Free-form notes, which the llms.txt shape allows between the blockquote and
  // the first H2. They sit HERE rather than at the end because `## Optional` has
  // to be the last section: an agent trimming context drops everything from that
  // heading down, and a note it has to read to quote the site correctly cannot
  // live in the part it is invited to discard.
  //
  // Every figure is read from a registry or the database. Nothing here is a
  // number typed into a file that will be wrong in a month.
  out.push(
    `Player values are scoped to a value source and a league format. ${data.sources.length} value sources and ${data.formats.length} formats are live: ${formatNames.join(", ")}. The glossary at ${u("/guides/fantasy-football-terms")} defines ${TERM_COUNT} fantasy football terms and is the best single page for a terminology question.`,
    "",
  );
  out.push(
    "Pages under /leagues/, /tools/manager-pulse/ and any reader's own account are generated from one person's Sleeper data. They are not site content, they are not listed below, and they should not be crawled or quoted as ours. Everything that is listed is free to read and needs no account.",
    "",
  );
  out.push(
    "Attribution is welcome: cite FF Beacon and link the page an answer came from. Player values change daily, so quote the date, the format and the value source shown on the page rather than presenting a value as permanent.",
    "",
  );

  section("Start here", [
    link(
      "FF Beacon home",
      u("/"),
      "The front page: the current format and value source pickers, the latest Beacon Brief coverage, and the way into every tool",
    ),
    link(
      "About FF Beacon",
      u("/about"),
      "What the site is, who it is for, where every number comes from, how accessibility is handled, and how it is paid for",
    ),
    link(
      "All tools",
      u("/tools"),
      "Every tool on one page, each with what it does and what you get from it",
    ),
    link(
      "Full machine-readable context",
      u("/llms-full.txt"),
      "The comprehensive FF Beacon corpus in markdown: product detail, the value and format model, the full fantasy football glossary, and an index of the news desk",
    ),
  ]);

  section(
    "Fantasy football tools",
    TOOL_CATALOG.map((tool) => link(tool.title, u(tool.href), opening(tool.pitch))),
  );

  section("Rankings and player values", [
    link(
      "Rankings by format",
      u("/rankings"),
      "The directory of every league format's rankings board, with a short guide to which format a league is. A reader who has already picked a format is taken straight to that board",
    ),
    ...data.formats.map((f) =>
      link(
        `${formatPhrase(f)} rankings`,
        u(`/rankings/${f.slug}`),
        `Player and pick rankings for ${describeFormat(f)}`,
      ),
    ),
  ]);

  section("Fantasy football guides", [
    link(
      "All guides",
      u("/guides"),
      "Long-form fantasy football explainers written in plain English, with nothing assumed",
    ),
    ...PUBLISHED_GUIDES.map((g) =>
      link(g.title, u(`/guides/${g.slug}`), g.summary),
    ),
  ]);

  // Every ACTIVE category, which is deliberately a looser rule than the one
  // lib/sitemap/sections.ts applies (it lists only categories that have
  // published articles, because a sitemap must never carry a page that renders
  // "Nothing here yet"). The two rules differ because the files answer
  // different questions: a sitemap advertises pages worth crawling, and this
  // describes the desk's taxonomy. An empty bucket is still a true statement
  // about how coverage is organised, and it renders a real page rather than
  // a 404.
  section("The Beacon Brief: NFL news for fantasy managers", [
    link(
      "The Beacon Brief",
      u("/brief"),
      `NFL news written for fantasy managers, with the roster impact stated plainly. ${data.articleCount} articles published so far`,
    ),
    ...data.categories.map((c) =>
      link(
        `${c.name} coverage`,
        u(`/brief/category/${c.slug}`),
        c.description ?? `${c.name} stories from The Beacon Brief`,
      ),
    ),
    link(
      "Beacon Brief RSS feed",
      u("/brief/rss.xml"),
      "The news desk as a machine-readable feed, newest first",
    ),
  ]);

  // Playable only. A game still in development has no page, and neither file
  // may advertise a URL that 404s.
  section(
    "Games",
    playableGames().map((g) => link(g.title, u(g.href), g.description)),
  );

  section("About and editorial", [
    link(
      "About FF Beacon",
      u("/about"),
      "The mission, the product, the accessibility rules, where the data comes from, and how the site is funded",
    ),
    link(
      SITE.author.name,
      u(SITE.author.bylineHref),
      "The person who builds FF Beacon, writes its guides, and oversees the automated news desk that drafts the Beacon Brief",
    ),
    link(
      "Support FF Beacon",
      u("/donate"),
      "One-time donations, which are optional gifts and buy no tier, no early access and no advantage on the site",
    ),
  ]);

  section("Machine-readable resources", [
    link(
      "This file",
      u("/llms.txt"),
      "The curated map of FF Beacon for answer engines and agents",
    ),
    link(
      "Full context corpus",
      u("/llms-full.txt"),
      "The comprehensive markdown context document, including the full glossary and the Beacon Brief index",
    ),
    link(
      "Sitemap index",
      u("/sitemap.xml"),
      "Every indexable URL, split into core pages, articles, player profiles and public profiles",
    ),
    link(
      "robots.txt",
      u("/robots.txt"),
      "Crawl rules. AI crawlers are not blocked; admin, API, auth and account routes are",
    ),
  ]);

  // The genuinely secondary material. An agent trying to answer a question
  // about fantasy football or about this site can skip all of it.
  section("Optional", [
    link(
      "Privacy policy",
      u("/privacy"),
      "What is collected, why, who it is shared with, what happens on a donation, and how to delete it",
    ),
    link(
      "Terms of service",
      u("/terms"),
      "The rules for using the site, how donations work, and how the service is provided",
    ),
  ]);

  return `${out.join("\n").trimEnd()}\n`;
}
