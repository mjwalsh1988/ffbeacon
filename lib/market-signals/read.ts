/**
 * Market Signals reads (plan section 12.1). Public tables, so any client may
 * read them; every read names one (format, source), and each is wrapped in
 * React cache() so a render reads each answer once.
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatEasternDate } from "@/lib/datetime";
import type { SignalState } from "./bollinger";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type PlayerValueSignalRow = {
  playerId: string;
  asOfDay: string;
  marketValue: number;
  upper: number | null;
  lower: number | null;
  bandPct: number | null;
  pointsInWindow: number;
  signal: SignalState;
  signalSince: string | null;
  computedAt: string;
};

export type PlayerValueSignalChange = {
  changedOn: string;
  fromSignal: SignalState | null;
  toSignal: SignalState;
  marketValue: number;
  bandPct: number | null;
};

const SIGNAL_COLUMNS =
  "player_id, as_of_day, market_value, band_upper, band_lower, band_pct, points_in_window, signal, signal_since, computed_at";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type RawSignal = {
  player_id: string;
  as_of_day: string;
  market_value: number;
  band_upper: number | null;
  band_lower: number | null;
  band_pct: number | null;
  points_in_window: number;
  signal: string;
  signal_since: string | null;
  computed_at: string;
};

/**
 * The nightly job leaves a row alone when the player's series goes stale or
 * drops out of the lookback (plan 5.1), so a player a source stopped pricing
 * would keep his last call forever. A row older than staleDays is no signal:
 * every reader passes staleDays and gets null rather than a call about a
 * market that is no longer moving.
 */
export function isSignalCurrent(asOfDay: string, staleDays: number, now: Date = new Date()): boolean {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - staleDays * 86_400_000);
  return asOfDay >= cutoff.toISOString().slice(0, 10);
}

function toRow(r: RawSignal): PlayerValueSignalRow {
  return {
    playerId: r.player_id,
    asOfDay: r.as_of_day,
    marketValue: Number(r.market_value),
    upper: num(r.band_upper),
    lower: num(r.band_lower),
    bandPct: num(r.band_pct),
    pointsInWindow: r.points_in_window,
    signal: r.signal as SignalState,
    signalSince: r.signal_since,
    computedAt: r.computed_at,
  };
}

export const loadPlayerSignal = cache(
  async (
    supabase: AnySupabase,
    playerId: string,
    formatConfigId: string,
    source: string,
    staleDays: number,
  ): Promise<PlayerValueSignalRow | null> => {
    const { data, error } = await supabase
      .from("player_value_signals")
      .select(SIGNAL_COLUMNS)
      .eq("player_id", playerId)
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as RawSignal;
    return isSignalCurrent(row.as_of_day, staleDays) ? toRow(row) : null;
  },
);

/** Signals for many players, 200 ids per in() so no request exceeds the row cap. */
export async function loadSignalsFor(
  supabase: AnySupabase,
  playerIds: readonly string[],
  formatConfigId: string,
  source: string,
  staleDays: number,
): Promise<Map<string, PlayerValueSignalRow>> {
  const out = new Map<string, PlayerValueSignalRow>();
  const ids = [...new Set(playerIds)];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("player_value_signals")
      .select(SIGNAL_COLUMNS)
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .in("player_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`player_value_signals: ${error.message}`);
    for (const r of (data ?? []) as RawSignal[]) {
      if (isSignalCurrent(r.as_of_day, staleDays)) out.set(r.player_id, toRow(r));
    }
  }
  return out;
}

export const loadSignalChanges = cache(
  async (
    supabase: AnySupabase,
    playerId: string,
    formatConfigId: string,
    source: string,
    limit = 12,
  ): Promise<PlayerValueSignalChange[]> => {
    const { data, error } = await supabase
      .from("player_value_signal_changes")
      .select("changed_on, from_signal, to_signal, market_value, band_pct")
      .eq("player_id", playerId)
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .order("changed_on", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({
      changedOn: r.changed_on,
      fromSignal: (r.from_signal as SignalState | null) ?? null,
      toSignal: r.to_signal as SignalState,
      marketValue: Number(r.market_value),
      bandPct: num(r.band_pct),
    }));
  },
);

/** Newest computed_at for a (format, source), for the blueprint fingerprint. */
export async function latestSignalComputedAt(
  supabase: AnySupabase,
  formatConfigId: string,
  source: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("player_value_signals")
    .select("computed_at")
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .order("computed_at", { ascending: false })
    .limit(1);
  return data?.[0]?.computed_at ?? null;
}

/**
 * A signal day ("YYYY-MM-DD", a UTC calendar day) as an Eastern date. Read at
 * UTC noon: midnight UTC is the previous evening in New York, which would print
 * every day one day early.
 */
export function formatSignalDay(day: string | null | undefined): string {
  return formatEasternDate(day ? `${day}T12:00:00Z` : null);
}
