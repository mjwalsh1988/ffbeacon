/**
 * Ordering, filtering, and labelling for the Draft Tracker. Pure, browser-safe,
 * deterministic: no Supabase, no fetch, no clock.
 *
 * The three orderings answer three different questions, and the copy says so
 * rather than making the reader work it out:
 *   value        who is worth the most, from the source the reader picked
 *   adp          who the wider market is taking next, for this exact format
 *   alphabetical where a name is, when someone at the table just said it
 *
 * A null sort key always sinks to the bottom of its list rather than sorting as
 * zero. A player with no ADP is not the first player off the board.
 */

import {
  MAX_TEAMS,
  MAX_TEAM_NAME_LENGTH,
  MIN_TEAMS,
  type BoardPosition,
  type DraftOrder,
  type TrackerPlayer,
  type TrackingMode,
} from "./types";

/** The three orderings, in the order they are offered. */
export const DRAFT_ORDERS: DraftOrder[] = ["value", "adp", "alphabetical"];

export function isDraftOrder(value: unknown): value is DraftOrder {
  return value === "value" || value === "adp" || value === "alphabetical";
}

export function isTrackingMode(value: unknown): value is TrackingMode {
  return value === "mine" || value === "all";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A row id has to look like a uuid before it is worth a round trip. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * The short name of an ordering, as it reads in a control.
 *
 * The value option carries the source's display name because the source toggle
 * in the header changes whose opinion this is, and a reader who has switched to
 * KTC should not be told they are looking at ours. The name is used verbatim,
 * never case-folded: it is a proper noun out of source_registry.
 */
export function orderLabel(order: DraftOrder, sourceLabel: string): string {
  if (order === "value") return `Player value (${sourceLabel})`;
  if (order === "adp") return "Sleeper ADP";
  return "A to Z";
}

/**
 * The ordering named inside a sentence, so the surrounding copy does not have to
 * fold the case of a source's display name to make it fit.
 */
export function orderPhrase(order: DraftOrder, sourceLabel: string): string {
  if (order === "value") return `player value from ${sourceLabel}`;
  if (order === "adp") return "Sleeper ADP";
  return "name, A to Z";
}

/** One plain sentence saying what the ordering does. */
export function orderHelp(order: DraftOrder, sourceLabel: string): string {
  if (order === "value") return `Best player first, by ${sourceLabel} value.`;
  if (order === "adp") return "In the order the wider market drafts them.";
  return "By last name, for when someone calls out a name.";
}

/**
 * Compare two precomputed sort names.
 *
 * Deliberately NOT localeCompare. This table server-renders and then hydrates,
 * and Node's default locale is not the browser's, so a locale-aware comparison
 * can order the same 800 rows two different ways and hand React a hydration
 * mismatch across the whole table. `sortName` is already lowercased on the
 * server, so a plain comparison is both stable and sufficient.
 */
function compareSortNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort a copy of the board. Ties fall back to overall rank so the order is
 * stable between renders and between the server and the browser.
 */
export function sortBoard(players: TrackerPlayer[], order: DraftOrder): TrackerPlayer[] {
  const out = players.slice();
  if (order === "alphabetical") {
    out.sort(
      (a, b) => compareSortNames(a.sortName, b.sortName) || a.overallRank - b.overallRank,
    );
    return out;
  }
  if (order === "adp") {
    out.sort((a, b) => {
      const av = a.adp;
      const bv = b.adp;
      if (av === null && bv === null) return a.overallRank - b.overallRank;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv || a.overallRank - b.overallRank;
    });
    return out;
  }
  out.sort((a, b) => {
    const av = a.value;
    const bv = b.value;
    if (av === null && bv === null) return a.overallRank - b.overallRank;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av || a.overallRank - b.overallRank;
  });
  return out;
}

/** Lowercase, strip accents, drop punctuation. "D'Andre" matches "dandre". */
export function searchKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "");
}

/**
 * Filter the board by typed text and position. Text matches the player's name
 * or their NFL team code, so typing "buf" finds the Bills.
 */
export function filterBoard(
  players: TrackerPlayer[],
  options: { search?: string; position?: BoardPosition | "ALL" },
): TrackerPlayer[] {
  const term = searchKey(options.search?.trim() ?? "");
  const position = options.position ?? "ALL";
  if (!term && position === "ALL") return players;
  return players.filter((p) => {
    if (position !== "ALL" && p.position !== position) return false;
    if (!term) return true;
    const haystack = `${searchKey(p.name)} ${searchKey(p.team ?? "")}`;
    return haystack.includes(term);
  });
}

