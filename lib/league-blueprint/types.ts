/**
 * Team Blueprint view model.
 *
 * One roster in one Sleeper league read as a one-page plan. Plan of record:
 * docs/team-blueprint/team-blueprint-plan.md, sections 6 (every field), 8
 * (cache) and 11 (share images).
 *
 * THE RULES THIS SHAPE EXISTS TO HOLD
 *
 * 1. ONE view model, three readers. The page, the 1200x630 preview and the
 *    portrait share card all render a stored BlueprintView out of
 *    league_blueprint_cache, so a page and its picture show the same numbers
 *    by construction. The image routes never run an engine.
 *
 * 2. No new prediction model. Every figure here is read from an existing cache
 *    (power rankings, Power Pulse, the Manager Ledger, Market Signals, value
 *    trends) or is arithmetic over those. The one engine a build runs is the
 *    trade finder, which Trade Ideas already runs on every view.
 *
 * 3. Viewer independent. A stored view is shared by every reader of the same
 *    (league, roster, season, source), so nothing in it may depend on who is
 *    looking: no searched username inside a link (proposals are stored as
 *    TradeProposal and turned into hrefs at render), no manager tendency and no
 *    declined-trade list (those are one signed-in reader's, and a tendency is
 *    a conclusion about a named person that a guest may not see).
 *
 * 4. A null is a sentence, never a zero. Every nullable field is rendered as
 *    the words the plan gives it.
 *
 * 5. Defenders and specialists carry no market value (CLAUDE.md, IDP). They
 *    appear on the roster with "No market value", get no call, no grade
 *    contribution and no market signal.
 *
 * 6. The token for wins above replacement names exactly one metric in this
 *    product, Positional WAR, and the Blueprint displays none of it. Everything
 *    here is team-specific: "projected points", "value", "grade". The naming
 *    test scans this folder.
 *
 * 7. Players are stored ONCE, in `players`, and every section references them
 *    by id. That is what keeps a stored row under 40 KB (plan section 7.4).
 */

import type { FormatTag } from "@/lib/league-format-tags";
import type { TeamStatusKey } from "@/lib/league-team-status";
import type { TradeProposal } from "@/lib/trade-impact/types";
import type { AcceptanceBand, TeamDirection } from "@/lib/trade-finder/types";
import type { BlueprintPosition } from "./default-settings";

export type { BlueprintPosition };

/** Bumped on any formula change; a stale version rebuilds on next view. */
export const BLUEPRINT_MODEL_VERSION = 4;

/** The market signal states (lib/market-signals), as the Blueprint reads them. */
export type MarketSignalState =
  | "buy"
  | "watch_buy"
  | "hold"
  | "watch_sell"
  | "sell"
  | "baseline"
  | "thin";

export type BlueprintPlayer = {
  /** players.id (uuid). */
  id: string;
  sleeperId: string | null;
  name: string;
  position: string;
  team: string | null;
  /** Market value in the resolved (format, source). Null: "No market value". */
  value: number | null;
  /** Rank at his own position in this (format, source). */
  positionRank: number | null;
  /** Decimal years, one decimal. */
  age: number | null;
  /** The market signal for this (format, source); null when none is stored. */
  signal: MarketSignalState | null;
};

export type RosterCall = "sell" | "build" | "hold" | "cut";
export type CallStrength = "hard" | "soft";

export type PlayerCall = {
  call: RosterCall;
  /** Only Sell carries a strength ("Hard sell" or "Sell"). */
  strength: CallStrength | null;
  note: string | null;
};

export type BlueprintStatus = {
  key: TeamStatusKey;
  label: string;
  phrase: string;
  reason: string;
};

export type GradeKey = BlueprintPosition | "bench" | "picks";

export type BlueprintGrade = {
  key: GradeKey;
  /** "QB", "RB", "WR", "TE", "Bench", "Draft capital". */
  label: string;
  /** 1 to 10; null only for draft capital in redraft. */
  grade: number | null;
  /** League rank in value (positional, bench or picks value). */
  valueRank: number | null;
  /** League rank in projected points (or depth for the bench); null without Power Pulse. */
  pointsRank: number | null;
  /** "3rd of 12 in running back value, 5th in projected running back points." */
  reason: string;
};

export type BlueprintOutlook = {
  now: "Contend" | "Reload" | "Rebuild";
  next: "Contend" | "Reload" | "Rebuild";
  /** "Contend, then Reload". */
  text: string;
  reason: string;
};

export type LineupSlot = {
  /** Sleeper slot token ("QB", "SUPER_FLEX"). */
  slot: string;
  /** Short label drawn on screen ("SF"). */
  slotLabel: string;
  /** Spelled-out slot, the row header's accessible name ("Superflex"). */
  slotDescription: string;
  /** Null for an empty "0" slot: "Empty". */
  playerId: string | null;
};

export type DepthGroup = {
  /** QB, RB, WR, TE. */
  position: BlueprintPosition;
  playerIds: string[];
};

export type ShareFigure = {
  /** Percent of the league, one decimal (14.2 means 14.2%). Null: sentence. */
  pct: number | null;
  rank: number | null;
};

export type AgeRow = {
  position: BlueprintPosition;
  /** Value-weighted mean decimal age of this roster's priced players; null: "No priced players". */
  mine: number | null;
  league: number | null;
  /** league minus mine; positive means younger than the league. */
  gap: number | null;
  count: number;
};

