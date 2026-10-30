/**
 * Code defaults for the Team Blueprint.
 *
 * What the Blueprint runs on when league_blueprint_settings is missing, empty
 * or older than the schema. A missing row degrades to a working page, the same
 * contract Power Pulse and Would You Rather settings hold.
 *
 * Every number here is the plan's (docs/team-blueprint/team-blueprint-plan.md
 * section 13.1), including the owner's sell cutoffs from section 18.14: QB 33,
 * RB 28, WR 30, TE 30.
 *
 * `version` is the rebuild switch. Saving these settings rebuilds nothing on
 * its own; bumping `version` changes every stored blueprint's fingerprint, so
 * each one rebuilds on its next view.
 */

export type BlueprintPosition = "QB" | "RB" | "WR" | "TE";

export const BLUEPRINT_POSITIONS: readonly BlueprintPosition[] = ["QB", "RB", "WR", "TE"];

export interface LeagueBlueprintSettings {
  version: number;
  cache: { ttlHours: number };
  grades: {
    valueWeight: number;
    pointsWeight: number;
    overall: {
      qb: number;
      qbSuperflex: number;
      rb: number;
      wr: number;
      te: number;
      bench: number;
      picks: number;
    };
  };
  archetype: {
    topHeavyShare: number;
    deepShare: number;
    reloadAgeGap: number;
    reloadPicksGrade: number;
    contendHoldAgeGap: number;
    rebuildYoungShare: number;
    rebuildPicksGrade: number;
    youngAge: number;
  };
  calls: {
    ageCutoff: Record<BlueprintPosition, number>;
    needMinPoints: number;
    targetValueLow: number;
    targetValueHigh: number;
    targetsPerPosition: number;
    maxNeedPositions: number;
  };
  activity: {
    sellWeight: number;
    needWeight: number;
    divergenceWeight: number;
    lowBelow: number;
    highAbove: number;
  };
  movers: { window: "7d" | "30d"; limit: number; minGated: number };
  strategy: { maxRuns: number; pivotGapPct: number };
  partners: {
    needWeight: number;
    giveWeight: number;
    directionWeight: number;
    tendencyWeight: number;
    count: number;
  };
  priorities: { count: number };
}

export const DEFAULT_LEAGUE_BLUEPRINT_SETTINGS: LeagueBlueprintSettings = {
  version: 1,
  cache: { ttlHours: 12 },
  grades: {
    valueWeight: 0.5,
    pointsWeight: 0.5,
    overall: { qb: 1.0, qbSuperflex: 1.5, rb: 1.0, wr: 1.0, te: 0.75, bench: 0.5, picks: 0.5 },
  },
  archetype: {
    topHeavyShare: 0.8,
    deepShare: 0.62,
    reloadAgeGap: 0.5,
    reloadPicksGrade: 6,
    contendHoldAgeGap: -0.5,
    rebuildYoungShare: 0.5,
    rebuildPicksGrade: 7,
    youngAge: 25,
  },
  calls: {
    ageCutoff: { QB: 33, RB: 28, WR: 30, TE: 30 },
    needMinPoints: 1.0,
    targetValueLow: 0.6,
    targetValueHigh: 1.6,
    targetsPerPosition: 2,
    maxNeedPositions: 3,
  },
  activity: {
    sellWeight: 0.4,
    needWeight: 0.3,
    divergenceWeight: 0.3,
    lowBelow: 34,
    highAbove: 66,
  },
  movers: { window: "30d", limit: 3, minGated: 7 },
  strategy: { maxRuns: 3, pivotGapPct: 0.12 },
  partners: {
    needWeight: 0.4,
    giveWeight: 0.3,
    directionWeight: 0.2,
    tendencyWeight: 0.1,
    count: 2,
  },
  priorities: { count: 3 },
};
