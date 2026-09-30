/**
 * The one or two facts a card leads with, as short chips.
 *
 * The reason sentence says everything in twenty-odd words, which is the right
 * length for a reader who asked "why him" and the wrong length for a grid
 * somebody is scanning. These chips are the scan: each restates ONE figure
 * already on the card in four words, picked in the order that most often
 * decides a claim. A role change first, because it shows up before the points
 * do; then how many real leagues just paid for him; then how free he still
 * is. Never more than two, so a card never turns into a row of badges.
 *
 * Deterministic and pure, like the reason templates: every chip cites a number
 * on the row and a missing number means the chip does not appear.
 */

import type { BoardRow } from "./types";

export type HighlightKind = "role" | "claimed" | "available" | "upgrade" | "snaps" | "crowded";

export type Highlight = { kind: HighlightKind; text: string };

/** Touches gained on his recent average before it counts as a role change. */
const ROLE_UP_TOUCHES = 3;
/** Leagues that claimed him before it reads as a hot claim. */
const HOT_CLAIM_LEAGUES = 10;
/** Rostered share under which he is widely available. */
const WIDELY_FREE_PCT = 25;
/** Snap share that marks a real role, for a player whose touches did not jump. */
const BIG_SNAP_PCT = 60;

export function cardHighlights(row: BoardRow, max = 2): Highlight[] {
  const out: Highlight[] = [];
  const o = row.opportunity;

  if (o.touchDelta != null && o.touchDelta >= ROLE_UP_TOUCHES) {
    out.push({ kind: "role", text: `Touches up ${Math.round(o.touchDelta)}` });
  }
  if (row.market && row.market.leagues >= HOT_CLAIM_LEAGUES) {
    out.push({ kind: "claimed", text: `Claimed in ${row.market.leagues} leagues` });
  }
  if (row.rosterRate?.pct != null && row.rosterRate.pct < WIDELY_FREE_PCT) {
    out.push({
      kind: "available",
      text: `Free in ${Math.round(100 - row.rosterRate.pct)}% of leagues`,
    });
  }
  if (row.pointsAboveReplacement != null && row.pointsAboveReplacement > 0) {
    out.push({
      kind: "upgrade",
      text: `${row.pointsAboveReplacement.toFixed(1)} points over a starter`,
    });
  }
  if (o.snapPct != null && o.snapPct >= BIG_SNAP_PCT) {
    out.push({ kind: "snaps", text: `${Math.round(o.snapPct)}% of snaps` });
  }
  if (row.bid?.bidders === "4p") {
    out.push({ kind: "crowded", text: "Crowded claim" });
  }

  return out.slice(0, max);
}
