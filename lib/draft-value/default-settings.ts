/**
 * Beacon Steals model defaults.
 *
 * Every weight, threshold, and assumption the engine reads lives here and is
 * overridable from draft_value_settings without a deploy. A missing settings row
 * degrades to exactly this object, so the feature works on a fresh database.
 *
 * Bump `modelVersion` whenever a change alters what a score MEANS, so stale rows
 * are identifiable and the next rebuild rescores everything.
 */

import type { ScoringSettings } from "@/lib/league-scoring";

/** The positions Beacon Steals ranks. IDP is out of scope; we rank no IDP players. */
export const STEAL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type StealPosition = (typeof STEAL_POSITIONS)[number];

export type DraftValueSettings = {
  modelVersion: string;

  /**
   * The league a format is scored AS. Format slugs carry scoring and superflex
   * but not roster size, so the shape comes from here.
   */
  leagueShape: {
    teams: number;
    /** Dedicated starting slots, before flex. */
    starters: Record<StealPosition, number>;
    /** Flex slots (RB/WR/TE eligible). */
    flex: number;
    /** A superflex slug adds one more starting quarterback. */
    superflexAddsQb: boolean;
    /**
     * How flex demand splits across the eligible positions. Tight ends win a
     * flex slot far less often than they are eligible for one, and giving TE a
     * full share would push its replacement level down to a level nobody drafts
     * for.
     */
    flexShare: { RB: number; WR: number; TE: number };
  };

  /**
   * How the value ladder and the points ladder combine into beacon_pick.
   * Redraft leans on points because this season is the whole game. Dynasty leans
   * on value because a 22-year-old with modest current points is still the asset.
   * Each pair should sum to 1; the engine renormalizes if it does not.
   */
  blend: {
    redraft: { value: number; points: number };
    dynasty: { value: number; points: number };
  };

  /** Projection reliability, from player_projection_accuracy. */
  reliability: {
    enabled: boolean;
    minMultiplier: number;
    maxMultiplier: number;
  };

  /** Availability, from player_projection_accuracy. */
  availability: {
    enabled: boolean;
    /** Blended toward 1.0 by this much so it never zeroes a player out. */
    damping: number;
    minMultiplier: number;
  };

  /**
   * Confidence gates the whole board. The raw gap between our opinion and the
   * market is LARGEST exactly where both numbers are least reliable, so without
   * this the top of every list is deep-board noise.
   */
  confidence: {
    /** ADP is fully trusted to this pick, then decays. */
    marketTrustedDepth: number;
    marketFloor: number;
    /** Our value rank is fully trusted to here, then decays. */
    valueTrustedDepth: number;
    valueFloor: number;
    /** Projection plus a graded beat-rate history. */
    bothDataFactor: number;
    /** A projection but no history (rookies land here). */
    projectionOnlyFactor: number;
    /** Neither. */
    noCompetitiveFactor: number;
    /** Room ADP needs this many drafts in the cohort before it says anything. */
    roomMinDrafts: number;
    /** Cap and floor on the room-agreement adjustment. */
    roomAgreementMax: number;
    roomAgreementMin: number;
    /** Rounds of disagreement between our rooms and the public market that saturate the adjustment. */
    roomAgreementRounds: number;
    /** Below this, a player is stored but never called a steal or a fade. */
    minConfidence: number;
  };

  /**
   * Positional centering.
   *
   * A points-above-replacement model and a real draft market disagree about
   * whole POSITIONS, not just about players. Ours puts elite quarterbacks
   * earlier than a one-QB room does, which is the long-running argument between
   * value-over-replacement models and actual draft behaviour, and it is not
   * something a steal list should be relaying. "The market is late on this
   * player" has to mean late relative to comparable players; a whole-position
   * offset is a strategy claim ("draft quarterbacks earlier than the room
   * does"), and it belongs in the guide's prose, not in every quarterback's row.
   *
   * So the median gap within each position is subtracted before scoring. The
   * displayed value_gap stays the raw honest arithmetic; only the ranking and
   * the category use the centered number.
   */
  positionCentering: {
    enabled: boolean;
    /** A position with fewer graded players than this is left uncentered. */
    minPlayers: number;
  };

  /** Turning a gap in rounds into a 0-100 score and a category. */
  scoring: {
    /** Gap in rounds at which the score saturates at 0 or 100. */
    stealSaturationRounds: number;
    stealMinRounds: number;
    fadeMinRounds: number;
    swingMinRounds: number;
    /** A "late-round swing" has to actually be available late. */
    lateRoundPick: number;
  };

  /**
   * Formats to build a board for. Empty means every active format that has FF
   * Beacon rankings. Best-ball formats are excluded by default: their draft
   * markets are a different game and we have no best-ball ADP.
   */
  formats: {
    include: string[];
    exclude: string[];
  };
};

