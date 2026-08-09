/**
 * Shared types for completed-draft snapshots. Pure and browser-safe: the client
 * cockpit imports these to render snapshot mode, and the server finalizer
 * (lib/on-the-clock/draft-snapshot.ts) builds them. Nothing here fetches.
 *
 * A DraftSnapshotPayload is everything a completed draft needs to re-render
 * without live data: the frozen board (values + ranks + ADP as resolved for the
 * draft's completion time), the frozen shaped draft cache, the league's trades,
 * the computed awards, and the provenance of how the historical value/ADP
 * snapshots were chosen.
 */

import type { Award } from "./awards";
import type { DraftGrade } from "./draft-grade";
import type { DraftPulseResult } from "./draft-pulse";
import type { PickBucketValue, RankedPlayer } from "./board-types";
import type { HistoryTransaction } from "./trade-history";
import type { PlayerPool, ShapedDraftCache } from "./types";

/** How a historical snapshot input was chosen relative to draft completion. */
export type SnapshotSourceKind =
  | "exact"
  | "during_draft"
  | "previous"
  | "next_available"
  | "current_fallback";

export type SnapshotConfidence = "high" | "medium" | "low";

/** The frozen FF Beacon board a completed draft renders against. */
export interface FrozenBoard {
  players: RankedPlayer[];
  pickValues: PickBucketValue[];
  formatSlug: string;
  formatLabel: string;
  /** Ranking-season label carried for parity with BoardResult (informational). */
  season: string;
  /** The Sleeper ADP market key the players' adp values came from, or null. */
  adpFormatKey: string | null;
  /** The player_market_snapshots partition date used, or null. */
  adpSnapshotDate: string | null;
}

export interface DraftSnapshotPayload {
  sleeperDraftId: string;
  sleeperLeagueId: string;
  season: string;
  leagueName: string | null;
  playerPool: PlayerPool;
  formatSlug: string | null;
  formatLabel: string | null;
  draftCompletedAt: string | null;
  finalizedAt: string;
  valueSnapshotSource: SnapshotSourceKind | null;
  adpSnapshotSource: SnapshotSourceKind | null;
  /** captured_at of the FF Beacon value batch the board froze from (ISO). */
  valueSnapshotDate: string | null;
  adpSnapshotDate: string | null;
  adpFormatKey: string | null;
  confidence: SnapshotConfidence;
  /**
   * The ADP value-indicator neutral band (in picks) this draft was GRADED with.
   * Snapshot-mode renders classify against this frozen threshold, never the
   * current admin setting, so board icons and list verdicts always match the
   * persisted pick verdicts and the locked awards.
   */
  thresholdPicks: number;
  board: FrozenBoard;
  cache: ShapedDraftCache;
  transactions: HistoryTransaction[];
  awards: Award[];
  /** Frozen per-team grades. Empty on a version 1 snapshot. */
  grades: DraftGrade[];
  /** Frozen Draft Pulse standings. Null on a version 1 snapshot. */
  pulse: DraftPulseResult | null;
  /**
   * Payload contract version. 1 is the original six awards with no grades; the
   * client gates the grades tab and the projection-backed award cards on this,
   * so an old snapshot never renders a grid it cannot fill.
   */
  snapshotVersion: number;
}
