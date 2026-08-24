/**
 * What one asset is doing in this trade, for this team.
 *
 * The verdict panel already prints every figure an asset carries. What it never
 * said is what those figures MEAN for the roster they are landing on, which is
 * the question a manager is actually holding: not "is Puka good", but "does
 * Puka start for me, and what walks out of the door to get him".
 *
 * EVERY NOTE IS A FACT ALREADY ON THE PAGE
 * `incomingStartWeeks` counts the weeks a player actually cracks the optimal
 * lineup, and it is the single most useful thing the model knows about an
 * incoming player: a 6,000-value receiver who starts two weeks of eleven is a
 * different trade to one who starts all eleven. Everything else here is the
 * asset's own value, projection, age, and roster status. Nothing is generated
 * and nothing is inferred beyond the thresholds written out below.
 *
 * WHAT IT REFUSES TO SAY
 * A note about starts needs a lineup model. In a league with no weekly
 * projections there is nothing to count, so the note is null and the card falls
 * back to the figures alone. A zero would read as "never starts", which is a
 * claim about the player rather than about our data.
 *
 * OUTGOING PLAYERS GET NO STARTS NOTE. The model measures the lineup with them
 * gone, not the weeks they used to fill, so counting their starts would mean
 * inventing a number. What leaves is described by value and projection, which
 * are facts we hold either way.
 *
 * Pure. No React, no database.
 */

import type { ResolvedAsset, TeamImpact } from "./types";

/**
 * Share of its own side an asset needs to be the piece the deal is about.
 *
 * Paired with "and it is the biggest thing on that side", because a share alone
 * gets both ends wrong. At 0.6 the main piece of a three-for-one never qualifies
 * (a 44 percent tight end was reading as an ordinary throw-in). At 0.4 without
 * the largest-asset test, a 55/45 two-man package would crown both of them.
 */
const CENTREPIECE_SHARE = 0.4;
/** Share below which an asset is a throw-in rather than a piece of the deal. */
const FILLER_SHARE = 0.12;
/** Weeks started, as a share of weeks left, at or above which a player starts. */
const STARTS_OFTEN = 0.7;
/** At or below which he is depth rather than a starter. */
const STARTS_RARELY = 0.3;
/** Points a week of positional change under which nothing really happened. Same
 *  bar the lineup reason uses, so the cards cannot claim a move the reasons
 *  decline to name. */
const POSITION_NOISE = 0.5;

export type AssetTone = "good" | "bad" | "neutral";

export type AssetNote = {
  /** Two or three words, for the chip on the card. */
  label: string;
  /** One sentence, every number in it printed elsewhere on the page. */
  detail: string;
  tone: AssetTone;
};

export type AssetRole = "centrepiece" | "piece" | "filler";

export type AssetVerdict = {
  /** How much of its own side this asset is. Drives the card's prominence. */
  role: AssetRole;
  /** Its share of that side's value, 0..1. */
  share: number;
  /** Weeks it cracks the lineup, for incoming players only. Null otherwise. */
  startWeeks: number | null;
  notes: AssetNote[];
};

function fmtValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function roleOf(share: number, sideCount: number, isLargest: boolean): AssetRole {
  if (sideCount === 1) return "centrepiece";
  if (isLargest && share >= CENTREPIECE_SHARE) return "centrepiece";
  if (share <= FILLER_SHARE) return "filler";
  return "piece";
}

/**
 * Read one asset for the reader's own team.
 *
 * `direction` is which way the asset is moving from the READER's point of view,
 * which flips the tone of nearly every note: a player who starts every week is
 * good news arriving and bad news leaving.
 */
