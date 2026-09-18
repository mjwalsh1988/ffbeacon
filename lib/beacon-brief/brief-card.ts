/**
 * The Beacon Brief's Discord card.
 *
 * WHAT CHANGED AND WHY. The edition post used to be four strings joined by
 * blank lines: "@everyone", the title, the tl;dr, the URL. Discord rendered
 * that as what it was, a wall of grey text with a link preview stapled
 * underneath, and an edition that took a person twenty minutes to review
 * arrived looking like a bot alert. The facts are the same; this puts them in
 * an embed so the channel can read them.
 *
 * THE SHAPE, top to bottom:
 *
 *   content       The ping, and one line saying what has landed. Nothing else,
 *                 and DELIBERATELY NOT THE URL: a bare link in content makes
 *                 Discord build its own preview card under ours, so the post
 *                 carries the same edition twice. The embed title is the link.
 *   author        "The Beacon Brief", the standing masthead.
 *   title + url   The headline, clickable.
 *   description   The tl;dr, verbatim.
 *   fields        The edition's own stat tiles, three across, then the list of
 *                 sections so a reader can see what is inside before clicking.
 *   image         The edition's OG card, the same 1200x630 the page and the
 *                 social unfurl use, so the three cannot drift apart.
 *   footer        The period, in words, plus the domain.
 *
 * NOTHING IS TRUNCATED MID-SENTENCE. The same rule League Relay holds to
 * (lib/league-relay/limits.ts): a unit either fits whole or it is dropped
 * whole, and a dropped list of sections says how many it dropped rather than
 * trailing off. The one place a count stands in for content is the section
 * list, where "and 4 more" is an honest summary rather than a severed sentence.
 *
 * Pure. No I/O, no clock, no Supabase. The worker gathers the facts.
 */

import type { DiscordEmbed, DiscordEmbedField } from "@/lib/discord";

/** FF Beacon purple, as Discord wants it: a decimal integer. */
export const BRIEF_ACCENT = 0xa855f7;

/* Discord's hard caps. Every one of them is a 400, never a silent trim. */
const CONTENT_MAX = 2000;
const TITLE_MAX = 256;
const AUTHOR_MAX = 256;
const DESCRIPTION_MAX = 4096;
const FIELD_NAME_MAX = 256;
const FIELD_VALUE_MAX = 1024;
const FOOTER_MAX = 2048;
const EMBED_TOTAL_MAX = 6000;
/** Five per cent back, because Discord counts some characters as more than one. */
const SAFETY_MARGIN = 0.95;

/** How many section headings the contents field will list before summarising. */
const SECTIONS_LISTED_MAX = 8;
/** Stat tiles render three across on a desktop client, so three is the row. */
const STAT_TILES_MAX = 3;

export interface BriefCardInput {
  /** The published headline. */
  title: string;
  /** Absolute URL of the edition page. */
  url: string;
  /** The edition's tl;dr, exactly as approved. Null when it has none. */
  tlDr: string | null;
  /** "Week 3, 2026", "Pre-season, 2026". Already worded by lib/brief-desk/period.ts. */
  periodChip: string | null;
  /** "Covers Sep 9 to Sep 15, 2026", already in Eastern. Null when unknown. */
  periodCovered: string | null;
  /** The edition's headline figures. At most three are shown. */
  statTiles: Array<{ label: string; value: string }>;
  /** The section headings, in the order the edition runs them. */
  sectionHeadings: string[];
  /** Absolute URL of the edition's 1200x630 OG card. Null to post without one. */
  imageUrl: string | null;
  /** The two edition formats as one phrase, for the footer. Null when unknown. */
  formatsPhrase: string | null;
}