export type BlueprintAge = {
  rows: AgeRow[];
  rosterMean: number | null;
  leagueMean: number | null;
  /** leagueMean minus rosterMean, one decimal. */
  gap: number | null;
  /** Share of priced player value aged at or under the young age, 0 to 1. */
  youngCoreShare: number | null;
};

export type Mover = {
  playerId: string;
  /** Signed percent change over the window. */
  pct: number;
  /** Signed value change over the window. */
  delta: number | null;
  rankChange: number | null;
};

export type BlueprintMovers = {
  risers: Mover[];
  fallers: Mover[];
  window: "7d" | "30d";
  windowLabel: string;
  /** Set when the 30-day window was too thin and 7 days was used instead. */
  fallbackNote: string | null;
};

export type ActivityBand = "Low" | "Moderate" | "High";

export type BlueprintActivity = {
  score: number;
  band: ActivityBand;
  driver: string;
  /** Percent of priced players, whole numbers. */
  sellsPct: number;
  buildsPct: number;
  holdsPct: number;
  pricedCount: number;
  buyTargetCount: number;
  buyPositionCount: number;
};

export type BuyTarget = {
  playerId: string;
  rosterId: number;
  ownerHandle: string | null;
  ownerTeamName: string;
  strength: CallStrength;
  proposal: TradeProposal;
};

export type BuyGroup = {
  position: BlueprintPosition;
  /** Points a week the lineup is short at this position, one decimal. */
  need: number;
  targets: BuyTarget[];
};

export type CapitalPick = {
  label: string;
  isOwn: boolean;
  /** "via @handle" when not own. */
  via: string | null;
  value: number | null;
};

export type CapitalSeason = {
  season: number;
  picks: CapitalPick[];
  value: number;
  rank: number | null;
  unpricedCount: number;
};

export type BlueprintCapital = {
  seasons: CapitalSeason[];
  pickSourceDisplay: string | null;
};

export type Priority = {
  id: string;
  weight: number;
  text: string;
};

export type TradeShape = "downtier" | "uptier" | "pivot";

export type StrategyAsset = {
  /** players.id for a player (stored in `players`); null for a pick. */
  playerId: string | null;
  label: string;
  position: string | null;
  value: number;
};

export type StrategyCard = {
  headline: string;
  counterpartyRosterId: number;
  counterpartyTeamName: string;
  counterpartyHandle: string | null;
  outgoing: StrategyAsset[];
  incoming: StrategyAsset[];
  verdictLabel: string | null;
  confidenceLabel: string | null;
  winsDelta: number | null;
  valueDelta: number;
  acceptance: AcceptanceBand;
  proposal: TradeProposal;
};

export type StrategyEntry = {
  shape: TradeShape;
  label: string;
  card: StrategyCard | null;
  /** "No pivot worth proposing this week." plus the finder notice when present. */
  emptyText: string | null;
};

export type TradePartner = {
  rosterId: number;
  teamName: string;
  ownerHandle: string | null;
  statusLabel: string | null;
  reason: string;
  fit: number;
};

export type SpotlightKind = "week" | "riser" | "value";

export type BlueprintSpotlight = {
  kind: SpotlightKind;
  playerId: string;
  /** "Top scorer, week 7", "Top riser, 30 days", "Most valuable player". */
  label: string;
  /** "24.6", "+18.2%", "6,412". */
  figure: string;
  /** The unit, appended sr-only to the figure ("points", "in 30 days", "value"). */
  figureUnit: string;
  /** "Projected 15.1, plus 9.5", "Up 812 in 30 days", "WR4 in this format". */
  comparison: string;
};

export type BlueprintView = {
  modelVersion: number;
  generatedAt: string;
  season: string;
  sleeperLeagueId: string;
  rosterId: number;

  header: {
    teamName: string;
    ownerHandle: string | null;
    ownerAvatarId: string | null;
    record: { wins: number; losses: number; ties: number; pointsFor: number };
    teamCount: number;
    formatTags: FormatTag[];
    formatDisplay: string;
    sourceSlug: string;
    sourceDisplay: string;
    pickSourceDisplay: string | null;
    isDynasty: boolean;
    isSuperflex: boolean;
    direction: TeamDirection | null;
  };

  players: Record<string, BlueprintPlayer>;

  standing: {
    overall: number;
    status: BlueprintStatus | null;
    valueArchetype: string | null;
    rosterArchetype: string;
    outlook: BlueprintOutlook | null;
    /** Redraft outlook sentence, or the "computed once Power Pulse has run" line. */
    outlookNote: string | null;
    /** Set when standing is unknown (no Power Pulse yet). */
    standingNote: string | null;
  };

  grades: BlueprintGrade[];
  lineup: LineupSlot[];
  depth: {
    groups: DepthGroup[];
    reserveIds: string[];
    taxiIds: string[];
    /** Defenders and specialists: "No market value", no call. */
    otherIds: string[];
    /** Starters by Sleeper's actual lineup (players.id). */
    starterIds: string[];
  };
  calls: Record<string, PlayerCall>;
  shares: { value: ShareFigure; production: ShareFigure };
  age: BlueprintAge;
  movers: BlueprintMovers;
  activity: BlueprintActivity;
  buys: BuyGroup[];
  capital: BlueprintCapital | null;
  priorities: Priority[];
  strategy: StrategyEntry[];
  partners: TradePartner[];
  spotlight: BlueprintSpotlight | null;
  hasDefenders: boolean;
};
