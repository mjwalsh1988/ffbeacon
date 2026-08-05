/**
 * A stable name for one suggested deal.
 *
 * The pass list is keyed on this. Two things follow from that, and they pull in
 * opposite directions:
 *
 *   It must not change between renders. Passing a trade and having it come back
 *   under a new name because a value ticked up would make the button look
 *   broken. So the fingerprint is built only from WHO and WHAT: the counterparty
 *   and the two asset lists. No values, no scores, no timestamps.
 *
 *   It must not be so loose that passing one deal silences a different one.
 *   Turning down "my 2027 1st for their WR" should not also hide "my RB2 for
 *   their WR". So the asset lists are complete rather than summarized.
 *
 * Sides are sorted before hashing because asset order inside a package is an
 * accident of how the engine assembled it, and the same three players in a
 * different order is the same trade.
 *
 * The hash is FNV-1a, chosen because it needs no crypto import (this module is
 * pure and gets pulled into tests and, indirectly, into a client bundle through
 * the suggestion type), and because it is not defending anything. A collision
 * hides one suggestion from one user for two weeks. Adding the asset count to
 * the output makes an accidental collision between two real packages vanishingly
 * unlikely without pretending this is a security boundary.
 */

import type { SuggestionAsset } from "./types";

/** One asset, as it appears inside a fingerprint. */
function assetKey(asset: SuggestionAsset): string {
  return asset.kind === "player" ? `p:${asset.playerId}` : asset.key;
}

/** 32-bit FNV-1a, rendered as 8 lowercase hex characters. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, 16777619, applied with shifts so the multiply stays inside
    // 32 bits in JS number arithmetic.
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The fingerprint for one deal.
 *
 * Shape: `tf1-<counterparty>-<in count>x<out count>-<hash>`. The version prefix
 * is there so a future change to what a fingerprint covers retires the old pass
 * list cleanly instead of silently reinterpreting it.
 */
export function suggestionKey(params: {
  counterpartyRosterId: number;
  incoming: SuggestionAsset[];
  outgoing: SuggestionAsset[];
}): string {
  const inKeys = params.incoming.map(assetKey).sort();
  const outKeys = params.outgoing.map(assetKey).sort();
  const body = `${params.counterpartyRosterId}|${inKeys.join(",")}|${outKeys.join(",")}`;
  return `tf1-${params.counterpartyRosterId}-${inKeys.length}x${outKeys.length}-${fnv1a(body)}`;
}

/**
 * What a stored pass key is allowed to look like.
 *
 * The decline endpoint takes this string from the client, because the client is
 * echoing back a key the server just handed it. Validating the shape keeps a
 * malformed or oversized value out of the table; it is not a claim that the key
 * is one we generated. It does not need to be. A forged key can only hide a
 * suggestion from the person who forged it.
 */
export const SUGGESTION_KEY_PATTERN = /^tf1-\d{1,6}-\d{1,2}x\d{1,2}-[0-9a-f]{8}$/;

export function isValidSuggestionKey(value: unknown): value is string {
  return typeof value === "string" && SUGGESTION_KEY_PATTERN.test(value);
}
