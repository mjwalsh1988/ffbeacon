/**
 * Derivation helpers for formats no external source covers (B5):
 *   - dynasty-ppr-tep: the dynasty 1QB base with a per-TE TE-premium boost.
 *   - best-ball presets: byte-for-byte inherit from the redraft/dynasty
 *     counterpart, flagged placeholder until manually diverged.
 *
 * The TE boost is stat-driven (not a flat bump): a TE who catches more passes
 * gains more from a per-reception premium. We compute it from the most recent
 * season in beacon_stat_profiles as (tePremium * receptions) / base season
 * points, scaled by an admin-tunable sensitivity and capped. Pure value mapping
 * stays in the orchestrator; this module only computes the per-TE boost.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { withRetry } from "../supabase/retry";
import { DEFAULT_SKILL_SCORING, scoreSkillLine } from "./scoring";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Per-TE proportional value boost for a TE-premium format. */
export async function gatherTeBoost(
  supabase: SupabaseClient<Database>,
  tePremium: number,
  sensitivity: number,
  cap: number,
  minBasePts: number,
): Promise<Map<string, number>> {
  const teIds = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id")
          .eq("position", "TE")
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `TE players page ${from}` },
    );
    for (const p of page) teIds.add(p.id);
    if (page.length < PAGE) break;
  }

  const boost = new Map<string, number>();
  if (tePremium <= 0) return boost;

  // Base scoring with the TE premium explicitly off, so base season points are
  // the no-premium baseline the boost is measured against.
  const baseScoring = { ...DEFAULT_SKILL_SCORING, te_premium: 0 };

  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("beacon_stat_profiles")
          .select("player_id, components, recency")
          .order("player_id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `TE profiles page ${from}` },
    );
    for (const prof of page) {
      if (!teIds.has(prof.player_id)) continue;
      const recency = (prof.recency as number[] | null) ?? [];
      if (recency.length === 0) continue;
      const components = (prof.components as Record<string, Record<string, number>>) ?? {};
      const line = components[String(recency[0])];
      if (!line) continue;
      const rec = line.rec ?? 0;
      const basePts = scoreSkillLine(line, baseScoring, "TE");
      if (basePts < minBasePts) continue;
      const b = clamp(((tePremium * rec) / basePts) * sensitivity, 0, cap);
      if (b > 0) boost.set(prof.player_id, b);
    }
    if (page.length < PAGE) break;
  }

  return boost;
}
