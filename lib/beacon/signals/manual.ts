/**
 * manual producer: load the owner's active one-time signals and resolve them to
 * engine overrides for a (player, format) or a (season, round, slot, format)
 * draft pick. Read ONLY here, so manual nudges can never leak into another
 * source's pipeline. Plan v3.1 section 7.
 *
 * silent=true => the change is excluded from trend math via formula_offset.
 * It is a player-only concept: draft_pick_values has no formula_offset and picks
 * feed no trend chips, so a pick signal ignores the flag.
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
  /** Pick coordinates. pickPosition null = every slot in that season and round. */
  pickSeason: number | null;
  pickRound: number | null;
  pickPosition: string | null;
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
      "id, target, player_id, pick_season, pick_round, pick_position, format_config_id, adjustment_type, magnitude, silent, decay_days, created_at, expires_at, is_active",
    )
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    target: r.target,
    playerId: r.player_id,
    pickSeason: r.pick_season,
    pickRound: r.pick_round,
    pickPosition: r.pick_position,
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

/** One published FF Beacon draft pick row, as the engine addresses it. */
export interface PickKey {
  season: number;
  round: number;
  /** 'early' | 'mid' | 'late'. */
  position: string;
  formatConfigId: string;
}

/**
 * Resolve the manual signals that apply to one draft pick. A signal matches when
 * its season and round match exactly, its slot matches or is null (null = every
 * slot), and its format matches or is null (null = every format the engine
 * publishes picks for). Decay behaves exactly as it does for players.
 *
 * silent is not carried through: picks have no trend chips to hide a change
 * from, so every pick override is reported as a plain adjustment.
 */
export function pickOverridesFor(
  signals: ManualSignalRow[],
  key: PickKey,
  nowMs: number,
): OverrideInput[] {
  const out: OverrideInput[] = [];
  for (const s of signals) {
    if (s.target !== "pick") continue;
    if (s.pickSeason !== key.season) continue;
    if (s.pickRound !== key.round) continue;
    if (s.pickPosition !== null && s.pickPosition !== key.position) continue;
    if (s.formatConfigId !== null && s.formatConfigId !== key.formatConfigId) continue;

    const decay = decayFactor(s, nowMs);
    if (s.adjustmentType === "set_value") {
      out.push({ type: "set_value", magnitude: s.magnitude, silent: false });
    } else if (s.adjustmentType === "delta") {
      out.push({ type: "delta", magnitude: s.magnitude * decay, silent: false });
    } else {
      const faded = 1 + (s.magnitude - 1) * decay;
      out.push({ type: "multiplier", magnitude: faded, silent: false });
    }
  }
  return out;
}

/**
 * Apply pick overrides to a base pick value. Pure, so the stacking order is
 * testable: the base already carries the global pick_value_multiplier, then
 * multipliers and deltas stack in the order they were created, and a set_value
 * short-circuits everything before it (the last one wins, matching combine()).
 * Picks have no value band, so the only guard is a non-negative whole number.
 */
export function applyPickOverrides(base: number, overrides: OverrideInput[]): number {
  let value = base;
  for (const o of overrides) {
    if (o.type === "set_value") value = o.magnitude;
    else if (o.type === "multiplier") value = value * o.magnitude;
    else value = value + o.magnitude;
  }
  return Math.max(0, Math.round(value));
}
