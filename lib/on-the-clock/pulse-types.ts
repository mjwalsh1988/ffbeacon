/**
 * The wire shape of the Draft Pulse payload.
 *
 * Split out of pulse-service.ts because that module is server-only (it reads
 * Supabase and memoizes an NFL-state fetch), and the client needs these types to
 * render what it receives. Types only: nothing here computes anything.
 */

import type { DraftPulseTeam } from "./draft-pulse";
import type { MarginalOutput } from "./marginal";

/** Compact per-player summary for board enrichment. Keys are short on purpose:
 * this map carries every projectable player and travels on every pulse call. */
export interface PulsePlayerSummary {
  /** Projected points per remaining week, in the league's own scoring. */
  ppw: number;
  /** Projected points across the remaining slate. */
  sp: number;
  /** Beat rate, 0 to 1. Null when there is no history. */
  br: number | null;
  /** Availability rate, 0 to 1. Null when there is no history. */
  av: number | null;
  /** Reliability multiplier applied. */
  rl: number;
  /** Weeks of history behind br and av, for the minimum-sample gates. */
  wp: number;
  /** Spread of actual over projected. Null when unmeasured. */
  cv: number | null;
}

export interface PulseMarginalPayload extends MarginalOutput {
  rosterId: number;
  /** Overall pick number of the roster's next pick, or null. */
  nextPickNo: number | null;
  /** How many selections happen before it. Null when the next pick is unknown. */
  picksUntilNext: number | null;
  /** How many candidates were priced, and how many were asked for. */
  priced: number;
  requested: number;
}

export interface PulsePayload {
  version: string;
  season: number;
  fromWeek: number;
  weeks: number[];
  slots: string[];
  /** True when roster_positions were unavailable and the slots were inferred. */
  slotsEstimated: boolean;
  /** True when the league's scoring settings were never captured. */
  scoringEstimated: boolean;
  teams: DraftPulseTeam[];
  /**
   * Every projectable player's summary. Roughly 43 KB, and identical for the
   * whole draft: it keys on the projection board, which depends on scoring,
   * season, and week window, none of which move mid-draft.
   *
   * OMITTED (null) when the caller sent a `boardEtag` matching `boardEtag`
   * below, which means it already holds this exact map. A caller that gets null
   * must keep the map it has rather than treating it as "no projections".
   */
  players: Record<string, PulsePlayerSummary> | null;
  /**
   * Fingerprint of the projection board the `players` map came from. Send it
   * back on the next request to skip re-downloading an identical map.
   */
  boardEtag: string;
  marginal: PulseMarginalPayload | null;
  coverage: { projectedPlayers: number };
}
