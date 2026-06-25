/**
 * Shared test helpers for the Signal Check engine suites. Not a test file
 * (no .test suffix) so Vitest does not execute it directly. Pure, no DB.
 */

import { DEFAULT_SETTINGS } from "./settings";
import type { ResolvedFormat, ResolvedSource, SignalCheckSettings, PickPosition } from "./types";
import type { ResolvedPlayerValue, ResolvedPickValue, ValueResolver } from "./value-engine";

export const DYNASTY_FORMAT: ResolvedFormat = {
  slug: "dynasty-ppr-sflex",
  display: "Dynasty PPR SF",
  configId: "00000000-0000-0000-0000-0000000000d1",
  leagueType: "dynasty",
  allowsPicks: true,
};

export const REDRAFT_FORMAT: ResolvedFormat = {
  slug: "redraft-ppr-std",
  display: "Redraft PPR",
  configId: "00000000-0000-0000-0000-0000000000r1",
  leagueType: "redraft",
  allowsPicks: false,
};

export const SOURCE: ResolvedSource = {
  slug: "ffbeacon",
  display: "FF Beacon",
  pickSlug: "ffbeacon",
  pickDisplay: "FF Beacon",
};

export function settingsWith(overrides: Partial<SignalCheckSettings> = {}): SignalCheckSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    shapeLabels: { ...DEFAULT_SETTINGS.shapeLabels, ...(overrides.shapeLabels ?? {}) },
    confidenceLabels: { ...DEFAULT_SETTINGS.confidenceLabels, ...(overrides.confidenceLabels ?? {}) },
  };
}

export interface FakePlayer {
  name: string;
  position: string | null;
  team: string | null;
  value: number | null;
  capturedAt?: string | null;
}

/**
 * Build a deterministic ValueResolver from in-memory players and pick values.
 * players: keyed by playerId. picks: keyed by "season|round|pos" with a generic
 * "season|round" fallback computed as the average of provided buckets.
 */
export function fakeResolver(
  players: Record<string, FakePlayer>,
  picks: Record<string, number> = {},
): ValueResolver {
  const generic = new Map<string, { sum: number; count: number }>();
  for (const [key, val] of Object.entries(picks)) {
    const [season, round] = key.split("|");
    const gkey = `${season}|${round}`;
    const g = generic.get(gkey);
    if (g) {
      g.sum += val;
      g.count += 1;
    } else {
      generic.set(gkey, { sum: val, count: 1 });
    }
  }
  return {
    player(playerId: string): ResolvedPlayerValue | null {
      const p = players[playerId];
      if (!p) return null;
      return {
        name: p.name,
        position: p.position,
        team: p.team,
        value: p.value,
        capturedAt: p.capturedAt ?? "2026-06-01T00:00:00.000Z",
      };
    },
    pick(season: number, round: number, pos: PickPosition | "unknown"): ResolvedPickValue {
      if (pos !== "unknown") {
        const hit = picks[`${season}|${round}|${pos}`];
        if (hit !== undefined) return { value: hit, capturedAt: "2026-06-01T00:00:00.000Z" };
      }
      const g = generic.get(`${season}|${round}`);
      if (g) return { value: g.sum / g.count, capturedAt: "2026-06-01T00:00:00.000Z" };
      return { value: null, capturedAt: null };
    },
  };
}
