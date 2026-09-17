/**
 * Card text for a Relay, composed by code and never by a model.
 *
 * Takes the stored row's fields and returns exactly what the site card, the
 * Discord card and the retraction notice say. Pure and tested. There is no
 * sentence generation here and, by the owner's decision, there will not be:
 * no "what it means" line on a Relay. Rewriting is for Briefs only.
 *
 * The Discord text carries NO LINK of any kind: no permalink, no source URL,
 * no markdown link syntax. A Relay is our structured record of the report, so
 * there is never a URL in it to carry; the "via" line is the whole credit.
 * Discord's 2,000 character limit is enforced here with the same rule Would
 * You Rather uses for poll text: never drop a fact silently. A card that
 * cannot fit falls back to the headline plus the via line and says so in the
 * return value, so the worker can log it.
 */

import { formatEastern } from "@/lib/datetime";
import type { RelayFact } from "./types";

/** Discord's hard cap on message content. */
export const DISCORD_CONTENT_LIMIT = 2000;

export interface RelayRenderInput {
  headline: string;
  facts: RelayFact[];
  /** "AdamSchefter" or "@AdamSchefter"; both render the same. */
  sourceHandle: string;
  /** The post's own timestamp, ISO. */
  sourcePostedAt: string;
}

export interface RelayCardText {
  headline: string;
  /** Label and value pairs in stored order. */
  facts: RelayFact[];
  /** "Original report: @AdamSchefter on X, Sep 16, 2026, 7:30 AM EDT" */
  sourceLine: string;
  /** "via @AdamSchefter" */
  viaLine: string;
  /** The Discord message content. No links, no mentions. */
  discordText: string;
  /** False when the facts had to be left off to fit Discord's limit. */
  discordFitted: boolean;
}

/** Normalise a handle to exactly one leading at sign. */
export function handleWithAt(handle: string): string {
  const trimmed = handle.trim().replace(/^@+/, "");
  return `@${trimmed || "source"}`;
}

/** The credit line under a card. */
export function relaySourceLine(sourceHandle: string, sourcePostedAt: string): string {
  return `Original report: ${handleWithAt(sourceHandle)} on X, ${formatEastern(sourcePostedAt)}`;
}

/** Strip anything that would read as a link or a mention in Discord. */
function discordSafe(text: string): string {
  return (
    text
      // Markdown link syntax left behind by a model: keep the visible text.
      // Runs FIRST, or the URL rule below eats the closing paren.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // A URL of any scheme, and bare www hosts.
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "")
      .replace(/\bwww\.\S+/gi, "")
      // Role, user and channel mentions, and the two broadcast tokens.
      .replace(/<[@#][!&]?\d+>/g, "")
      .replace(/@(everyone|here)\b/gi, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

export function renderRelayCard(input: RelayRenderInput): RelayCardText {
  const headline = input.headline.trim();
  const facts = input.facts
    .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
    .filter((f) => f.label && f.value);
  const viaLine = `via ${handleWithAt(input.sourceHandle)}`;
  const sourceLine = relaySourceLine(input.sourceHandle, input.sourcePostedAt);

  const full = discordSafe(
    [headline, facts.map((f) => `${f.label}: ${f.value}`).join("\n"), viaLine]
      .filter((part) => part.length > 0)
      .join("\n\n"),
  );

  if (full.length <= DISCORD_CONTENT_LIMIT) {
    return { headline, facts, sourceLine, viaLine, discordText: full, discordFitted: true };
  }

  const short = discordSafe(`${headline}\n\n${viaLine}`).slice(0, DISCORD_CONTENT_LIMIT);
  return { headline, facts, sourceLine, viaLine, discordText: short, discordFitted: false };
}

/** The text a retracted Relay's Discord card is edited to. */
export function renderRetractedDiscordText(input: {
  headline: string;
  sourceHandle: string;
}): string {
  return discordSafe(
    [
      "Retracted: the original report was removed by its author.",
      input.headline.trim(),
      `via ${handleWithAt(input.sourceHandle)}`,
    ].join("\n\n"),
  ).slice(0, DISCORD_CONTENT_LIMIT);
}