export const DEFAULT_DRAFT_VALUE_SETTINGS: DraftValueSettings = {
  modelVersion: "bs-1",

  leagueShape: {
    teams: 12,
    starters: { QB: 1, RB: 2, WR: 3, TE: 1 },
    flex: 1,
    superflexAddsQb: true,
    flexShare: { RB: 0.45, WR: 0.45, TE: 0.1 },
  },

  blend: {
    redraft: { value: 0.35, points: 0.65 },
    dynasty: { value: 0.7, points: 0.3 },
  },

  reliability: {
    enabled: true,
    minMultiplier: 0.85,
    maxMultiplier: 1.15,
  },

  availability: {
    enabled: true,
    damping: 0.5,
    minMultiplier: 0.7,
  },

  confidence: {
    marketTrustedDepth: 200,
    marketFloor: 0.25,
    valueTrustedDepth: 250,
    valueFloor: 0.3,
    bothDataFactor: 1,
    projectionOnlyFactor: 0.8,
    noCompetitiveFactor: 0.55,
    roomMinDrafts: 5,
    roomAgreementMax: 1.15,
    roomAgreementMin: 0.85,
    roomAgreementRounds: 2,
    minConfidence: 0.35,
  },

  positionCentering: {
    enabled: true,
    minPlayers: 8,
  },

  scoring: {
    stealSaturationRounds: 3,
    stealMinRounds: 1,
    fadeMinRounds: 1,
    swingMinRounds: 0.5,
    lateRoundPick: 100,
  },

  formats: {
    include: [],
    exclude: ["bestball-ppr-std", "bestball-ppr-sflex", "bestball-dynasty-ppr-sflex"],
  },
};

/**
 * The canonical Sleeper scoring map a format is scored under.
 *
 * Sleeper publishes projections as a flat stat map whose keys are the same
 * tokens a scoring map uses, so scoring a projection under a format is a dot
 * product (see lib/league-scoring.ts). That is what makes TE premium exact here
 * rather than an invented multiplier: Sleeper emits `bonus_rec_te` as the tight
 * end's projected reception count, so a 0.5 bonus is worth exactly half a point
 * per projected catch.
 *
 * These are Sleeper's own defaults for everything except receptions and the TE
 * bonus, which are the two things a format slug actually varies.
 */
export function canonicalScoringForFormat(params: {
  scoringType: string;
  tePremiumBonus: number;
}): ScoringSettings {
  const rec =
    params.scoringType === "ppr" ? 1 : params.scoringType === "half_ppr" ? 0.5 : 0;
  return {
    pass_yd: 0.04,
    pass_td: 4,
    pass_int: -2,
    pass_2pt: 2,
    rush_yd: 0.1,
    rush_td: 6,
    rush_2pt: 2,
    rec,
    rec_yd: 0.1,
    rec_td: 6,
    rec_2pt: 2,
    fum_lost: -2,
    bonus_rec_te: params.tePremiumBonus > 0 ? params.tePremiumBonus : 0,
  };
}

/**
 * Merge a stored settings document over the code defaults. Only recognized keys
 * survive and nested objects merge one level deep, so a partial admin save
 * cannot drop a whole section.
 */
export function mergeDraftValueSettings(stored: unknown): DraftValueSettings {
  const base = DEFAULT_DRAFT_VALUE_SETTINGS;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  const s = stored as Record<string, unknown>;

  const obj = <T extends object>(key: string, fallback: T): T => {
    const v = s[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
    return { ...fallback, ...(v as object) } as T;
  };

  const storedShape = (s.leagueShape ?? {}) as Record<string, unknown>;
  const storedFormats = (s.formats ?? {}) as Record<string, unknown>;

  return {
    modelVersion: typeof s.modelVersion === "string" ? s.modelVersion : base.modelVersion,
    leagueShape: {
      ...base.leagueShape,
      ...obj("leagueShape", base.leagueShape),
      starters: {
        ...base.leagueShape.starters,
        ...((storedShape.starters as Partial<Record<StealPosition, number>>) ?? {}),
      },
      flexShare: {
        ...base.leagueShape.flexShare,
        ...((storedShape.flexShare as Partial<DraftValueSettings["leagueShape"]["flexShare"]>) ??
          {}),
      },
    },
    blend: {
      redraft: { ...base.blend.redraft, ...((s.blend as never as { redraft?: object })?.redraft ?? {}) },
      dynasty: { ...base.blend.dynasty, ...((s.blend as never as { dynasty?: object })?.dynasty ?? {}) },
    },
    reliability: obj("reliability", base.reliability),
    availability: obj("availability", base.availability),
    confidence: obj("confidence", base.confidence),
    positionCentering: obj("positionCentering", base.positionCentering),
    scoring: obj("scoring", base.scoring),
    formats: {
      include: Array.isArray(storedFormats.include)
        ? (storedFormats.include as string[]).filter((v) => typeof v === "string")
        : base.formats.include,
      exclude: Array.isArray(storedFormats.exclude)
        ? (storedFormats.exclude as string[]).filter((v) => typeof v === "string")
        : base.formats.exclude,
    },
  };
}
