/**
 * Turn a Writeup into a Discord message, or refuse to.
 *
 * THE ONLY PLACE DISCORD'S LIMITS ARE APPLIED, and the only place a message can
 * be rejected for size. A builder writes what it wants to write; this decides
 * what fits, drops whole sections to make it fit, and returns null when even
 * the essential sections do not. Null means POST NOTHING. It never means post
 * a shortened version, because a shortened writeup reads as a complete one and
 * a reader has no way to know the difference.
 *
 * The prose goes in the embed DESCRIPTION rather than in message content: 4096
 * characters against 2000, so a writeup gets twice the room for free.
 */

import type { DiscordEmbed, DiscordMessageInput } from "@/lib/discord";
import {
  EMBED_AUTHOR_MAX,
  EMBED_DESCRIPTION_MAX,
  EMBED_TITLE_MAX,
  EMBED_TOTAL_MAX,
  SAFETY_MARGIN,
  compose,
  embedCost,
  withinLimits,
} from "./limits";
import type { Writeup } from "./types";

/** FF Beacon purple, as Discord wants it: a decimal integer. */
export const BEACON_PURPLE = 0xa855f7;
/** FF Beacon cyan, for the recap card, so the two matchup posts read apart. */
export const BEACON_CYAN = 0x22d3ee;

export const RELAY_ACCENT: Record<string, number> = {
  trade: BEACON_PURPLE,
  waiver: BEACON_CYAN,
  matchup_preview: BEACON_PURPLE,
  matchup_recap: BEACON_CYAN,
};

export interface RenderResult {
  message: DiscordMessageInput;
  /** Section keys dropped to fit. Recorded on the ledger row. */
  dropped: string[];
}

/**
 * Build the message.
 *
 * The budget arithmetic, in order, because the order is the whole trick:
 *
 *   1. The title, footer and fields are priced first. They are short, fixed,
 *      and the reader needs them, so the prose gets whatever they leave.
 *   2. Fields are dropped (highest priority number first) only if the fixed
 *      parts alone already crowd the embed, which effectively never happens and
 *      is handled anyway.
 *   3. The prose is composed into the remainder, dropping whole sections.
 *   4. Everything is re-measured against the real caps before it is returned.
 *      A builder bug therefore surfaces here as a refusal rather than at
 *      Discord as a 400 nobody sees.
 */
export function renderWriteup(
  writeup: Writeup,
  opts: {
    mentionRoleIds: string[];
    pollHours: number | null;
  },
): RenderResult | null {
  const title = writeup.title.slice(0, EMBED_TITLE_MAX);
  const footer = writeup.footer ?? undefined;
  const author = writeup.header.leagueName.slice(0, EMBED_AUTHOR_MAX);

  // THE HEADER IS PREPENDED HERE, not by the builders, so no builder can ship
  // without one. It is priority 0: a message that cannot say which league it
  // belongs to is unidentifiable in a channel carrying several, and dropping it
  // to save a hundred characters would be the wrong trade every time.
  const sections = [
    { key: "header", text: writeup.header.contextLine, priority: 0 },
    ...writeup.sections,
  ];

  // Fields, most important first, priced against the overall embed budget.
  const fields = [...writeup.fields].sort((a, b) => a.priority - b.priority);
  const keptFields: typeof fields = [];
  const ceiling = Math.floor(EMBED_TOTAL_MAX * SAFETY_MARGIN);

  // Reserve a floor for the prose so a stat block can never squeeze the writeup
  // out entirely. A message that is all numbers is the bullet list this feature
  // exists to not be.
  const PROSE_FLOOR = 900;
  let fixedCost = embedCost({ title, footer, author });
  for (const f of fields) {
    const cost = f.name.length + f.value.length;
    if (fixedCost + cost > ceiling - PROSE_FLOOR) continue;
    keptFields.push(f);
    fixedCost += cost;
  }

  const proseBudget = Math.min(EMBED_DESCRIPTION_MAX, ceiling - fixedCost);
  const composed = compose(sections, proseBudget);
  // The essentials alone overflow. Nothing legal can be built, so nothing is.
  if (!composed) return null;

  const embed: DiscordEmbed & { fields?: Array<{ name: string; value: string; inline?: boolean }> } =
    {
      title,
      description: composed.body,
      color: RELAY_ACCENT[writeup.type] ?? BEACON_PURPLE,
    };
  if (writeup.url) embed.url = writeup.url;
  embed.author = { name: author };
  if (footer) embed.footer = { text: footer };
  if (keptFields.length > 0) {
    embed.fields = keptFields.map((f) => ({
      name: f.name,
      value: f.value,
      inline: f.inline ?? false,
    }));
  }

  const mentions = opts.mentionRoleIds.map((id) => `<@&${id}>`).join(" ");

  const check = withinLimits({
    content: mentions,
    title,
    author,
    description: composed.body,
    footer,
    fields: keptFields.map((f) => ({ name: f.name, value: f.value })),
    pollQuestion: writeup.poll?.question,
    pollAnswers: writeup.poll?.answers,
  });
  // A builder produced something that does not fit even after composition. The
  // honest response is silence plus a ledger row saying why, which the caller
  // writes; posting a mangled version is not on the table.
  if (!check.ok) return null;

  const message: DiscordMessageInput = {
    content: mentions,
    embeds: [embed],
    allowedRoleIds: opts.mentionRoleIds,
  };
  if (writeup.poll && opts.pollHours !== null) {
    message.poll = {
      question: writeup.poll.question,
      answers: writeup.poll.answers,
      durationHours: opts.pollHours,
    };
  }

  return { message, dropped: composed.dropped };
}

/**
 * The writeup as plain text, for the admin preview and the ledger.
 *
 * Deliberately built from the SAME composition the message uses, so what an
 * admin reads on the preview screen is what the channel gets, dropped sections
 * included. A second, prettier renderer would let the two drift.
 */
export function renderPlainText(writeup: Writeup): string | null {
  const rendered = renderWriteup(writeup, { mentionRoleIds: [], pollHours: null });
  if (!rendered) return null;
  const embed = rendered.message.embeds?.[0] as
    | (DiscordEmbed & { fields?: Array<{ name: string; value: string }> })
    | undefined;
  if (!embed) return null;

  const parts = [
    // The author line renders above the title in Discord, so the plain-text
    // preview shows it there too. A preview that reordered the message would
    // stop being a preview.
    embed.author?.name ? `### ${embed.author.name}` : null,
    `## ${embed.title ?? ""}`,
    "",
    embed.description ?? "",
    ...(embed.fields ?? []).flatMap((f) => ["", `**${f.name}**`, f.value]),
  ];
  if (embed.footer?.text) parts.push("", `_${embed.footer.text}_`);
  if (writeup.poll) {
    parts.push(
      "",
      `**Poll:** ${writeup.poll.question}`,
      ...writeup.poll.answers.map((a, i) => `  ${i + 1}. ${a}`),
    );
  }
  if (rendered.dropped.length > 0) {
    parts.push("", `_Dropped to fit Discord: ${rendered.dropped.join(", ")}_`);
  }
  return parts.join("\n");
}
