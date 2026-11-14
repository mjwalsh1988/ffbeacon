/**
 * The current week when Sleeper's NFL state could not be read.
 *
 * resolveCurrentWeek (lib/league-matchups.ts) returns null when the state
 * request fails, and a failed request is not week 1. The pages then show what
 * is stored: the first week that has not settled is the one in play, and a
 * league whose every stored week is final is past its last one. Pure.
 */

import { MAX_MATCHUP_WEEK } from "@/lib/league-matchups";

export function currentWeekFromStored(
  stored: ReadonlyArray<{ week: number; isFinal: boolean }>,
): number {
  if (stored.length === 0) return 1;
  const sorted = [...stored].sort((a, b) => a.week - b.week);
  const open = sorted.find((w) => !w.isFinal);
  if (open) return open.week;
  return Math.min(MAX_MATCHUP_WEEK + 1, sorted[sorted.length - 1].week + 1);
}
