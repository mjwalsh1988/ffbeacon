/**
 * The shape every Long Shot template family implements (plan 7.2 and 20).
 *
 * A family draws parameters from the seeded PRNG, builds prompt text from
 * them, and loads the answer set (player ids) for them. The answer set is
 * intersected with the search pool and bounds-checked by generate.ts, never
 * by the family.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { TemplateKey } from "../types";

export type Client = SupabaseClient<Database>;

export interface FormatRow {
  id: string;
  slug: string;
  display_name: string;
}

export interface GenerationContext {
  /** The current NFL season as a number. */
  season: number;
  /** STATS_FLOOR_SEASON through the current season, inclusive. */
  seasons: number[];
  /** The most recent completed week of the current season, or null. */
  completedWeek: number | null;
  /** The site default value source, or null when none is configured. */
  defaultSource: { slug: string; display: string } | null;
  /** The default source's supported_format_slugs; null means every format. */
  defaultSourceFormats: string[] | null;
  formats: FormatRow[];
  /** The roster-rate season tiering uses, or null when none qualifies. */
  rateSeason: number | null;
  /** The generation instant, for windowed families. */
  now: Date;
}

export type TemplateParams = Record<string, string | number | boolean>;

export interface TemplateFamily {
  key: TemplateKey;
  enabledByDefault: boolean;
  /** A parameter draw, or null when the family cannot run today (a skip rule). */
  draw(rng: () => number, ctx: GenerationContext): TemplateParams | null;
  text(params: TemplateParams, ctx: GenerationContext): string;
  answers(admin: Client, params: TemplateParams, ctx: GenerationContext): Promise<string[]>;
}
