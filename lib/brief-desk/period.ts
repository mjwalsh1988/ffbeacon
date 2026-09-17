/**
 * The words for an edition's period: the chip, the eyebrow and the byline's
 * "Covers Sep 9 to Sep 15, 2026" line. One place, so the edition page, the
 * editions listing and the OG card cannot describe the same week three ways.
 *
 * Pure. Dates go through lib/datetime.ts, so they render in Eastern.
 */

import { formatEasternDate, formatEasternShortDate } from "@/lib/datetime";

/** "Sep 9 to Sep 15, 2026", or both dates in full when the year changes. */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const startFull = formatEasternDate(start);
  const endFull = formatEasternDate(end);
  const sameYear = startFull.slice(-4) === endFull.slice(-4);
  return `${sameYear ? formatEasternShortDate(start) : startFull} to ${endFull}`;
}

/**
 * The four phases a period can belong to, as `lib/brief-desk/cadence.ts`
 * assigns them and the drafts route writes them onto `articles.metadata`.
 */
export type EditionPhase = "pre" | "regular" | "post" | "off";

/** Whether a value read back from metadata is one of the four phases. */
export function isEditionPhase(value: unknown): value is EditionPhase {
  return value === "pre" || value === "regular" || value === "post" || value === "off";
}

/**
 * "Week 2" in season, "Pre-season" before it, "Off-season" otherwise.
 *
 * The phase argument is what separates the last two. Cadence counts a
 * pre-season period in weeks to kickoff rather than in season weeks, so it
 * stores `week: null` (the deviation recorded in plan section 22), and a
 * reader that looks only at the week column calls August the off-season.
 * Pre-season is weekly and dense, and it is not the off-season.
 *
 * The phase is optional because a row written before it was stored carries
 * none, and the week column alone is still the best answer for those.
 */
export function periodLabel(week: number | null | undefined, phase?: string | null): string {
  if (typeof week === "number") return `Week ${week}`;
  if (phase === "pre") return "Pre-season";
  return "Off-season";
}

/** "Week 2, 2026", "Pre-season, 2026" or "Off-season, 2026" for a chip. */
export function periodChipLabel(
  season: string | number | null | undefined,
  week: number | null | undefined,
  phase?: string | null,
): string {
  const label = periodLabel(week, phase);
  return season ? `${label}, ${season}` : label;
}

/** The two edition formats as one phrase: "Dynasty Superflex PPR and Redraft PPR (1QB)". */
export function formatsPhrase(formats: Array<{ display: string }>): string | null {
  const names = formats.map((f) => f.display.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