/** The name shown for a team slot. Unnamed slots read as "Team 3". */
export function teamLabel(teamNames: string[], slot: number): string {
  const raw = teamNames[slot];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || `Team ${slot + 1}`;
}

/**
 * Coerce whatever came out of the team_names jsonb into a string array. A row
 * written by an older client, or by hand, must never crash the board.
 */
export function parseTeamNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => (typeof entry === "string" ? entry : ""));
}

/**
 * Normalise submitted team names to exactly `count` entries, trimmed and
 * length-capped. Extra entries are dropped and missing ones become blank, so a
 * client that sends the wrong number of boxes cannot desynchronise the slots.
 */
export function normalizeTeamNames(raw: unknown, count: number): string[] {
  // Cut to length BEFORE coercing every element. A server action body can carry
  // a megabyte, so a caller writing straight to the action can hand this a few
  // hundred thousand entries; there is no reason to walk past the first `count`
  // of them when the rest are discarded on the next line anyway.
  const source = parseTeamNames(Array.isArray(raw) ? raw.slice(0, count) : raw);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push((source[i] ?? "").trim().slice(0, MAX_TEAM_NAME_LENGTH));
  }
  return out;
}

/** Clamp a submitted team count into the range the setup form offers. */
export function clampTeamCount(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 12;
  return Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, n));
}

/**
 * The sentence the board's live region reads after a search, a filter, or a
 * press of Show more. Says what is left, not what was typed: the field already
 * echoes that.
 *
 * `shown` is in the sentence for a reason. Show more changes only how many rows
 * are on the page, so a sentence built from the match count alone would be
 * byte-identical to the one already in the region, React would skip the DOM
 * write, and the one control whose whole job is adding rows the reader cannot
 * see would announce nothing at all.
 */
export function describeBoard(
  shown: number,
  matches: number,
  total: number,
  positionLabel: string,
): string {
  const scope = positionLabel === "ALL" ? "" : ` at ${positionLabel}`;
  const head =
    matches === total
      ? `${total} ${total === 1 ? "player" : "players"}${scope} still available.`
      : `${matches} of ${total} available players${scope} match.`;
  // Everything that matches is on screen, so the head says it all.
  if (matches === 0 || shown >= matches) return head;
  return `${head} Showing the first ${shown}, ${matches - shown} still to come.`;
}

/**
 * The draft spot a pick landed on, as everyone writes it: "1.01", "4.11".
 *
 * Derived from where the pick sits in the recorded order and how many teams are
 * in the room, so it costs nothing to store and stays correct when a pick in the
 * middle is undone: every pick after it moves up a slot, which is what actually
 * happened.
 *
 * The pick half is padded to two digits because that is how a draft board reads
 * and how people say it out loud. A room bigger than 99 teams is not a thing.
 */
export function draftSlotLabel(pickNumber: number, teamCount: number): string {
  const teams = Math.max(1, Math.trunc(Number(teamCount)) || 1);
  const overall = Math.max(1, Math.trunc(Number(pickNumber)) || 1);
  const round = Math.floor((overall - 1) / teams) + 1;
  const pick = ((overall - 1) % teams) + 1;
  return `${round}.${String(pick).padStart(2, "0")}`;
}

/** The same spot said out loud, because "one point oh one" is not a number. */
export function describeDraftSlot(pickNumber: number, teamCount: number): string {
  const teams = Math.max(1, Math.trunc(Number(teamCount)) || 1);
  const overall = Math.max(1, Math.trunc(Number(pickNumber)) || 1);
  const round = Math.floor((overall - 1) / teams) + 1;
  const pick = ((overall - 1) % teams) + 1;
  return `Round ${round}, pick ${pick}`;
}

/**
 * "Allen josh" for "Josh Allen": what the A to Z ordering sorts on.
 *
 * Built on the server and carried on the row so the browser never re-splits a
 * name on every keystroke, and so a player with one name (a defense, say) still
 * sorts somewhere sensible rather than nowhere.
 */
export function buildSortName(
  first: string | null,
  last: string | null,
  full: string,
): string {
  const lastName = (last ?? "").trim();
  const firstName = (first ?? "").trim();
  if (lastName) return `${lastName} ${firstName}`.trim().toLowerCase();
  return full.trim().toLowerCase();
}
