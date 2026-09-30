/**
 * Which source backs a read on a league's own format.
 *
 * League mode reads on the league's DERIVED format, not the header's, and the
 * reader chooses the source. The two can disagree: a reader on a source that
 * covers only redraft still connects a dynasty league. When they do, the
 * source falls through the same resolver every other surface uses
 * (`resolveSourceForFormat`), never a hardcoded board.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
  type ActiveFormatRow,
  type SourceRegistryRow,
} from "@/lib/source";

type SourceTable = "rankings" | "player_value_history";

/** Pure half: the source for a format id, given the registry and the formats. */
export function pickSourceForFormatId(
  registry: SourceRegistryRow[],
  formats: Pick<ActiveFormatRow, "id" | "slug">[],
  table: SourceTable,
  formatConfigId: string | null,
  requestedSource: string | null,
): string | null {
  if (!formatConfigId) return null;
  const slug = formats.find((f) => f.id === formatConfigId)?.slug;
  if (!slug) return null;
  return resolveSourceForFormat(registry, table, slug, requestedSource).source;
}

export async function resolveSourceForFormatId(
  supabase: SupabaseClient<Database>,
  table: SourceTable,
  formatConfigId: string | null,
  requestedSource: string | null,
): Promise<string | null> {
  if (!formatConfigId) return null;
  const [registry, formats] = await Promise.all([
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);
  return pickSourceForFormatId(registry, formats, table, formatConfigId, requestedSource);
}
