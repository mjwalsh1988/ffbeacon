/**
 * manual producer: load the owner's active one-time signals and resolve them to
 * engine overrides for a (player, format). Read ONLY here, so manual nudges can
 * never leak into another source's pipeline. Plan v3.1 section 7.
 *
 * silent=true => the change is excluded from trend math via formula_offset.
 * decay_days linearly fades a multiplier/delta over its window; set_value does
 * not decay (it is an absolute target).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import type { OverrideInput } from "../engine";

export interface ManualSignalRow {
  id: string;
  target: string;
  playerId: string | null;
  formatConfigId: string | null;
  adjustmentType: "multiplier" | "delta" | "set_value";
  magnitude: number;
  silent: boolean;
  decayDays: number | null;
  createdAtMs: number;
}

export async function loadManualSignals(
  supabase: SupabaseClient<Database>,
  nowMs: number,
): Promise<ManualSignalRow[]> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await supabase
    .from("beacon_manual_signals")
    .select(
      "id, target, player_id, format_config_id, adjustment_type, magnitude, silent, decay_days, created_at, expires_at, is_active",
    )
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    target: r.target,
    playerId: r.player_id,
    formatConfigId: r.format_config_id,
    adjustmentType: r.adjustment_type as ManualSignalRow["adjustmentType"],
    magnitude: Number(r.magnitude),
    silent: r.silent,
    decayDays: r.decay_days,
    createdAtMs: new Date(r.created_at).getTime(),
  }));
}

/** Linear decay factor in [0,1] over the signal's window (1 if no decay). */
export function decayFactor(signal: ManualSignalRow, nowMs: number): number {
  if (!signal.decayDays || signal.decayDays <= 0) return 1;
  const ageDays = (nowMs - signal.createdAtMs) / (24 * 60 * 60 * 1000);
  return Math.min(1, Math.max(0, 1 - ageDays / signal.decayDays));
}

/** Resolve the player+format applicable manual signals into engine overrides. */
export function overridesFor(
  signals: ManualSignalRow[],
  playerId: string,
  formatConfigId: string,
  nowMs: number,
): OverrideInput[] {
  const out: OverrideInput[] = [];
  for (const s of signals) {
    if (s.target !== "player") continue;
    if (s.playerId !== playerId) continue;
    if (s.formatConfigId !== null && s.formatConfigId !== formatConfigId) continue;

    const decay = decayFactor(s, nowMs);
    if (s.adjustmentType === "set_value") {
      out.push({ type: "set_value", magnitude: s.magnitude, silent: s.silent });
    } else if (s.adjustmentType === "delta") {
      out.push({ type: "delta", magnitude: s.magnitude * decay, silent: s.silent });
    } else {
      // multiplier: fade toward 1.0 as it decays
      const faded = 1 + (s.magnitude - 1) * decay;
      out.push({ type: "multiplier", magnitude: faded, silent: s.silent });
    }
  }
  return out;
}
