import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  getActiveFormats,
  getAvailableSources,
  sourceSupportsFormat,
  type ActiveFormatRow,
} from "@/lib/source";

type Client = SupabaseClient<Database>;

/**
 * What a board remembers about where it came from (plan decision 5): the
 * format it MEANS and the source its seed was read from.
 *
 * Both arrive from the browser, so both are checked against the registry
 * before anything is written. The format must be an active format_configs row;
 * the source, when given, must be an active source that publishes rankings AND
 * covers that format, because a seed "from KTC, Redraft Half PPR" never
 * happened and a board must not claim it did.
 */
export type BoardProvenance = {
  format: ActiveFormatRow;
  /** Null when the board was not seeded from a source (built by hand). */
  sourceSlug: string | null;
};

export async function resolveBoardProvenance(
  supabase: Client,
  formatSlug: unknown,
  sourceSlug: unknown,
): Promise<BoardProvenance | null> {
  if (typeof formatSlug !== "string" || formatSlug.length > 64) return null;
  const [formats, registry] = await Promise.all([
    getActiveFormats(supabase),
    getAvailableSources(supabase),
  ]);
  const format = formats.find((f) => f.slug === formatSlug);
  if (!format) return null;
  if (sourceSlug === null || sourceSlug === undefined || sourceSlug === "") {
    return { format, sourceSlug: null };
  }
  if (typeof sourceSlug !== "string") return null;
  const source = registry.find((s) => s.slug === sourceSlug);
  if (!source || !source.data_type.includes("rankings")) return null;
  if (!sourceSupportsFormat(source, format.slug)) return null;
  return { format, sourceSlug: source.slug };
}
