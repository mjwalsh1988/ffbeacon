/**
 * A built trade, encoded into the URL.
 *
 * The builder could have kept its state in React and posted it to an action, and
 * that would have been less code. It would also have made a trade you spent two
 * minutes assembling unshareable, unbookmarkable, and destroyed by the back
 * button. So the proposal lives in the query string, the page renders the
 * evaluation on the server from it, and every one of those problems goes away.
 *
 * FORM
 *   ?mode=build&with=4&in=<uuid>_<uuid>_2027-1-mid&out=<uuid>
 *
 *   `with` is the counterparty's Sleeper roster id. `in` is what the reader
 *   receives, `out` is what they send, both underscore separated. A player is
 *   its FF Beacon uuid. A pick is `season-round-slot`.
 *
 *   Underscore is the separator for a specific reason, and it was arrived at by
 *   being wrong first. The obvious pick is a comma or a tilde. A comma is what
 *   PostgREST filter strings use, and this code sits a few frames from code that
 *   builds those, so keeping the alphabets apart costs nothing. A tilde is
 *   unreserved in RFC 3986, which SOUNDS like it survives a round trip and does
 *   not: URLSearchParams serializes as application/x-www-form-urlencoded, whose
 *   safe set is alphanumerics plus `*`, `-`, `.` and `_` only, so a tilde comes
 *   out as %7E and the address bar fills with noise. Underscore survives
 *   untouched, and `-` is already spoken for inside a pick token.
 *
 * THIS PARSER TRUSTS NOTHING
 *   Everything here is shape validation: is this a uuid, is this a plausible
 *   season, are there too many assets. It does NOT and CANNOT establish that a
 *   player is on the roster he is claimed to be on. That check needs the
 *   database and it lives in lib/trade-impact/evaluate.ts, which re-derives
 *   ownership from `rosters.player_ids` rather than believing the caller.
 *
 *   The split matters for rate limiting: shape validation is cheap and runs
 *   BEFORE a rate-limit slot is claimed, so a stale or malformed link cannot
 *   burn a reader's budget and a flood of garbage gains an attacker nothing.
 *
 * Pure. No database, no React, no clock.
 */

import type { BuildAsset, PickSlot, TradeProposal } from "./types";

/** Assets per side. Matches MAX_ASSETS_PER_SIDE in lib/trade-finder-saves.ts, so
 *  a built trade can be bookmarked through the existing table. */
export const MAX_BUILD_ASSETS_PER_SIDE = 6;

/** Rounds a Sleeper league can plausibly draft. Wider than any real league. */
const MAX_PICK_ROUND = 10;

/** How far out a tradeable pick can sit. Dynasty leagues trade three years out. */
const PICK_SEASON_MIN = 2000;
const PICK_SEASON_MAX = 2100;

const ASSET_SEPARATOR = "_";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const PICK_SLOTS: readonly PickSlot[] = ["early", "mid", "late", "unknown"];

function isPickSlot(value: string): value is PickSlot {
  return (PICK_SLOTS as readonly string[]).includes(value);
}

/** One asset, as it appears in the query string. */
export function encodeAsset(asset: BuildAsset): string {
  if (asset.kind === "player") return asset.playerId;
  return `${asset.season}-${asset.round}-${asset.pickPosition}`;
}

/**
 * One asset, back out. Returns null for anything that is not a shape we wrote,
 * and a null is dropped by the caller rather than failing the whole link: a
 * trade that lost one piece is still worth showing with a note, and a link that
 * renders nothing tells the reader less than one that renders most of it.
 */
export function decodeAsset(token: string): BuildAsset | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  if (UUID_PATTERN.test(trimmed)) {
    return { kind: "player", playerId: trimmed.toLowerCase() };
  }

  const parts = trimmed.split("-");
  if (parts.length !== 3) return null;
  const season = Number.parseInt(parts[0], 10);
  const round = Number.parseInt(parts[1], 10);
  const slot = parts[2];
  if (!Number.isInteger(season) || season < PICK_SEASON_MIN || season > PICK_SEASON_MAX) {
    return null;
  }
  if (!Number.isInteger(round) || round < 1 || round > MAX_PICK_ROUND) return null;
  if (!isPickSlot(slot)) return null;
  return { kind: "pick", season, round, pickPosition: slot };
}

function encodeSide(assets: BuildAsset[]): string {
  return assets.slice(0, MAX_BUILD_ASSETS_PER_SIDE).map(encodeAsset).join(ASSET_SEPARATOR);
}

/**
 * Decode one side.
 *
 * Duplicates are collapsed: the same player cannot be sent twice, and a link
 * saying otherwise would double his value in the totals. The cap is applied
 * AFTER deduplication so a link padded with repeats cannot push real assets out
 * of the window.
 */
