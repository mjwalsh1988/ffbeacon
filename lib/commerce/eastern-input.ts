/**
 * `datetime-local` inputs in the admin forms read and write Eastern time, because
 * every timestamp on this site is Eastern whatever the device's zone. A browser's
 * own conversion would use the device's, so the arithmetic is here. Pure, and safe
 * in a client component.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function easternParts(date: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of PARTS.formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  // Some runtimes print midnight as 24 under hour12: false.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** How far Eastern is behind UTC at this instant, in milliseconds. */
function offsetAt(ms: number): number {
  const p = easternParts(new Date(ms));
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return ms - (ms % 1000) - asIfUtc;
}

/** "2026-11-01T14:30" in Eastern to an ISO instant, or null when it is not one. */
export function easternLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  // Twice, because the first offset is read at a moment up to five hours off,
  // which can sit on the other side of a daylight saving change.
  const first = guess + offsetAt(guess);
  return new Date(guess + offsetAt(first)).toISOString();
}

/** An instant as the value a `datetime-local` input wants, in Eastern. */
export function isoToEasternLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = easternParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
