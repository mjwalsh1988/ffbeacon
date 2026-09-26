/**
 * Code defaults for Beacon Ranker and the community rankings.
 *
 * These are what everything runs on when the ranking_builder_settings row is
 * missing, empty, or older than the schema (migration 0306). A missing row must
 * degrade to a working tool. Every key here is editable at /admin/beacon-ranker,
 * and app/admin/beacon-ranker/settings-coverage.test.ts fails if one is not.
 *
 * Client-safe: the admin form imports the bounds to draw its fields.
 */

export interface RankingBuilderSettings {
  builder: {
    /** Straight wins before the "place him at a rank, or keep comparing?"
     * prompt (plan decision 14). A newcomer who passes rank 1 is simply placed
     * first; no prompt. */
    winsBeforePrompt: number;
    /** Default depth for an overall or all-defenders board (plan decision 9).
     * A starting point for a signed-in reader, not a limit. */
    defaultDepthMulti: number;
    /** Default depth for a one-position board. */
    defaultDepthSingle: number;
    /** How many more players "Keep going" adds. */
    keepGoingStep: number;
    /** The most players one run may aim for. The board itself is capped at
     * 2,000 (MAX_BOARD_PLAYERS); a seed list rarely reaches past 600. */
    maxDepth: number;
    /** How many defenders the second pass brings onto an overall board with
     * defenders switched on. */
    defenderSecondPass: number;
    /** Board rows are rewritten from the run every this many answers, so a
     * crash loses at most this many and a resume rebuilds the rest. */
    checkpointEvery: number;
  };
  guests: {
    /** Guest ceiling for an overall, all-offense or all-defense board. */
    capMulti: number;
    /** Guest ceiling for a one-position board. */
    capSingle: number;
    /** A guest board is deleted this many hours after its last change. The
     * page states the number, so it is read from here, never hard-coded. */
    retentionHours: number;
  };
  limits: {
    /** Seed lists one actor (user, or salted IP) may load per hour. */
    seedLoadsPerHour: number;
    /** Answers one actor may submit per minute. A fast reader answers about
     * one a second. */
    answersPerMinute: number;
  };
  community: {
    /** A multi-position board counts once it ranks this many (decision 20). */
    minPlayersMulti: number;
    /** A one-position board counts once it ranks this many. */
    minPlayersSingle: number;
    /** A player is listed once he appears on this many counted boards
     * (decision 23). */
    minBoardsPerPlayer: number;
    /** A format's community board publishes once this many boards count. */
    minBoardsToPublish: number;
    /** How far past its own depth a board makes statements against its pool,
     * as a share of that depth (1.0 = a 50 player board speaks about seed ranks
     * 51 to 100 and nobody beyond). */
    poolMargin: number;
    /** Share of each board's weight carried by the statements the reader
     * actually made (within the board and about players they left off); the
     * rest goes to the statements against the pool. */
    withinBoardShare: number;
    /** Pull toward the middle, as pseudo-comparisons against an average
     * player, so one sighting on two boards cannot top the list. */
    shrinkage: number;
    /** "Agreement" means within this many spots. */
    agreementWindow: number;
    /**
     * Whether the community board is offered as a site-wide SOURCE. Off and
     * unused at launch (decision 21). Turning it on is a separate build: see
     * plan section 9.4 for what enabling it involves. The admin panel shows it
     * disabled.
     */
    sourceEnabled: boolean;
  };
}

export const DEFAULT_RANKING_BUILDER_SETTINGS: RankingBuilderSettings = {
  builder: {
    winsBeforePrompt: 3,
    defaultDepthMulti: 100,
    defaultDepthSingle: 24,
    keepGoingStep: 25,
    maxDepth: 600,
    defenderSecondPass: 36,
    checkpointEvery: 25,
  },
  guests: {
    capMulti: 48,
    capSingle: 12,
    retentionHours: 48,
  },
  limits: {
    seedLoadsPerHour: 30,
    answersPerMinute: 300,
  },
  community: {
    minPlayersMulti: 50,
    minPlayersSingle: 12,
    minBoardsPerPlayer: 5,
    minBoardsToPublish: 25,
    poolMargin: 1,
    withinBoardShare: 0.8,
    shrinkage: 1,
    agreementWindow: 3,
    sourceEnabled: false,
  },
};

type Bound = { min: number; max: number };

export const RANKING_BUILDER_SETTING_BOUNDS: {
  builder: Record<keyof RankingBuilderSettings["builder"], Bound>;
  guests: Record<keyof RankingBuilderSettings["guests"], Bound>;
  limits: Record<keyof RankingBuilderSettings["limits"], Bound>;
  community: Record<Exclude<keyof RankingBuilderSettings["community"], "sourceEnabled">, Bound>;
} = {
  builder: {
    winsBeforePrompt: { min: 2, max: 20 },
    defaultDepthMulti: { min: 10, max: 600 },
    defaultDepthSingle: { min: 4, max: 200 },
    keepGoingStep: { min: 5, max: 200 },
    maxDepth: { min: 24, max: 2000 },
    defenderSecondPass: { min: 0, max: 200 },
    checkpointEvery: { min: 5, max: 200 },
  },
  guests: {
    capMulti: { min: 4, max: 200 },
    capSingle: { min: 2, max: 100 },
    retentionHours: { min: 1, max: 720 },
  },
  limits: {
    seedLoadsPerHour: { min: 1, max: 1000 },
    answersPerMinute: { min: 10, max: 1000 },
  },
  community: {
    minPlayersMulti: { min: 2, max: 500 },
    minPlayersSingle: { min: 2, max: 200 },
    minBoardsPerPlayer: { min: 1, max: 1000 },
    minBoardsToPublish: { min: 1, max: 10000 },
    poolMargin: { min: 0, max: 5 },
    withinBoardShare: { min: 0.05, max: 1 },
    shrinkage: { min: 0, max: 100 },
    agreementWindow: { min: 0, max: 50 },
  },
};
