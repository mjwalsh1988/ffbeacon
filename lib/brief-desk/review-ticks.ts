/**
 * The owner's review ticks (cleared warnings, research rows read) are stored
 * as text lines in brief_editions.review_notes, each carrying this prefix, so
 * the column stays plain text and the rejection notes beside them are left
 * untouched. Pure; used by the review page and its server action.
 */

export const TICK_PREFIX = "[x] ";

export function parseReviewTicks(reviewNotes: string | null): string[] {
  return (reviewNotes ?? "")
    .split("\n")
    .filter((line) => line.startsWith(TICK_PREFIX))
    .map((line) => line.slice(TICK_PREFIX.length).trim())
    .filter(Boolean);
}

/** The lines that are not ticks: the owner's free text, kept as written. */
export function nonTickLines(reviewNotes: string | null): string[] {
  return (reviewNotes ?? "")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith(TICK_PREFIX));
}

export function mergeReviewTicks(reviewNotes: string | null, ticks: string[]): string | null {
  const tickLines = [...new Set(ticks.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))]
    .slice(0, 400)
    .map((t) => `${TICK_PREFIX}${t.slice(0, 500)}`);
  const next = [...nonTickLines(reviewNotes), ...tickLines].join("\n");
  return next || null;
}

/** The tick key for a warning and for a research row, so both sides agree. */
export const warningTick = (text: string) => `warning: ${text}`;
export const researchTick = (url: string) => `read: ${url}`;