function decodeSide(raw: string | null | undefined): {
  assets: BuildAsset[];
  dropped: number;
} {
  if (typeof raw !== "string" || !raw.trim()) return { assets: [], dropped: 0 };
  const tokens = raw.split(ASSET_SEPARATOR);

  const assets: BuildAsset[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const token of tokens) {
    const asset = decodeAsset(token);
    if (!asset) {
      dropped += 1;
      continue;
    }
    const key = encodeAsset(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    if (assets.length >= MAX_BUILD_ASSETS_PER_SIDE) {
      dropped += 1;
      continue;
    }
    assets.push(asset);
  }

  return { assets, dropped };
}

export type ProposalParams = {
  with?: string | string[];
  in?: string | string[];
  out?: string | string[];
};

export type DecodedProposal = {
  /** Null when the link names no counterparty, which means there is no trade. */
  proposal: TradeProposal | null;
  /**
   * Tokens the link carried that we could not read. Non-zero means the reader
   * should be told the link is partial rather than shown a quietly smaller
   * trade than the one that was shared with them.
   */
  droppedTokens: number;
};

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

/**
 * Read a proposal out of `searchParams`.
 *
 * `myRosterId` is a PARAMETER, not something read out of `params`. This function
 * cannot move whose trade is being evaluated, and its tests hold that line.
 *
 * WHAT THAT DOES AND DOES NOT BUY, stated plainly because an earlier draft of
 * this comment claimed more than it delivers and someone would have relied on
 * it. The page derives `myRosterId` from `?roster=` (through
 * `loadTradeFinderLeague`'s identity resolution), and `encodeProposalQuery`
 * writes `roster` into the shareable link. So a link CAN name whose team gets
 * evaluated. That is a product behaviour, not a leak: every figure the
 * evaluation produces (team names, player values, projections, playoff odds,
 * Power Pulse rank) is already on the Overview and Power Pulse tabs of the same
 * league for any visitor, with no auth and no write anywhere. There is nothing
 * private on the other side of it.
 *
 * The guarantee this signature does give is narrower and still worth having: the
 * `in`/`out` half of a link cannot disagree with the roster half. Ownership is
 * re-derived against that one roster in lib/trade-impact/evaluate.ts, so a link
 * cannot smuggle a player from a third team into somebody's package.
 */
export function decodeProposal(
  params: ProposalParams,
  myRosterId: number,
): DecodedProposal {
  const withRaw = firstValue(params.with);
  const theirRosterId = withRaw === null ? Number.NaN : Number.parseInt(withRaw, 10);
  if (!Number.isInteger(theirRosterId) || theirRosterId < 0 || theirRosterId === myRosterId) {
    return { proposal: null, droppedTokens: 0 };
  }

  const incoming = decodeSide(firstValue(params.in));
  const outgoing = decodeSide(firstValue(params.out));
  const droppedTokens = incoming.dropped + outgoing.dropped;

  if (incoming.assets.length === 0 && outgoing.assets.length === 0) {
    return { proposal: null, droppedTokens };
  }

  return {
    proposal: {
      myRosterId,
      theirRosterId,
      incoming: incoming.assets,
      outgoing: outgoing.assets,
    },
    droppedTokens,
  };
}

/**
 * Build the query string for a proposal, ready to hand to a Link.
 *
 * Carries the reader's context (`username`, `source`, `roster`) through, because
 * a builder link that loses the value source would price the same trade
 * differently on the other side of a click.
 */
export function encodeProposalQuery(
  proposal: TradeProposal,
  context: {
    searchedUsername?: string | null;
    source?: string | null;
    includeRoster?: boolean;
  } = {},
): string {
  const qs = new URLSearchParams();
  qs.set("mode", "build");
  qs.set("with", String(proposal.theirRosterId));
  if (proposal.incoming.length > 0) qs.set("in", encodeSide(proposal.incoming));
  if (proposal.outgoing.length > 0) qs.set("out", encodeSide(proposal.outgoing));
  if (context.includeRoster !== false) qs.set("roster", String(proposal.myRosterId));
  if (context.searchedUsername) qs.set("username", context.searchedUsername);
  if (context.source) qs.set("source", context.source);
  return qs.toString();
}

/** Full href for a proposal on one league's Trade Ideas page. */
export function proposalHref(
  sleeperLeagueId: string,
  proposal: TradeProposal,
  context: { searchedUsername?: string | null; source?: string | null } = {},
): string {
  return `/leagues/${sleeperLeagueId}/trade-ideas?${encodeProposalQuery(proposal, context)}`;
}
