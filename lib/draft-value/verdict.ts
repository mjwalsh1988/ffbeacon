/**
 * The plain-language verdict for one Beacon Steals row.
 *
 * This sentence is the PRIMARY output, not a decoration on a table. Someone
 * reading the board by screen reader should get the whole conclusion from it
 * without assembling four numbers out of four cells, and someone skimming by eye
 * should be able to read one line and move on.
 *
 * Deterministic and pure. No AI, no randomness, so the same inputs always
 * produce the same sentence and a rebuild never rewrites the board's prose.
 *
 * A clause whose input is missing is DROPPED, never filled with a placeholder.
 * A rookie with no graded history simply gets a shorter sentence than a
 * ten-year veteran, which is honest: we know less about him.
 */

import type { ScoredPlayer, StealCategory } from "./engine";

/** Whole picks, with the right noun. */
function picks(value: number): string {
  const n = Math.max(0, Math.round(Math.abs(value)));
  return `${n} ${n === 1 ? "pick" : "picks"}`;
}

/** "round 3" from a pick number and a team count. */
function roundOf(pickNo: number, teams: number): number {
  return Math.max(1, Math.ceil(pickNo / Math.max(1, teams)));
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Short label for the category, used as the row's heading in the UI. */
export function categoryLabel(category: StealCategory): string {
  if (category === "steal") return "Steal";
  if (category === "swing") return "Late-round swing";
  if (category === "fade") return "Fade";
  return "Priced about right";
}

/**
 * One sentence per idea, assembled from whatever we actually know.
 *
 * The order is deliberate: where the market takes him, where we would, why, and
 * only then the reliability history. That is the order the question is asked in.
 */
export function buildVerdict(
  scored: ScoredPlayer,
  context: {
    formatLabel: string;
    teams: number;
    /**
     * Observed picks needed before our own rooms are quoted. Passed in rather
     * than hardcoded so raising it in the admin actually moves the copy.
     */
    roomMinPicks?: number;
    /** Below this confidence the read is disclosed as thin. Also admin-driven. */
    thinConfidence?: number;
  },
): string {
  const parts: string[] = [];
  const { teams, formatLabel } = context;
  const roomMinPicks = context.roomMinPicks ?? 5;
  const thinConfidence = context.thinConfidence ?? 0.5;

  if (scored.marketAdp !== null) {
    const round = roundOf(scored.marketAdp, teams);
    parts.push(
      `Goes around pick ${Math.round(scored.marketAdp)} (round ${round}) in ${formatLabel}.`,
    );
  } else {
    parts.push(`Undrafted in the ${formatLabel} market we track.`);
  }

  if (scored.beaconPick !== null && scored.marketAdp !== null && scored.valueGap !== null) {
    const where = `We would take him around ${Math.round(scored.beaconPick)}`;
    if (Math.abs(scored.valueGap) < 1) {
      parts.push(`${where}, which is right about where he goes.`);
    } else if (scored.valueGap > 0) {
      // He lasts LONGER than we would wait, so the room is late on him.
      parts.push(`${where}, and he lasts ${picks(scored.valueGap)} longer than that.`);
    } else {
      parts.push(`${where}, so the room is spending ${picks(scored.valueGap)} too early on him.`);
    }

    // THE ROW MUST NOT CONTRADICT ITS OWN BUCKET.
    //
    // The board ranks on positionAdjustedGap and the sentence above quotes the
    // raw gap, and the two can disagree in SIGN. Nine rows shipped to production
    // that way: Brock Purdy in redraft superflex went at 36.2 against our pick
    // 40.1, so the sentence read "the room is spending 4 picks too early on him"
    // while the row sat under a heading that says the room is late on him. Both
    // numbers were right. Neither explained the other.
    //
    // The reason is real and worth saying out loud rather than hiding: the room
    // drafts that whole position earlier than our board does, so a player it
    // takes only slightly early is genuinely a bargain against his own position.
    // That is the sentence a reader needs, and it only appears when the two
    // numbers actually diverge.
    if (
      scored.positionAdjustedGap !== null &&
      Math.abs(scored.positionGapOffset) >= 1 &&
      Math.sign(scored.positionAdjustedGap) !== Math.sign(scored.valueGap)
    ) {
      const direction = scored.positionGapOffset < 0 ? "earlier" : "later";
      const verb = scored.positionAdjustedGap > 0 ? "of value" : "of premium";
      parts.push(
        `The room drafts every ${scored.position} in this format about ${picks(scored.positionGapOffset)} ${direction} than our board does, so against the rest of the position he is ${picks(scored.positionAdjustedGap)} ${verb}.`,
      );
    }
  } else if (scored.beaconPick !== null) {
    parts.push(`We would take him around ${Math.round(scored.beaconPick)}.`);
  }

  if (typeof scored.pointsAboveReplacement === "number") {
    const par = Math.round(scored.pointsAboveReplacement);
    if (par > 0) {
      parts.push(
        `He projects ${par} points above a replacement ${scored.position} over the season.`,
      );
    } else if (par < 0) {
      parts.push(
        `He projects ${Math.abs(par)} points below a replacement ${scored.position}, so the case is the asset rather than the lineup.`,
      );
    } else {
      parts.push(`He projects level with a replacement ${scored.position}.`);
    }
  }

  if (typeof scored.beatRate === "number") {
    parts.push(`Beats his weekly projection ${pct(scored.beatRate)} of the time.`);
  }

  if (typeof scored.availability === "number" && scored.availability < 0.8) {
    parts.push(`Available for ${pct(scored.availability)} of the weeks he was projected for.`);
  }

  // The uncertainty disclosure. A swing is uncertain BY DEFINITION, so saying so
  // there would be noise; anywhere else a thin read is worth naming out loud.
  if (scored.category === "swing") {
    parts.push("A dart throw, not a plan.");
  } else if (scored.confidence !== null && scored.confidence < thinConfidence) {
    parts.push("Thin data, so treat this as a lead rather than a verdict.");
  }

  if (
    scored.roomAdp !== null &&
    scored.marketAdp !== null &&
    (scored.roomPicksSampled ?? 0) >= roomMinPicks &&
    scored.roomAdp - scored.marketAdp >= teams / 2
  ) {
    parts.push(`Our own synced drafts let him fall even further, to about ${Math.round(scored.roomAdp)}.`);
  }

  return parts.join(" ");
}
