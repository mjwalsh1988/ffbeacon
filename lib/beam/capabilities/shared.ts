/**
 * Shapes and helpers every capability needs.
 *
 * A capability never receives a name to look up. By the time params reach run(),
 * the resolver has already turned whatever the reader typed into a player id, a
 * slug, and a display name, and those three travel together so a presenter can
 * write a sentence and a link without another query.
 */

import { z } from "zod";
import type { BeamSeasonClock } from "@/lib/beam/types";

export const playerRefSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  position: z.string().max(8).nullable(),
  team: z.string().max(8).nullable(),
});

export type PlayerRef = z.infer<typeof playerRefSchema>;

/**
 * How the season in a question was arrived at. The presenter needs this to
 * decide whether to explain itself: naming 2024 when the reader said 2024 is
 * noise, and naming 2025 when they said "this year" is the whole point.
 */
export const seasonSourceSchema = z.enum(["explicit", "relative", "current", "none"]);
export type SeasonSource = z.infer<typeof seasonSourceSchema>;

export const seasonSchema = z.object({
  season: z.number().int().min(1960).max(2100),
  source: seasonSourceSchema,
});

export type SeasonParam = z.infer<typeof seasonSchema>;

/**
 * An inclusive stretch of weeks inside one season. Bounded to the 18-week
 * regular season, so a question about "week 30" is rejected by the schema rather
 * than answered with an empty total.
 */
export const weekRangeSchema = z.object({
  start: z.number().int().min(1).max(18),
  end: z.number().int().min(1).max(18),
});

export type WeekRangeParam = z.infer<typeof weekRangeSchema>;

/**
 * Which seasons a multi-season question covers.
 *
 * "career" reads the all-seasons aggregate we already store; a list is the
 * seasons the reader asked for, resolved against the clock before it ever
 * reaches a capability. The label travels with it so the answer can say what was
 * asked for even when we hold less than that.
 */
export const seasonWindowSchema = z.union([
  z.object({ kind: z.literal("career") }),
  z.object({
    kind: z.literal("seasons"),
    seasons: z.array(z.number().int().min(1960).max(2100)).min(1).max(10),
    label: z.string().min(1).max(60),
  }),
]);

export type SeasonWindowParam = z.infer<typeof seasonWindowSchema>;

/** How the reader described the window, for the answer to echo back. */
export function windowLabel(window: SeasonWindowParam): string {
  return window.kind === "career" ? "every season we grade" : window.label;
}

/**
 * How an answer names the stretch it covered: "2025", or "weeks 2 to 8 of 2025".
 *
 * Every sentence template takes this string rather than a season number, so a
 * week-range answer can never read as if it covered the whole year. That was the
 * failure mode worth designing out: a total that is right for five weeks and
 * presented as a season is a wrong answer with a correct number in it.
 */
export function periodLabel(season: number, weeks: WeekRangeParam | null): string {
  if (!weeks) return String(season);
  if (weeks.start === weeks.end) return `week ${weeks.start} of ${season}`;
  return `weeks ${weeks.start} to ${weeks.end} of ${season}`;
}

/** Wrap a zod parse in the capability contract's result shape. */
export function parseWith<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): { ok: true; params: T } | { ok: false; error: string } {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.join(".") || "params";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true, params: result.data };
}

/** Player profile link, the one every answer offers. */
export function playerLink(player: PlayerRef) {
  return { href: `/players/${player.slug}`, label: `${player.name} profile` };
}

/**
 * True when the season asked about is one we could not possibly hold. Callers
 * turn this into a clean "our history starts in 2020" rather than an empty
 * answer that reads like the player did nothing.
 */
export function seasonOutOfRange(season: number, clock: BeamSeasonClock): boolean {
  return season < clock.earliestStatSeason || season > clock.latestStatSeason;
}

/** The sentence for a season we do not hold. */
export function outOfRangeCaveat(season: number, clock: BeamSeasonClock): string {
  if (season < clock.earliestStatSeason) {
    return `Our game logs start in ${clock.earliestStatSeason}, so we have nothing for ${season}.`;
  }
  return `The ${season} season has not produced any games we hold yet.`;
}
