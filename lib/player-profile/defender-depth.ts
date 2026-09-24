/**
 * Defender depth charts (plan R-24).
 *
 * The offensive ladder ("Handcuff", "Dart Throw") means nothing on a defense,
 * and a defense's depth chart is not one list per fantasy position: Sleeper
 * charts each SUB-position (left inside linebacker, nickel back, nose tackle)
 * with its own order, so a team has two order-1 inside linebackers, one on
 * each side, and both are starters. The room a defender is shown in is his
 * sub-position, read from `metadata.sleeper.depth_chart_position`, which
 * nothing read before this module.
 *
 * Pure and client-safe.
 */

const SUB_POSITIONS: Record<string, { label: string; phrase: string }> = {
  LDE: { label: "Defensive end, left", phrase: "left defensive end" },
  RDE: { label: "Defensive end, right", phrase: "right defensive end" },
  DE: { label: "Defensive end", phrase: "defensive end" },
  LDT: { label: "Defensive tackle, left", phrase: "left defensive tackle" },
  RDT: { label: "Defensive tackle, right", phrase: "right defensive tackle" },
  DT: { label: "Defensive tackle", phrase: "defensive tackle" },
  NT: { label: "Nose tackle", phrase: "nose tackle" },
  LOLB: { label: "Outside linebacker, left", phrase: "left outside linebacker" },
  ROLB: { label: "Outside linebacker, right", phrase: "right outside linebacker" },
  OLB: { label: "Outside linebacker", phrase: "outside linebacker" },
  LILB: { label: "Inside linebacker, left", phrase: "left inside linebacker" },
  RILB: { label: "Inside linebacker, right", phrase: "right inside linebacker" },
  ILB: { label: "Inside linebacker", phrase: "inside linebacker" },
  MLB: { label: "Middle linebacker", phrase: "middle linebacker" },
  SLB: { label: "Strongside linebacker", phrase: "strongside linebacker" },
  WLB: { label: "Weakside linebacker", phrase: "weakside linebacker" },
  LCB: { label: "Cornerback, left", phrase: "left cornerback" },
  RCB: { label: "Cornerback, right", phrase: "right cornerback" },
  CB: { label: "Cornerback", phrase: "cornerback" },
  NB: { label: "Nickel back", phrase: "nickel back" },
  SS: { label: "Strong safety", phrase: "strong safety" },
  FS: { label: "Free safety", phrase: "free safety" },
  S: { label: "Safety", phrase: "safety" },
};

/** "Inside linebacker, left" for LILB; null for a code we do not know. */
export function subPositionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return SUB_POSITIONS[code.toUpperCase()]?.label ?? null;
}

/** "left inside linebacker" for LILB, for use inside a sentence. */
export function subPositionPhrase(code: string | null | undefined): string | null {
  if (!code) return null;
  return SUB_POSITIONS[code.toUpperCase()]?.phrase ?? null;
}

/**
 * A defender's role at his sub-position. Order 1 is a starter whatever the
 * sub-position, so two order-1 inside linebackers are both "Starter".
 */
export function defenderDepthRole(order: number | null): string | null {
  if (order == null) return null;
  if (order === 1) return "Starter";
  if (order === 2) return "Backup";
  return "Reserve";
}
