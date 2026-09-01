/**
 * League Activity: the shared shapes.
 *
 * THE LINE THIS FILE DRAWS is between an EVENT and a CARD.
 *
 *   An EVENT is what we detected. Player ids, roster ids, scores, before and
 *   after values. It is what goes in `league_activity.payload`, it is stable
 *   forever, and it contains no prose at all.
 *
 *   A CARD is what a reader sees. Names, a headline, a sentence, an icon, a
 *   colour. It is built at render time by `writeup.ts` from an event plus the
 *   league's current identities, and it is never stored.
 *
 * Keeping those apart is the whole reason the copy can be rewritten next month
 * without every entry already in the log being frozen in this month's wording,
 * and it is why a manager who changes their team name has the new name on every
 * card rather than the name they had the day the event happened.
 *
 * NOTHING IN AN EVENT IS A CLAIM WE CANNOT SUPPORT. Sleeper gives us a real
 * timestamp for a transaction and settled points for a finished game. It gives
 * us nothing at all for a lineup edit or a scoring change: we see the new state
 * and we saw the old state at the previous sync, so all we honestly know is the
 * window. `precision` carries that distinction into the card, where it is
 * printed rather than hidden.
 */

/** Every event we can detect. One kind maps to exactly one card layout. */
export type ActivityKind =
  // Transactions, projected from `league_transactions` (exact timestamps).
  | "trade"
  | "waiver"
  | "free_agent"
  | "commissioner_move"
  // Results, projected from `league_matchups` once a week is final.
  | "matchup_result"
  // Lineups, detected by diffing `rosters` across two syncs.
  | "lineup_change"
  | "reserve_move"
  // League configuration, detected by diffing `leagues`.
  | "scoring_change"
  | "roster_positions_change"
  | "team_count_change"
  | "league_setting_change"
  | "league_renamed"
  | "league_status_change"
  | "draft_status_change"
  // People, detected by diffing `league_users` and `rosters.owner_user_id`.
  | "manager_joined"
  | "manager_left"
  | "roster_owner_change"
  | "commissioner_change"
  | "team_identity_change";

/** The filter buckets. Five chips plus All is as many as a panel can carry. */
export type ActivityCategory =
  | "transaction"
  | "result"
  | "lineup"
  | "settings"
  | "people";

/** How well we know when something happened. */
export type ActivityPrecision = "exact" | "observed";

export const ACTIVITY_CATEGORY_OF: Record<ActivityKind, ActivityCategory> = {
  trade: "transaction",
  waiver: "transaction",
  free_agent: "transaction",
  commissioner_move: "transaction",
  matchup_result: "result",
  lineup_change: "lineup",
  reserve_move: "lineup",
  scoring_change: "settings",
  roster_positions_change: "settings",
  team_count_change: "settings",
  league_setting_change: "settings",
  league_renamed: "settings",
  league_status_change: "settings",
  draft_status_change: "settings",
  manager_joined: "people",
  manager_left: "people",
  roster_owner_change: "people",
  commissioner_change: "people",
  team_identity_change: "people",
};

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  transaction: "Moves",
  result: "Results",
  lineup: "Lineups",
  settings: "League settings",
  people: "Managers",
};

/**
 * The chip copy. Shorter than the label above, because six of these sit in a
 * row on a phone and "League settings" does not fit next to five siblings.
 */
export const ACTIVITY_CATEGORY_CHIP: Record<ActivityCategory, string> = {
  transaction: "Moves",
  result: "Results",
  lineup: "Lineups",
  settings: "Settings",
  people: "Managers",
};

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "transaction",
  "result",
  "lineup",
  "settings",
  "people",
];

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return (
    typeof value === "string" &&
    (ACTIVITY_CATEGORIES as readonly string[]).includes(value)
  );
}

/* -------------------------------------------------------------------------- */
/* The event                                                                  */
/* -------------------------------------------------------------------------- */

/** A draft pick as an event names one. Mirrors Sleeper's own shape. */
export interface ActivityPickRef {
  season: number;
  round: number;
  /** The roster the pick originally belonged to, which never changes. */
  originalRosterId: number | null;
  /** "1.04" when a draft order exists for that season, else null. */
  label?: string | null;
}

