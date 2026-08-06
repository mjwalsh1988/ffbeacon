/**
 * Fixtures for the Beacon Breakdown tests.
 *
 * `makeSide` builds a fully-formed MetricSide from a handful of overrides, so a
 * test can say "a 23-year-old worth 8000" without restating twenty null fields.
 * Everything defaults to null, which is the important part: a test that forgets
 * to supply a field gets "we have no data", not a convenient zero.
 */

import type { MetricSide, LeagueImpact } from "./metrics";
import type { BreakdownExtras, BreakdownPlayer } from "./types";

export const EMPTY_EXTRAS_FIXTURE: BreakdownExtras = {
  projection: null,
  reliability: null,
  market: null,
};

export type SideOverrides = {
  name?: string;
  position?: string;
  value?: number;
  overallRank?: number;
  positionRank?: number;
  tier?: number;
  age?: number;
  change30dPct?: number;
  trend30d?: "up" | "down" | "stable";
  depthRole?: string;
  injuryStatus?: string;
  /** Rest-of-season projected points. Builds a one-week projection bundle. */
  projectionPoints?: number;
  beatRate?: number;
  availabilityRate?: number;
  ratioStdev?: number;
  weeksPlayed?: number;
  /** League impact fields. Any of these present builds a LeagueImpact. */
  netPointsPerWeek?: number;
  weeksStarting?: number;
  playoffOddsAfter?: number;
};

export function makeSide(o: SideOverrides): MetricSide {
  const player: BreakdownPlayer = {
    slug: "test-player",
    id: "00000000-0000-0000-0000-000000000000",
    name: o.name ?? "Test Player",
    position: o.position ?? "WR",
    team: "DET",
    teamPrimary: null,
    sleeperId: "1234",
    age: o.age ?? null,
    ageDecimal: o.age ?? null,
    yearsExperience: null,
    injuryStatus: o.injuryStatus ?? null,
    value: o.value ?? null,
    overallRank: o.overallRank ?? null,
    positionRank: o.positionRank ?? null,
    tier: o.tier ?? null,
    change7d: null,
    change30d: o.change30dPct != null ? o.change30dPct * 10 : null,
    change30dPct: o.change30dPct ?? null,
    change90dPct: null,
    trend30d: o.trend30d ?? null,
    volatility30d: null,
    high30d: null,
    low30d: null,
    rankChange30d: null,
    latestFinish: null,
    recentFinishes: [],
    depthRole: o.depthRole ?? null,
    depthOrder: null,
  };

  const extras: BreakdownExtras = {
    projection:
      o.projectionPoints != null
        ? {
            season: 2026,
            fromWeek: 1,
            weeks: [
              {
                week: 1,
                points: o.projectionPoints / 10,
                rawPoints: o.projectionPoints / 10,
                sigma: o.projectionPoints / 40,
                opponent: "CHI",
                opponentMultiplier: 1,
              },
            ],
            totalPoints: o.projectionPoints,
            perGame: o.projectionPoints / 10,
            seasonSigma: o.projectionPoints / 10,
            floorPoints: o.projectionPoints * 0.9,
            ceilingPoints: o.projectionPoints * 1.1,
            nextWeek: {
              week: 1,
              points: o.projectionPoints / 10,
              rawPoints: o.projectionPoints / 10,
              sigma: o.projectionPoints / 40,
              opponent: "CHI",
              opponentMultiplier: 1,
            },
            scheduleMultiplier: 1,
            usedLeagueScoring: false,
          }
        : null,
    reliability:
      o.beatRate != null || o.availabilityRate != null || o.ratioStdev != null
        ? {
            beatRate: o.beatRate ?? null,
            availabilityRate: o.availabilityRate ?? null,
            meanDiff: null,
            ratioStdev: o.ratioStdev ?? null,
            shrunkMultiplier: null,
            weeksPlayed: o.weeksPlayed ?? 0,
            weeksProjected: o.weeksPlayed ?? 0,
            weeks: [],
            season: 2025,
          }
        : null,
    market: null,
  };

  const league: LeagueImpact | null =
    o.netPointsPerWeek != null || o.weeksStarting != null
      ? {
          netPointsPerWeek: o.netPointsPerWeek ?? 0,
          pointsPerStartedWeek: o.netPointsPerWeek ?? 0,
          weeksStarting: o.weeksStarting ?? 0,
          weeksConsidered: 14,
          isBenchOnly: (o.weeksStarting ?? 0) === 0,
          dropName: null,
          dropCostPerWeek: null,
          playoffOddsBefore: o.playoffOddsAfter != null ? 0.4 : null,
          playoffOddsAfter: o.playoffOddsAfter ?? null,
          titleOddsBefore: null,
          titleOddsAfter: null,
          expectedWinsAdded: null,
          onYourRoster: false,
          rosteredBy: null,
          weeks: [],
        }
      : null;

  return { player, extras, league };
}
