/**
 * The Beacon Brief's Discord card.
 *
 * WHAT CHANGED AND WHY. The edition post used to be four strings joined by
 * blank lines: "@everyone", the title, the tl;dr, the URL. Discord rendered
 * that as what it was, a wall of gray text with a link preview stapled
 * underneath. The embed replaced it, and for a while it also carried the stat
 * tiles and a list of every section heading, which the owner found cluttered.
 * The body is now one piece of writing and a link.
 *
 * THE SHAPE, top to bottom:
 *
 *   content       The ping, and one line saying what has landed. Nothing else,
 *                 and DELIBERATELY NOT THE URL: a bare link in content makes
 *                 Discord build its own preview card under ours, so the post
 *                 carries the same edition twice. The embed title is the link.
 *   author        "The Beacon Brief", the standing masthead.
 *   title + url   The headline, clickable.
 *   description   ONE body, chosen in this order, then a "Read more" link:
 *                   1. the editor's take, when the owner wrote one;
 *                   2. otherwise the gist (the tl;dr), verbatim.
 *   image         The edition's OG card, the same 1200x630 the page and the
 *                 social unfurl use, so the three cannot drift apart.
 *   footer        The period, in words, plus the domain.
 *
 * NOTHING IS TRUNCATED MID-SENTENCE. The schema caps the take at 2000
 * characters and the tl;dr at 1500, both far inside Discord's 4096 for a
 * description, so the body always goes out whole. The take keeps its
 * paragraph breaks; Discord renders them.
 *
 * Pure. No I/O, no clock, no Supabase. The worker gathers the facts.
 */

import type { DiscordEmbed } from "@/lib/discord";

/** FF Beacon purple, as Discord wants it: a decimal integer. */
export const BRIEF_ACCENT = 0xa855f7;

/* Discord's hard caps. Every one of them is a 400, never a silent trim. */
const CONTENT_MAX = 2000;
const TITLE_MAX = 256;
const AUTHOR_MAX = 256;
const DESCRIPTION_MAX = 4096;
const FOOTER_MAX = 2048;

export interface BriefCardInput {
  /** The published headline. */
  title: string;
  /** Absolute URL of the edition page. */
  url: string;
  /** The owner's take from the review page. Null or blank when there is none. */
  editorTake: string | null;
  /** The edition's tl;dr ("The gist" on the page), exactly as approved. Null when it has none. */
  tlDr: string | null;
  /** "Week 3, 2026", "Pre-season, 2026". Already worded by lib/brief-desk/period.ts. */
  periodChip: string | null;
  /** "Covers Sep 9 to Sep 15, 2026", already in Eastern. Null when unknown. */
  periodCovered: string | null;
  /** Absolute URL of the edition's 1200x630 OG card. Null to post without one. */
  imageUrl: string | null;
  /** The two edition formats as one phrase, for the footer. Null when unknown. */
  formatsPhrase: string | null;
}

export interface BriefCard {
  content: string;
  embeds: DiscordEmbed[];
  /** Which text became the body. Recorded in the log line. */
  bodySource: "editor_take" | "tl_dr" | "none";
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Tidy the take without flattening it: trailing spaces off each line and runs
 * of blank lines down to one, so paragraphs survive as paragraphs.
 */
function cleanParagraphs(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The one-line announcement above the card. Never carries the URL. */
export function briefAnnouncement(periodChip: string | null): string {
  return periodChip
    ? `@everyone The ${periodChip} Beacon Brief is live.`
    : "@everyone A new Beacon Brief is live.";
}

/** The editor's take when there is one, else the gist, else nothing. */
export function briefBody(input: Pick<BriefCardInput, "editorTake" | "tlDr">): {
  text: string | null;
  source: BriefCard["bodySource"];
} {
  const take = input.editorTake ? cleanParagraphs(input.editorTake) : "";
  if (take) return { text: take, source: "editor_take" };
  const gist = input.tlDr ? clean(input.tlDr) : "";
  if (gist) return { text: gist, source: "tl_dr" };
  return { text: null, source: "none" };
}

/** The small print: which period this covers, in which formats, and the domain. */
export function briefFooter(input: BriefCardInput): string {
  const bits = [input.periodCovered, input.formatsPhrase, "ffbeacon.com"].filter(
    (b): b is string => Boolean(b && b.trim()),
  );
  return bits.join(" | ").slice(0, FOOTER_MAX);
}

/** Build the message. */
export function buildBriefCard(input: BriefCardInput): BriefCard {
  const title = clean(input.title).slice(0, TITLE_MAX);
  const body = briefBody(input);
  const readMore = `[Read more](${input.url})`;
  // The link is priced first, so a body at the cap can never push it off.
  const description = body.text
    ? `${body.text.slice(0, DESCRIPTION_MAX - readMore.length - 2)}\n\n${readMore}`
    : readMore;

  const embed: DiscordEmbed = {
    author: { name: "The Beacon Brief".slice(0, AUTHOR_MAX) },
    title,
    url: input.url,
    color: BRIEF_ACCENT,
    description,
  };
  const footer = briefFooter(input);
  if (footer) embed.footer = { text: footer };
  if (input.imageUrl) embed.image = { url: input.imageUrl };

  return {
    content: briefAnnouncement(input.periodChip).slice(0, CONTENT_MAX),
    embeds: [embed],
    bodySource: body.source,
  };
}
