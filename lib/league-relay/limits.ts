/**
 * Discord's size limits, and the only way this feature is allowed to meet them.
 *
 * THE RULE: NOTHING IS EVER TRUNCATED. A writeup cut mid-sentence is not a
 * shorter writeup, it is a different and worse one, and a reader cannot tell a
 * deliberate ending from a severed one. So a message that does not fit LOSES
 * WHOLE SECTIONS, lowest priority first, and every section that survives is
 * exactly what its author wrote.
 *
 * This is the same principle the Would You Rather poll text holds to
 * (lib/would-you-rather/poll-text.ts): condense losslessly, then drop a whole
 * unit, never slice one. The difference is that a poll answer has one hard cap
 * and this has four interacting ones, so the fitting is done by a composer
 * rather than by a ladder.
 *
 * THE LIMITS, from https://discord.com/developers/docs/resources/message and
 * .../resources/poll. Every one of them is a HARD REJECTION: Discord answers
 * 400 and the message never appears. There is no server-side truncation to fall
 * back on.
 */

/** Plain message content, above the embed. */
export const CONTENT_MAX = 2000;
/** One embed's description. The writeup lives here: it is twice content's room. */
export const EMBED_DESCRIPTION_MAX = 4096;
/** One embed's title. */
export const EMBED_TITLE_MAX = 256;
/** One embed's author name. Where the league name goes. */
export const EMBED_AUTHOR_MAX = 256;
/** One embed field's name and value. */
export const FIELD_NAME_MAX = 256;
export const FIELD_VALUE_MAX = 1024;
/** Fields per embed. */
export const FIELDS_MAX = 25;
/** One embed's footer text. */
export const FOOTER_MAX = 2048;
/**
 * Every character of every embed in one message, summed: title, description,
 * field names, field values, footer and author. Exceeding it rejects the whole
 * message even when each individual part is legal, which is the limit that
 * actually bites a long writeup.
 */
export const EMBED_TOTAL_MAX = 6000;

/** Poll question and answer caps. Both hard rejections. */
export const POLL_QUESTION_MAX = 300;
export const POLL_ANSWER_MAX = 55;

/**
 * How much of EMBED_TOTAL_MAX the composer will actually spend.
 *
 * A margin, not a mistake. Discord counts characters its own way (an emoji or a
 * combining mark can weigh more than one), so a build that lands on exactly
 * 6000 by our count is a build that sometimes lands on 6001 by theirs. Five per
 * cent back is cheap insurance against a 400 nobody sees until the channel is
 * quiet.
 */
export const SAFETY_MARGIN = 0.95;

/**
 * One piece of a writeup.
 *
 * `priority` is what survives a squeeze: LOWER GOES FIRST. Priority 0 is the
 * part without which the message would be pointless (what actually happened),
 * and the composer refuses to build at all rather than drop one of those.
 */
export interface Section {
  /** Stable key, so a test can assert on what was dropped. */
  key: string;
  /** The text, complete. Never sliced. */
  text: string;
  /** 0 is essential and never dropped. Higher numbers are dropped sooner. */
  priority: number;
}

export interface ComposeResult {
  /** The sections that fit, in the order given. */
  body: string;
  /** Keys dropped to make it fit. Empty in the ordinary case. */
  dropped: string[];
}

/** Blank line between sections, as Discord renders paragraphs. */
const JOIN = "\n\n";

/**
 * Fit a list of sections into a character budget by dropping whole sections.
 *
 * Sections keep their given ORDER in the output; priority only decides what
 * leaves. So a low-priority tail section can be dropped without disturbing
 * anything above it, and a high-priority section stays where its author put it.
 *
 * Returns null when the essential sections (priority 0) alone do not fit. That
 * is the caller's signal to post nothing rather than to post something wrong,
 * and it is deliberately not a truncation.
 */
export function compose(sections: Section[], budget: number): ComposeResult | null {
  const present = sections.filter((s) => s.text.trim().length > 0);

  const measure = (list: Section[]): number =>
    list.reduce((sum, s, i) => sum + s.text.length + (i > 0 ? JOIN.length : 0), 0);

  const keep = [...present];
  const dropped: string[] = [];

  while (measure(keep) > budget) {
    // The most expendable survivor: highest priority, and among equals the one
    // furthest down the message, so a squeeze eats the tail rather than a hole
    // in the middle.
    let worstIndex = -1;
    for (let i = 0; i < keep.length; i += 1) {
      if (keep[i].priority === 0) continue;
      if (worstIndex === -1 || keep[i].priority >= keep[worstIndex].priority) worstIndex = i;
    }
    // Only essentials left and they still overflow. Nothing legal can be built.
    if (worstIndex === -1) return null;
    dropped.push(keep[worstIndex].key);
    keep.splice(worstIndex, 1);
  }

  return { body: keep.map((s) => s.text).join(JOIN), dropped };
}

