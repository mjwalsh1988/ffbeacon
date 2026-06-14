/**
 * stat_performance producer (B4): a small, bounded recent-form ADJUSTMENT for
 * skill players that already have a market base from source_value. Reads the
 * materialized beacon_stat_profiles and compares the latest season's per-game
 * production to the prior season's (year-over-year trajectory), producing a
 * capped adjustmentPct the engine folds into the bounded factor.
 *
 * Conservative by design: the market base already prices in most of this, so the
 * nudge is small (default cap +/-10%), damped by sample size, and neutral (no
 * entry) whenever there is no usable prior-season baseline.
 *
 * All knobs live in beacon_signal_weights.params for the stat_performance row
 * (admin-tunable). DEFAULT_PERF is the fallback used only when a key is absent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { withRetry } from "../../supabase/retry";
import { DEFAULT_SKILL_SCORING, scoreSkillLine, type SkillScoringConfig } from "../scoring";

const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export interface PerfConfig {
  sensitivity: number;
  cap: number;
  minBaselinePpg: number;
  fullGames: number;
  scoring: SkillScoringConfig;
}

export const DEFAULT_PERF: PerfConfig = {
  sensitivity: 0.5,
  cap: 0.1,
  minBaselinePpg: 5,
  fullGames: 14,
  scoring: DEFAULT_SKILL_SCORING,
};

export function mergePerfConfig(params: unknown): PerfConfig {
  const p = (params ?? {}) as Partial<{
    sensitivity: number;
    cap: number;
    min_baseline_ppg: number;
    full_games: number;
    scoring: Partial<SkillScoringConfig>;
  }>;
  return {
    sensitivity: typeof p.sensitivity === "number" ? p.sensitivity : DEFAULT_PERF.sensitivity,
    cap: typeof p.cap === "number" ? p.cap : DEFAULT_PERF.cap,
    minBaselinePpg:
      typeof p.min_baseline_ppg === "number" ? p.min_baseline_ppg : DEFAULT_PERF.minBaselinePpg,
    fullGames: typeof p.full_games === "number" ? p.full_games : DEFAULT_PERF.fullGames,
    scoring: { ...DEFAULT_SKILL_SCORING, ...(p.scoring ?? {}) },
  };
}

export interface PerfAdjustment {
  adjustmentPct: number;
  confidence: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export async function gatherStatPerformance(
  supabase: SupabaseClient<Database>,
  config: PerfConfig,
): Promise<Map<string, PerfAdjustment>> {
  // skill positions only
  const positionByPlayer = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, position")
          .in("position", Array.from(SKILL_POSITIONS))
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `perf players page ${from}` },
    );
    for (const p of page) positionByPlayer.set(p.id, p.position);
    if (page.length < PAGE) break;
  }

  const out = new Map<string, PerfAdjustment>();
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
      { label: `perf profiles page ${from}` },
    );
    for (const prof of page) {
      const position = positionByPlayer.get(prof.player_id);
      if (!position) continue; // not a skill player
      const recency = (prof.recency as number[] | null) ?? [];
      if (recency.length < 2) continue; // need a prior-season baseline
      const components = (prof.components as Record<string, Record<string, number>>) ?? {};
      const recentLine = components[String(recency[0])];
      const priorLine = components[String(recency[1])];
      if (!recentLine || !priorLine) continue;

      const recentGames = recentLine.games ?? 0;
      const priorGames = priorLine.games ?? 0;
      if (recentGames <= 0 || priorGames <= 0) continue;

      const recentPpg = scoreSkillLine(recentLine, config.scoring, position) / recentGames;
      const priorPpg = scoreSkillLine(priorLine, config.scoring, position) / priorGames;
      if (priorPpg < config.minBaselinePpg) continue; // baseline too small to trust the ratio

      const traj = (recentPpg - priorPpg) / priorPpg;
      const adjustmentPct = clamp(traj * config.sensitivity, -config.cap, config.cap);
      const confidence = clamp(Math.min(recentGames, priorGames) / config.fullGames, 0, 1);
      out.set(prof.player_id, { adjustmentPct, confidence });
    }
    if (page.length < PAGE) break;
  }

  return out;
}