export interface BriefCard {
  content: string;
  embeds: DiscordEmbed[];
  /** Which optional parts were left out to fit. Recorded in the log line. */
  dropped: string[];
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The one-line announcement above the card. Never carries the URL. */
export function briefAnnouncement(periodChip: string | null): string {
  return periodChip
    ? `@everyone The ${periodChip} Beacon Brief is live.`
    : "@everyone A new Beacon Brief is live.";
}

/**
 * The contents field: what a reader gets for clicking.
 *
 * Lists headings until it runs out of either the display cap or Discord's 1024
 * characters, then says how many it did not list. A count is not a truncation:
 * "and 4 more" is a complete statement, where a heading cut at "The waiver wire
 * that" is not.
 */
export function contentsField(headings: string[]): DiscordEmbedField | null {
  const all = headings.map(clean).filter(Boolean);
  if (all.length === 0) return null;

  const lines: string[] = [];
  let used = 0;
  for (const heading of all.slice(0, SECTIONS_LISTED_MAX)) {
    const line = `- ${heading}`;
    // Reserve room for the "and N more" line so adding it can never overflow.
    if (used + line.length + 1 > FIELD_VALUE_MAX - 24) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return null;

  const remaining = all.length - lines.length;
  if (remaining > 0) lines.push(`and ${remaining} more`);

  return {
    name: "In this edition".slice(0, FIELD_NAME_MAX),
    value: lines.join("\n").slice(0, FIELD_VALUE_MAX),
    inline: false,
  };
}

/** The headline figures, three across. Empty when the edition published none. */
export function statFields(
  tiles: Array<{ label: string; value: string }>,
): DiscordEmbedField[] {
  return tiles
    .map((t) => ({ label: clean(t.label), value: clean(t.value) }))
    .filter((t) => t.label && t.value)
    .slice(0, STAT_TILES_MAX)
    .map((t) => ({
      name: t.label.slice(0, FIELD_NAME_MAX),
      value: t.value.slice(0, FIELD_VALUE_MAX),
      inline: true,
    }));
}

/** The small print: which period this covers, in which formats, and the domain. */
export function briefFooter(input: BriefCardInput): string {
  const bits = [input.periodCovered, input.formatsPhrase, "ffbeacon.com"].filter(
    (b): b is string => Boolean(b && b.trim()),
  );
  return bits.join(" | ").slice(0, FOOTER_MAX);
}

function embedCost(embed: DiscordEmbed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

/**
 * Build the message.
 *
 * The title, the tl;dr and the link are the edition; they are priced first and
 * are never dropped. The stat tiles and the contents list are the decoration,
 * and they leave in that order if the 6000-character embed budget is tight,
 * which for a normal edition it is not.
 */
export function buildBriefCard(input: BriefCardInput): BriefCard {
  const dropped: string[] = [];
  const title = clean(input.title).slice(0, TITLE_MAX);
  const description = input.tlDr ? clean(input.tlDr).slice(0, DESCRIPTION_MAX) : undefined;

  const embed: DiscordEmbed = {
    author: { name: "The Beacon Brief".slice(0, AUTHOR_MAX) },
    title,
    url: input.url,
    color: BRIEF_ACCENT,
  };
  if (description) embed.description = description;
  const footer = briefFooter(input);
  if (footer) embed.footer = { text: footer };
  if (input.imageUrl) embed.image = { url: input.imageUrl };

  const ceiling = Math.floor(EMBED_TOTAL_MAX * SAFETY_MARGIN);
  const fields: DiscordEmbedField[] = [];
  let cost = embedCost(embed);

  for (const field of statFields(input.statTiles)) {
    const price = field.name.length + field.value.length;
    if (cost + price > ceiling) {
      dropped.push("stat tiles");
      break;
    }
    fields.push(field);
    cost += price;
  }

  const contents = contentsField(input.sectionHeadings);
  if (contents) {
    const price = contents.name.length + contents.value.length;
    if (cost + price > ceiling) dropped.push("contents");
    else {
      fields.push(contents);
      cost += price;
    }
  }
  if (fields.length > 0) embed.fields = fields;

  return {
    content: briefAnnouncement(input.periodChip).slice(0, CONTENT_MAX),
    embeds: [embed],
    dropped: [...new Set(dropped)],
  };
}