/**
 * Characters an embed of this shape will cost against EMBED_TOTAL_MAX.
 *
 * Counted the way Discord counts it: every visible string in the embed, summed.
 */
export function embedCost(parts: {
  title?: string;
  description?: string;
  footer?: string;
  author?: string;
  fields?: Array<{ name: string; value: string }>;
}): number {
  let n = 0;
  n += parts.title?.length ?? 0;
  n += parts.description?.length ?? 0;
  n += parts.footer?.length ?? 0;
  n += parts.author?.length ?? 0;
  for (const f of parts.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

/**
 * Is every individual cap respected?
 *
 * The composer handles the description budget; this is the belt-and-braces pass
 * run immediately before the send, so a bug in a builder shows up here as a
 * refusal rather than at Discord as a 400.
 */
export function withinLimits(parts: {
  content?: string;
  title?: string;
  author?: string;
  description?: string;
  footer?: string;
  fields?: Array<{ name: string; value: string }>;
  pollQuestion?: string;
  pollAnswers?: string[];
}): { ok: true } | { ok: false; reason: string } {
  if ((parts.content?.length ?? 0) > CONTENT_MAX) {
    return { ok: false, reason: `content is ${parts.content?.length} of ${CONTENT_MAX}` };
  }
  if ((parts.title?.length ?? 0) > EMBED_TITLE_MAX) {
    return { ok: false, reason: `title is ${parts.title?.length} of ${EMBED_TITLE_MAX}` };
  }
  if ((parts.author?.length ?? 0) > EMBED_AUTHOR_MAX) {
    return { ok: false, reason: `author is ${parts.author?.length} of ${EMBED_AUTHOR_MAX}` };
  }
  if ((parts.description?.length ?? 0) > EMBED_DESCRIPTION_MAX) {
    return {
      ok: false,
      reason: `description is ${parts.description?.length} of ${EMBED_DESCRIPTION_MAX}`,
    };
  }
  if ((parts.footer?.length ?? 0) > FOOTER_MAX) {
    return { ok: false, reason: `footer is ${parts.footer?.length} of ${FOOTER_MAX}` };
  }
  const fields = parts.fields ?? [];
  if (fields.length > FIELDS_MAX) {
    return { ok: false, reason: `${fields.length} fields, of ${FIELDS_MAX}` };
  }
  for (const f of fields) {
    if (f.name.length > FIELD_NAME_MAX) {
      return { ok: false, reason: `field name "${f.name.slice(0, 20)}" is too long` };
    }
    if (f.value.length > FIELD_VALUE_MAX) {
      return { ok: false, reason: `field "${f.name}" is ${f.value.length} of ${FIELD_VALUE_MAX}` };
    }
  }
  const total = embedCost({
    title: parts.title,
    author: parts.author,
    description: parts.description,
    footer: parts.footer,
    fields,
  });
  if (total > EMBED_TOTAL_MAX) {
    return { ok: false, reason: `embed totals ${total} of ${EMBED_TOTAL_MAX}` };
  }
  if ((parts.pollQuestion?.length ?? 0) > POLL_QUESTION_MAX) {
    return {
      ok: false,
      reason: `poll question is ${parts.pollQuestion?.length} of ${POLL_QUESTION_MAX}`,
    };
  }
  for (const a of parts.pollAnswers ?? []) {
    if (a.length > POLL_ANSWER_MAX) {
      return { ok: false, reason: `poll answer "${a.slice(0, 20)}" is ${a.length} of ${POLL_ANSWER_MAX}` };
    }
  }
  return { ok: true };
}

/**
 * Shorten a team name for a poll answer WITHOUT cutting a word in half.
 *
 * A poll answer is 55 characters and a team name can be anything a manager
 * typed. Dropping trailing whole words leaves something a reader recognises;
 * slicing mid-word leaves "The Fighting Mongoo". When even the first word does
 * not fit, the answer is refused by the caller rather than mangled here.
 */
export function fitPollAnswer(name: string, max: number = POLL_ANSWER_MAX): string | null {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return null;
  if (clean.length <= max) return clean;

  const words = clean.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max) break;
    out = next;
  }
  return out.length > 0 ? out : null;
}
