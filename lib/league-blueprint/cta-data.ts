/**
 * The league overview's Team Blueprint call to action reads ONE stored row
 * (plan 20.1): the overall grade, the status label and when it was built. It
 * never builds a blueprint; with no row the card shows no number at all,
 * never a sample.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { BLUEPRINT_MODEL_VERSION, type BlueprintView } from "./types";

type Client = SupabaseClient<Database>;

export type BlueprintCtaFigure = { overall: number; statusLabel: string; generatedAt: string };

/**
 * Pure: the figure from a stored view's standing section, or null when it is
 * from an older model.
 */
export function ctaFigureFrom(
  row: { standing: unknown; model_version: number; generated_at: string } | null,
): BlueprintCtaFigure | null {
  if (!row || row.model_version !== BLUEPRINT_MODEL_VERSION) return null;
  const standing = row.standing as Partial<BlueprintView["standing"]> | null;
  const overall = standing?.overall;
  if (typeof overall !== "number") return null;
  return {
    overall,
    statusLabel: standing?.status?.label ?? standing?.rosterArchetype ?? "Blueprint ready",
    generatedAt: row.generated_at,
  };
}

export async function loadBlueprintCtaFigure(
  admin: Client,
  leagueRowId: string,
  rosterId: number,
  season: string,
  sourceSlug: string,
): Promise<BlueprintCtaFigure | null> {
  const { data, error } = await admin
    .from("league_blueprint_cache")
    // The standing section only: the whole view is 10 to 30 KB and this card
    // shows two of its fields on every overview load.
    .select("standing:view->standing, model_version, generated_at")
    .eq("league_id", leagueRowId)
    .eq("roster_id", rosterId)
    .eq("season", season)
    .eq("source", sourceSlug)
    .maybeSingle();
  if (error) return null;
  return ctaFigureFrom(data);
}
