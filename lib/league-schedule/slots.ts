/**
 * Starting slots for the Schedule view, aligned to Sleeper's own array order.
 *
 * Sleeper's `starters` array is POSITIONAL. `starters[i]` is whoever the manager
 * put in the i-th startable slot of the league's `roster_positions`, and an
 * empty slot holds the string "0". So the only correct way to read that array is
 * against a slot list built by taking `roster_positions` in the league's own
 * order and removing exactly the tokens that can never hold a starter: BN, IR,
 * TAXI, NA. Nothing else may be removed, including tokens we do not recognise.
 * Drop one unknown token and every player below it moves up a slot, which is the
 * one bug this module exists to prevent.
 *
 * This deliberately DIFFERS from `startingSlots()` in lib/power-pulse/lineup.ts,
 * which additionally drops the tokens it cannot project (the IDP slots). Power
 * Pulse is right to drop them: filling an IDP slot with zero would pull every
 * team's projected score toward a floor no team can reach. The Schedule view is
 * right to keep them: it renders the lineup a human set, and a lineup missing
 * three linebackers is not that lineup. Two callers, two correct answers, two
 * functions. Do not unify them.
 */

import { NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY } from "@/lib/power-pulse/types";
import type { ScheduleSlot, SlotGroup } from "./types";

/**
 * Tokens that never hold an active starter, so they never consume a position in
 * Sleeper's `starters` array. Same set Power Pulse uses; shared rather than
 * copied so the two can never drift.
 */
export const NON_STARTING_TOKENS: ReadonlySet<string> = NON_STARTING_SLOTS;

/** Display grouping, top to bottom, in the order the matchup table renders. */
export const SLOT_GROUP_ORDER: readonly SlotGroup[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "SUPERFLEX",
  "IDP",
  "K",
  "DEF",
];

const LABELS: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  DST: "DEF",
  FLEX: "FLEX",
  REC_FLEX: "W/T",
  WR_TE: "W/T",
  WRRB_FLEX: "W/R",
  WRRB_WRT: "FLEX",
  SUPER_FLEX: "SUPERFLEX",
  Q_FLEX: "SUPERFLEX",
  DL: "DL",
  LB: "LB",
  DB: "DB",
  IDP_FLEX: "IDP",
};

/**
 * Spelled out for the accessible name. "W/T" read aloud is noise, and the slot
 * is the row header of the lineup table, so a screen reader hits it on every
 * row.
 */
const DESCRIPTIONS: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "team defense",
  DST: "team defense",
  FLEX: "flex, any running back, receiver or tight end",
  REC_FLEX: "wide receiver or tight end flex",
  WR_TE: "wide receiver or tight end flex",
  WRRB_FLEX: "wide receiver or running back flex",
  WRRB_WRT: "flex, any running back, receiver or tight end",
  SUPER_FLEX: "superflex, any quarterback, running back, receiver or tight end",
  Q_FLEX: "superflex, any quarterback, running back, receiver or tight end",
  DL: "defensive lineman",
  LB: "linebacker",
  DB: "defensive back",
  IDP_FLEX: "individual defensive player flex",
};

const GROUPS: Record<string, SlotGroup> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  DST: "DEF",
  FLEX: "FLEX",
  REC_FLEX: "FLEX",
  WR_TE: "FLEX",
  WRRB_FLEX: "FLEX",
  WRRB_WRT: "FLEX",
  SUPER_FLEX: "SUPERFLEX",
  Q_FLEX: "SUPERFLEX",
  DL: "IDP",
  LB: "IDP",
  DB: "IDP",
  IDP_FLEX: "IDP",
};

/** The visible label. An unrecognised token labels itself rather than vanishing. */
export function slotLabel(token: string): string {
  return LABELS[token] ?? token;
}

/** The accessible name. Falls back to the token, which is better than silence. */
export function slotDescription(token: string): string {
  return DESCRIPTIONS[token] ?? token;
}

/**
 * Which block of the lineup table a slot renders in. Anything we do not
 * recognise lands in IDP, because an exotic league should render its slot in a
 * plausible place rather than have it disappear.
 */
export function slotGroupOf(token: string): SlotGroup {
  return GROUPS[token] ?? "IDP";
}

/**
 * True when Sleeper publishes projections for the positions that can fill this
 * slot. False for IDP, which drives the "not published" treatment and the
 * footnote that says the totals exclude those slots.
 */
export function isProjectableSlot(token: string): boolean {
  const eligible = PULSE_SLOT_ELIGIBILITY[token];
  return Array.isArray(eligible) && eligible.length > 0;
}

/**
 * Expand `roster_positions` into the startable slots, in the league's own order.
 * `order` is the index into THIS list, which is the index into Sleeper's
 * `starters` array. See the header for why nothing else is filtered out.
 */
export function alignedStartingSlots(rosterPositions: string[]): ScheduleSlot[] {
  const out: ScheduleSlot[] = [];
  for (const token of rosterPositions) {
    if (NON_STARTING_TOKENS.has(token)) continue;
    out.push({
      token,
      label: slotLabel(token),
      description: slotDescription(token),
      group: slotGroupOf(token),
      projectable: isProjectableSlot(token),
      order: out.length,
    });
  }
  return out;
}

/**
 * Group the slots for display without losing the league's own ordering inside a
 * group, so a league running RB RB WR WR WR keeps RB1 above RB2. Returns a new
 * array; the input is left alone, because both sides of a matchup read the same
 * slot list and one of them sorting it in place would reorder the other.
 */
export function orderSlotsForDisplay<T extends { slot: ScheduleSlot }>(entries: T[]): T[] {
  const groupIndex = (group: SlotGroup): number => {
    const i = SLOT_GROUP_ORDER.indexOf(group);
    return i === -1 ? SLOT_GROUP_ORDER.length : i;
  };
  return [...entries].sort((a, b) => {
    const byGroup = groupIndex(a.slot.group) - groupIndex(b.slot.group);
    if (byGroup !== 0) return byGroup;
    return a.slot.order - b.slot.order;
  });
}