export function readAsset(
  asset: ResolvedAsset,
  opts: {
    direction: "incoming" | "outgoing";
    /** Total value of the side this asset sits on. */
    sideTotal: number;
    /** How many assets are on that side. */
    sideCount: number;
    /** True when this is the most valuable asset on its side. */
    isLargest: boolean;
    /**
     * Net change to this asset's POSITION in the optimal lineup, points per
     * week, or null when it cannot be attributed to this asset alone.
     *
     * The caller passes it only when this asset is the sole piece at its
     * position in the whole trade. A position with players moving both ways nets
     * out to one number, and hanging that number on one of them would credit or
     * blame him for the other's effect.
     */
    positionDelta: number | null;
    /** Remaining weeks the lineup model covered. */
    weeksConsidered: number;
    /** mine.incomingStartWeeks. Empty when there is no lineup model. */
    startWeeksByPlayer: Record<string, number>;
    /** No weekly projections in this league, so no starts can be counted. */
    noLineup: boolean;
    isDynasty: boolean;
  },
): AssetVerdict {
  const incoming = opts.direction === "incoming";
  const share = opts.sideTotal > 0 ? asset.value / opts.sideTotal : 0;
  const notes: AssetNote[] = [];

  if (asset.kind === "pick") {
    notes.push({
      label: incoming ? "Future capital" : "Capital out",
      detail: incoming
        ? `Worth ${fmtValue(asset.value)}, and it cannot start a game for you this season.`
        : `Worth ${fmtValue(asset.value)}. You are spending future capital to win sooner.`,
      tone: incoming ? "neutral" : "neutral",
    });
    if (asset.positionEstimated && asset.pickPosition !== "unknown") {
      notes.push({
        label: "Slot is projected",
        detail: `Where it lands in the round is our projection of the original owner's finish, not a published draft order, so its price moves as their season does.`,
        tone: "neutral",
      });
    }
    return {
      role: roleOf(share, opts.sideCount, opts.isLargest),
      share,
      startWeeks: null,
      notes,
    };
  }

  const startWeeks = incoming ? (opts.startWeeksByPlayer[asset.playerId] ?? null) : null;

  // How often he actually plays for you. The headline fact about anyone arriving.
  if (incoming && !opts.noLineup && startWeeks !== null && opts.weeksConsidered > 0) {
    const rate = startWeeks / opts.weeksConsidered;
    if (rate >= STARTS_OFTEN) {
      notes.push({
        label: "Starts for you",
        detail: `Cracks your best lineup in ${startWeeks} of ${opts.weeksConsidered} remaining ${opts.weeksConsidered === 1 ? "week" : "weeks"}.`,
        tone: "good",
      });
    } else if (rate <= STARTS_RARELY) {
      notes.push({
        label: startWeeks === 0 ? "Does not start" : "Depth only",
        detail:
          startWeeks === 0
            ? `Never cracks your best lineup over the ${opts.weeksConsidered} ${opts.weeksConsidered === 1 ? "week" : "weeks"} left, so he adds nothing to your scoring as things stand.`
            : `Cracks your best lineup in only ${startWeeks} of ${opts.weeksConsidered} remaining weeks.`,
        tone: "bad",
      });
    } else {
      notes.push({
        label: "Rotational",
        detail: `Cracks your best lineup in ${startWeeks} of ${opts.weeksConsidered} remaining weeks, so he helps some weeks and sits others.`,
        tone: "neutral",
      });
    }
  }

  if (asset.isInactive) {
    notes.push({
      label: "Cannot start",
      detail: incoming
        ? "On IR or the taxi squad, so he cannot fill a starting slot until that changes."
        : "On IR or the taxi squad, so you are not losing anything from your lineup this week.",
      tone: incoming ? "bad" : "good",
    });
  }

  /**
   * What his position does without him, or with him.
   *
   * The one thing that answers "is this good or bad for MY team" about a player
   * on his way out, where there are no start counts to read: the model measures
   * the lineup with him gone, not the weeks he used to fill. Only fires when he
   * is the sole piece at his position in the trade, so the number is his.
   */
  if (opts.positionDelta !== null && !opts.noLineup) {
    const delta = opts.positionDelta;
    if (Math.abs(delta) < POSITION_NOISE) {
      notes.push({
        label: incoming ? "No lineup gain" : "Not missed",
        detail: incoming
          ? `Your ${asset.position} starters come out where they already were, so what he adds is depth rather than points.`
          : `Your ${asset.position} starters come out where they already were. You have the cover for this.`,
        tone: incoming ? "neutral" : "good",
      });
    } else {
      notes.push({
        label: delta > 0 ? `${asset.position} gets better` : `${asset.position} gets worse`,
        detail: `Your ${asset.position} starters ${delta > 0 ? "gain" : "lose"} ${Math.abs(delta).toFixed(1)} points a week.`,
        tone: delta > 0 ? "good" : "bad",
      });
    }
  }

  // What the deal is actually about.
  const role = roleOf(share, opts.sideCount, opts.isLargest);
  if (role === "centrepiece" && opts.sideCount > 1) {
    notes.push({
      label: incoming ? "The piece you want" : "The piece you pay",
      detail: `${Math.round(share * 100)} percent of ${incoming ? "what you receive" : "what you send"} is him.`,
      tone: "neutral",
    });
  } else if (role === "filler") {
    notes.push({
      label: "Throw-in",
      detail: `${Math.round(share * 100)} percent of ${incoming ? "what you receive" : "what you send"}. He is not what this deal is about.`,
      tone: "neutral",
    });
  }

  // Age only where age is a currency. In redraft it is a fact about a person
  // rather than a fact about an asset.
  if (opts.isDynasty && asset.age !== null) {
    if (asset.age <= 24) {
      notes.push({
        label: "Young",
        detail: `${asset.age.toFixed(1)} years old, so most of his value is still in front of him.`,
        tone: incoming ? "good" : "bad",
      });
    } else if (asset.age >= 29) {
      notes.push({
        label: "Ageing",
        detail: `${asset.age.toFixed(1)} years old, so he is worth more to a team winning now than to one waiting.`,
        tone: incoming ? "bad" : "good",
      });
    }
  }

  return { role, share, startWeeks, notes };
}

/**
 * One line naming the asset's headline number, for the card's subhead.
 *
 * Kept separate from the notes because it is the same three figures for every
 * asset and belongs in a fixed position, where the eye can compare one card
 * against the next without reading.
 */
export function assetFigures(asset: ResolvedAsset): string[] {
  const figures = [`${fmtValue(asset.value)} value`];
  if (asset.kind === "player") {
    figures.push(
      asset.projPoints !== null
        ? `${asset.projPoints.toFixed(1)} pts/wk`
        : "no projection",
    );
    if (asset.age !== null) figures.push(`age ${asset.age.toFixed(1)}`);
  }
  return figures;
}

/** Sort a side so the piece the deal is about reads first. */
export function byImportance(a: ResolvedAsset, b: ResolvedAsset): number {
  return b.value - a.value;
}

/** The reader's own start-weeks map, defaulted so callers need no guard. */
export function startWeeksOf(mine: TeamImpact): Record<string, number> {
  return mine.incomingStartWeeks ?? {};
}