/** A change to one named field, in the words the source uses for it. */
export interface ActivityFieldChange {
  key: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface TradePayload {
  sides: Array<{
    rosterId: number;
    /** Sleeper player ids this roster received. */
    players: string[];
    picks: ActivityPickRef[];
    /** FAAB received, in dollars. */
    faab: number;
  }>;
}

export interface WirePayload {
  rosterId: number | null;
  adds: string[];
  drops: string[];
  /** Winning FAAB bid, when Sleeper reported one. Null on a free agent add. */
  bid: number | null;
  status: string | null;
}

export interface MatchupResultPayload {
  matchupId: number | null;
  /** Both teams, highest score first. A tie leaves the order by roster id. */
  sides: Array<{ rosterId: number; points: number; benchPoints: number | null }>;
  /** Zero on a tie. */
  margin: number;
  tie: boolean;
}

export interface LineupChangePayload {
  rosterId: number;
  /** Sleeper player ids promoted into the starting lineup. */
  started: string[];
  /** Sleeper player ids taken out of it, and still on the roster. */
  benched: string[];
}

export interface ReserveMovePayload {
  rosterId: number;
  toReserve: string[];
  fromReserve: string[];
  toTaxi: string[];
  fromTaxi: string[];
}

export interface FieldChangesPayload {
  changes: ActivityFieldChange[];
}

export interface RosterPositionsPayload {
  added: string[];
  removed: string[];
  fromCount: number;
  toCount: number;
}

export interface ValueChangePayload {
  from: string | number | null;
  to: string | number | null;
}

export interface ManagerPayload {
  sleeperUserId: string;
  displayName: string | null;
  teamName: string | null;
  rosterId: number | null;
}

export interface RosterOwnerPayload {
  rosterId: number;
  fromUserId: string | null;
  fromLabel: string | null;
  toUserId: string | null;
  toLabel: string | null;
}

export interface CommissionerPayload {
  sleeperUserId: string;
  label: string | null;
  /** True when the badge was granted, false when it was taken away. */
  granted: boolean;
}

export interface TeamIdentityPayload {
  sleeperUserId: string;
  rosterId: number | null;
  /** The manager's handle, which is the stable half of their identity. */
  handle: string | null;
  changes: ActivityFieldChange[];
}

export type ActivityPayload =
  | TradePayload
  | WirePayload
  | MatchupResultPayload
  | LineupChangePayload
  | ReserveMovePayload
  | FieldChangesPayload
  | RosterPositionsPayload
  | ValueChangePayload
  | ManagerPayload
  | RosterOwnerPayload
  | CommissionerPayload
  | TeamIdentityPayload
  | Record<string, unknown>;

/** An event as the detector produces it, before it has an id or a row. */
export interface PendingActivity {
  kind: ActivityKind;
  /**
   * Unique per league, forever. The insert claims it; a conflict means this
   * event is already recorded and the second writer stops rather than retrying.
   */
  dedupeKey: string;
  occurredAt: string;
  precision: ActivityPrecision;
  /** Start of the window an observed event was spotted in. Null when exact. */
  observedFrom: string | null;
  season: number | null;
  week: number | null;
  rosterIds: number[];
  playerIds: string[];
  payload: ActivityPayload;
}

/** An event as it comes back out of the table. */
export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  category: ActivityCategory;
  occurredAt: string;
  precision: ActivityPrecision;
  observedFrom: string | null;
  season: number | null;
  week: number | null;
  rosterIds: number[];
  playerIds: string[];
  payload: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* The card                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The accent colour, as a name rather than a class.
 *
 * `writeup.ts` runs on the server and has no business knowing Tailwind class
 * strings; the component owns the mapping. Naming the intent here also means a
 * palette change is one file rather than nineteen.
 */
export type ActivityAccent =
  | "purple"
  | "cyan"
  | "amber"
  | "emerald"
  | "rose"
  | "slate";

/**
 * The icon, as a name.
 *
 * Same reason as the accent: a Lucide component cannot cross the server to
 * client boundary as a value, so the card carries a key and the component
 * resolves it.
 */
export type ActivityIconName =
  | "trade"
  | "waiver"
  | "freeAgent"
  | "gavel"
  | "trophy"
  | "lineup"
  | "shield"
  | "scoring"
  | "slots"
  | "teams"
  | "settings"
  | "rename"
  | "flag"
  | "draft"
  | "userPlus"
  | "userMinus"
  | "userSwap"
  | "crown"
  | "tag";

/** One team, as a card names it. */
export interface ActivityChip {
  rosterId: number;
  /** Team name, or the handle when no team name is set. */
  label: string;
  /** "@handle", or null when printing it would repeat the label. */
  owner: string | null;
  avatarId: string | null;
  /** Colours the chip on a result card. Neutral everywhere else. */
  tone: "win" | "loss" | "tie" | "neutral";
  href: string | null;
}

/** A player or pick moving in or out. */
export interface ActivityAsset {
  key: string;
  label: string;
  /** "RB, ATL" or "2027 1st". Null when we have nothing to add. */
  detail: string | null;
  position: string | null;
  direction: "in" | "out" | "flat";
}

/** One side of a two-sided card. */
export interface ActivityColumn {
  heading: string;
  chip: ActivityChip | null;
  assets: ActivityAsset[];
  /** "$14 FAAB", already formatted. Null when no money moved. */
  faab: string | null;
  /** "127.4", already formatted. Null when the column has no score. */
  score: string | null;
  tone: "win" | "loss" | "tie" | "neutral";
}

export interface ActivityStat {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
}

/** A before and after pair. */
export interface ActivityChange {
  label: string;
  from: string;
  to: string;
  direction: "up" | "down" | "flat";
}

export interface ActivityCard {
  id: string;
  kind: ActivityKind;
  category: ActivityCategory;
  accent: ActivityAccent;
  icon: ActivityIconName;
  /** "Trade", "Waiver claim", "Final score". */
  eyebrow: string;
  title: string;
  /** One sentence of voice. Null when nothing checkable can be said. */
  line: string | null;
  /** The raw instant, for the `<time datetime>` attribute. */
  occurredAtIso: string;
  /** "Sep 28, 8:14 PM EDT", or "Spotted Sep 28, 8:14 PM EDT". */
  timeLabel: string;
  /** The same instant as a relative phrase, for the quiet second line. */
  timeRelative: string;
  /** Extra sentence explaining an observed window. Null when exact. */
  timeNote: string | null;
  weekLabel: string | null;
  chips: ActivityChip[];
  columns: ActivityColumn[];
  moves: ActivityAsset[];
  stats: ActivityStat[];
  changes: ActivityChange[];
  footnote: string | null;
  href: string | null;
  hrefLabel: string | null;
}

/*
 * THERE IS DELIBERATELY NO `ariaLabel` ON A CARD.
 *
 * There was one, and it was a summary sentence naming the kind, the teams, the
 * assets and the time. Put on the `<article>` as `aria-label` it became the
 * element's accessible NAME, which every screen reader announces on entry and
 * then follows with the card's contents. Since nothing in the summary was
 * absent from the visible card, every entry was spoken twice, and on a forty
 * card feed that is double the listening time for no new information.
 *
 * The card is named by its own heading instead (`aria-labelledby`), so the
 * sentence is said once. See components/league-activity/activity-card.tsx.
 */

/** What `writeup.ts` needs besides the event itself. */
export interface ActivityContext {
  sleeperLeagueId: string;
  /** Keyed by Sleeper roster id. */
  teams: Record<
    number,
    { label: string; owner: string | null; avatarId: string | null }
  >;
  /** Keyed by Sleeper player id. */
  players: Record<
    string,
    { name: string; position: string | null; team: string | null }
  >;
  /** Forwarded onto every in-card link so the switcher survives the hop. */
  searchedUsername: string | null;
  /** Fixes "3 hours ago" for the whole render, so one page cannot disagree. */
  nowMs: number;
}
