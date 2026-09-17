/**
 * The admin override for the two desk routes (plan section 9.2): a past
 * in-season week (?season=2026&week=1) or an off-season close
 * (?season=2026&period_end=2026-07-16). Parsed tightly here so a route file
 * exports nothing but its handlers, and so the parsing is testable without a
 * request. Whether the caller may USE an override (an admin session beside
 * the token) is the route's decision, not this file's.
 */

import { easternParts } from "@/lib/relays/eastern-time";

export type BundleOverride = { season: string; week: number } | { season: string; periodEnd: string };

export type ParsedOverride = { ok: true; override: BundleOverride | null } | { ok: false; error: string };

/** The override query, validated tightly; anything malformed is an error, not a guess. */
export function parseOverride(params: URLSearchParams): ParsedOverride {
  const season = params.get("season");
  const week = params.get("week");
  const periodEnd = params.get("period_end");
  if (season === null && week === null && periodEnd === null) return { ok: true, override: null };
  if (season === null || !/^\d{4}$/.test(season)) return { ok: false, error: "season must be a four-digit year" };
  if (week !== null && periodEnd !== null) return { ok: false, error: "pass week or period_end, not both" };
  if (week !== null) {
    const n = Number(week);
    if (!/^\d{1,2}$/.test(week) || n < 1 || n > 22) return { ok: false, error: "week must be 1 to 22" };
    return { ok: true, override: { season, week: n } };
  }
  if (periodEnd !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return { ok: false, error: "period_end must be YYYY-MM-DD" };
    return { ok: true, override: { season, periodEnd } };
  }
  return { ok: false, error: "season needs a week or a period_end" };
}

/** The calendar date (Eastern) an ISO instant falls on, for the off-season override. */
export function easternDateOf(iso: string): string {
  const p = easternParts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The override a draft's own edition names, for an admin submitting a past period. */
export function overrideForEdition(edition: { season: string; week: number | null; period_end: string }): BundleOverride {
  if (edition.week !== null) return { season: edition.season, week: edition.week };
  return { season: edition.season, periodEnd: easternDateOf(edition.period_end) };
}
