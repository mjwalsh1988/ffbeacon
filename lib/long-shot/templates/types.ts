/**
 * The shape every Long Shot template family implements (plan 7.2, 20, 31.1).
 *
 * A family lists every parameterization it can run today (`draws`, in seeded
 * random order, capped), builds prompt text from one, and loads the answer
 * set (player ids) for it. generate.ts walks the list and keeps the first
 * draw whose typeable answer set falls inside the family's bounds, so a
 * family only fails when NO parameterization fits. The answer set is
 * intersected with the search pool and bounds-checked by generate.ts, never
 * by the family.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { TemplateKey, TemplateSource } from "../types";

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
  /** Oldest season a history family may ask about (settings.history.floor_season). */
  historyFloorSeason: number;
  /** False when history_players is empty, so every history family skips. */
  historyReady: boolean;
  /** `template_key:params` of every prompt in the last MEMORY_DAYS, skipped today. */
  recentKeys: ReadonlySet<string>;
  /**
   * The modern search pool (players with a stat line since 2020). A history
   * family answers with the players.id when the person is linked AND in this
   * pool, else with the history_players.id, matching what the search route
   * returns for the same person.
   */
  modernPool: ReadonlySet<string>;
}

export type TemplateParams = Record<string, string | number | boolean>;

export interface TemplateFamily {
  key: TemplateKey;
  enabledByDefault: boolean;
  source: TemplateSource;
  /** Every parameterization that can run today, seeded random order; [] when a skip rule holds. */
  draws(rng: () => number, ctx: GenerationContext): TemplateParams[];
  text(params: TemplateParams, ctx: GenerationContext): string;
  answers(admin: Client, params: TemplateParams, ctx: GenerationContext): Promise<string[]>;
  /** The position a draw asks about, or null; a day never asks one position twice. */
  position?(params: TemplateParams): string | null;
}
