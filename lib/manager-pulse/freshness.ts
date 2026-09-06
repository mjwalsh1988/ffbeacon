/**
 * Manager Pulse's own freshness rule for a captured league-season.
 *
 * PURE MODULE. lib/sleeper.ts is not pure (currentNflSeason reads the clock
 * via `new Date()`), so this file never imports it. The caller computes the
 * current season once and passes it in, which keeps every function here a
 * plain function of its arguments and nothing else.
 */

import type { ManagerPulseSettings } from "./types";

export type LeagueCaptureState = {
  capture_completed_at: string | null;
  status: string | null;
  season: number | null;
};

/** Sleeper marks a finished league 'complete'; a past season is finished by definition. */
export function isSettledLeagueSeason(state: LeagueCaptureState, currentSeason: number): boolean {
  return state.status === "complete" || (state.season !== null && state.season < currentSeason);
}

/**
 * Manager Pulse's freshness rule, and nobody else's. League Pulse keeps its
 * own 60-minute TTL in pulseLeagueCore.
 *
 *   settled and complete       never
 *   settled and incomplete     yes
 *   unsettled and complete     when older than captureStaleAfterDays
 *   unsettled and incomplete   yes
 *   no row at all              yes
 */
export function managerPulseNeedsCapture(
  state: LeagueCaptureState | null | undefined,
  settings: ManagerPulseSettings,
  nowMs: number,
  currentSeason: number,
): boolean {
  if (!state || !state.capture_completed_at) return true;
  if (isSettledLeagueSeason(state, currentSeason)) return false;
  const ageMs = nowMs - Date.parse(state.capture_completed_at);
  return ageMs > settings.capture.captureStaleAfterDays * 86_400_000;
}
