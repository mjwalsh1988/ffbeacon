/**
 * Plain-English reasoning for the two draft-signal cards.
 *
 * The recommendation engine in recommend.ts decides WHO. This module says WHY,
 * in the words a person would use out loud, and it is deliberately separate for
 * two reasons.
 *
 * First, the engine is a scorer. Every sentence here needs facts the scorer
 * never sees: the player's real positional finishes, the market's ADP, how many
 * picks the drafter waits, which starter a pick would displace. Threading all of
 * that back through recommend() would turn a numeric function into a copywriter.
 *
 * Second, copy is the part most likely to change. Keeping it pure and in one
 * file means a wording pass is a diff in one place, and every sentence is
 * testable without a draft room.
 *
 * RULES THE COPY FOLLOWS
 *  - Name the number. "Fills a need" is an assertion; "adds 4.2 points a week to
 *    your starters" is something the reader can check against the board above it.
 *  - Never claim what we did not measure. A missing projection produces no
 *    sentence about points, not a sentence about zero points. A one-week sample
 *    produces no verdict, because one week is not evidence.
 *  - Never claim what we measured about something else. A projection outage is a
 *    fact about us, and saying "nobody projects him" would blame the player for it.
 *  - Call the league what it is. Dynasty, keeper, and one-year leagues are three
 *    different games, and a drafter who is told they are in the wrong one stops
 *    believing the rest of the card.
 *  - Write for the ear first. This product is read aloud more than it is read.
 *    That means no parenthetical asides, no jargon without its translation, and
 *    the verb early enough that a 20-word subject never has to be held in memory.
 *  - Say the downside. The caveat line is not decoration: a room that only ever
 *    argues for the pick is a room nobody trusts twice.
 */

import type { RankedPlayer } from "./board-types";
import type { MarginalResult } from "./marginal";
import type { BuildMode, KeeperStyle } from "./types";
import { youthScore } from "./recommend";

/**
 * Which lens a point is arguing from. The UI maps this to an icon and an accent;
 * it is never the only channel, because every point also carries its own title.
 */
export type RationaleTone = "value" | "lineup" | "timing" | "build" | "track";

export interface RationalePoint {
  /** Stable key for React and for tests. */
  id: string;
  tone: RationaleTone;
  /** Short card heading, sentence case. */
  title: string;
  /** One or two plain sentences. Already phrased for a screen reader. */
  body: string;
}

/** One season-end positional finish, newest first when listed. */
export interface SeasonFinish {
  season: number;
  /** 1 means he was the best scorer at his position that season. */
  finish: number;
  /** How many players at the position were ranked, for the "of 78" context. */
  playersRanked: number;
}

export interface RationaleInput {
  kind: "best" | "need";
  player: RankedPlayer;
  /** The marginal starting-lineup result for this player, when points ran. */
  marginal?: MarginalResult | null;
  mode: BuildMode;
  engine: "points" | "heuristic";
  /**
   * False when the projection service returned nothing for ANYONE. Distinct from
   * a single player having no projection row, and the two get different copy:
   * one is our outage, the other is a fact about him.
   */
  projectionsAvailable: boolean;
  /** Slot label this pick fills ("RB", "Flex", "Superflex"), or null. */
  filledSlot: string | null;
  /** Every still-open starting slot, most needed first, as display labels. */
  openSlots: string[];
  /** Selections before the drafter is back on the clock. Null when unknown. */
  picksUntilNext: number | null;
  /** The starter this pick would push to the bench, when there is one. */
  displacedName: string | null;
  /** Neutral band, in picks, for the market comparison. */
  adpThreshold: number;
  /** Season finishes for this player, newest first. */
  finishes: SeasonFinish[];
  /** The league's actual shape. See LeagueShape. */
  league: LeagueShape;
  /** False when we could not attribute a roster, which mutes lineup claims. */
  rosterKnown: boolean;
}

/**
 * What kind of league this actually is, so the copy can name it correctly.
 *
 * This exists because a boolean did not. The card used to take `isDynasty` and
 * write "This is a keeper league" whenever it was true, which told every dynasty
 * drafter their league was something it is not. Dynasty and keeper are different
 * formats with different reasons to draft a 23-year-old, and the words are not
 * interchangeable.
 *
 * `superflex` and `tep` come from the recommendation engine rather than from a
 * slug test, because a league carrying a SUPER_FLEX slot is superflex even when
 * the closest FF Beacon format we could match it to is not.
 */
export interface LeagueShape {
  /**
   * How long the league carries players, from Sleeper's own league type via
   * deriveKeeperStyle. NOT the format slug's league_type: that one folds keeper
   * into redraft because keeper leagues PRICE off the one-year board, and
   * reusing it here is what let the card call a keeper league a one-year league.
   */
  type: KeeperStyle;
  /** True when the league starts a second quarterback. */
  superflex: boolean;
  /** True when the league pays a tight end premium. */
  tep: boolean;
}

/** How many argument cards a single spotlight will ever show. */
export const MAX_RATIONALE_POINTS = 4;

/**
 * Graded weeks below which we will state a rate but not a verdict about it.
 * A player who beat his projection in his only graded week has not shown us
 * anything, and "beats his projection 100% of the time" is a sentence that
 * would follow him around the draft board for the rest of the night.
 */
export const MIN_ACCURACY_WEEKS_FOR_VERDICT = 4;

/**
 * The youth score (0 to 100, position-adjusted, from the recommendation engine)
 * at or above which we are willing to call a player young out loud. Reusing the
 * engine's own curve keeps the copy and the scoring from disagreeing about who
 * counts as an ascending asset.
 */
const YOUNG_ENOUGH = 55;

// ---------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------

const POS_WORD: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
};

const POS_PLURAL: Record<string, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

function posWord(position: string): string {
  return POS_WORD[position] ?? "player";
}

function posPlural(position: string): string {
  return POS_PLURAL[position] ?? "players";
}

function points(n: number): string {
  const v = Math.abs(n);
  return `${v.toFixed(1)} ${v === 1 ? "point" : "points"}`;
}

function picks(n: number): string {
  const v = Math.round(Math.abs(n));
  return `${v} ${v === 1 ? "pick" : "picks"}`;
}

function weeks(n: number): string {
  return `${n} graded ${n === 1 ? "week" : "weeks"}`;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** "4th", "21st". Spoken correctly, unlike "RB4". */
function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "RB4, RB9, and RB21" for a list of parts. */
function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** A usable ADP, or null. Zero and NaN are absences, not draft slots. */
function usableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Whole years, because "twenty three point four years old" is a spreadsheet. */
function ageYears(player: RankedPlayer): number | null {
  const age = player.ageDecimal ?? player.age;
  return typeof age === "number" && Number.isFinite(age) ? Math.round(age) : null;
}

/**
 * The starter count that counts as "top of the position" for this bucket. A
 * top-12 receiver season and a top-12 quarterback season are not the same
 * achievement, because a 12-team league starts three of one and one of the other.
 */
const STARTER_DEPTH: Record<string, number> = {
  QB: 12,
  RB: 24,
  WR: 36,
  TE: 12,
  K: 12,
  DEF: 12,
};

/** Seasons of history a single argument will ever reason over. */
export const FINISH_SEASONS_CITED = 3;

// ---------------------------------------------------------------------------
// Individual points
// ---------------------------------------------------------------------------

/** Why our board likes him, and what the market thinks of the same player. */
function valuePoint(input: RationaleInput): RationalePoint {
  const p = input.player;
  const board = `FF Beacon values him at ${p.value.toLocaleString()}, which makes him the ${ordinal(
    p.positionRank,
  )} ranked ${posWord(p.position)} on our board and a tier ${p.tier} player.`;

  const market = marketSentence(input);
  return {
    id: "value",
    tone: "value",
    title: "Why he is worth the pick",
    body: market ? `${board} ${market}` : board,
  };
}

/**
 * Our price against the room's price. Prefers beacon_pick (already on the
 * market's own pick scale) over overall rank, because comparing a cross-position
 * value rank to a scarcity-priced ADP is how you end up recommending six
 * quarterbacks in the first round of a single-QB league.
 */
function marketSentence(input: RationaleInput): string | null {
  const adp = usableNumber(input.player.adp);
  const beaconPick = usableNumber(input.player.beaconPick);
  if (adp === null) return null;
  if (beaconPick === null) return `Most rooms take him around pick ${Math.round(adp)}.`;

  const gap = adp - beaconPick;
  const band = Math.max(1, input.adpThreshold);
  if (gap >= band) {
    return `You are getting him ${picks(
      gap,
    )} later than he is worth: most rooms take him around pick ${Math.round(
      adp,
    )} and our board takes him at ${Math.round(beaconPick)}.`;
  }
  if (gap <= -band) {
    return `You are paying up for him. Most rooms take him around pick ${Math.round(
      adp,
    )}, which is ${picks(gap)} earlier than our board takes him.`;
  }
  return `The market takes him around pick ${Math.round(
    adp,
  )}, right about where our board does, so this is a fair price rather than a bargain.`;
}

/** What the pick actually does to the lineup the drafter starts on Sunday. */
function lineupPoint(input: RationaleInput): RationalePoint | null {
  const p = input.player;
  const m = input.marginal ?? null;
  const title = "What he does for your lineup";

  if (!input.rosterKnown) {
    return {
      id: "lineup",
      tone: "lineup",
      title: "About your lineup",
      body: "We cannot see your team yet, so this call is about the player rather than your roster. Make a pick, or check the Sleeper username you connected, and we will tailor it.",
    };
  }

  if (m) {
    if (m.driver === "upgrade" && input.displacedName && m.startingAdd > 0.05) {
      return {
        id: "lineup",
        tone: "lineup",
        title,
        body: join(
          `He starts over ${input.displacedName} from day one and lifts your weekly starting total by about ${points(
            m.startingAdd,
          )}.`,
          startsLine(m),
        ),
      };
    }
    if (m.driver === "starter" && m.startingAdd > 0.05) {
      return {
        id: "lineup",
        tone: "lineup",
        title,
        body: join(
          `He walks straight into a starting spot and adds about ${points(
            m.startingAdd,
          )} a week you are not getting from anyone else you own.`,
          startsLine(m),
        ),
      };
    }
    if (m.driver === "insurance" && m.insuranceAdd > 0.05) {
      const ahead = input.displacedName ?? `the starter ahead of him`;
      return {
        id: "lineup",
        tone: "lineup",
        title,
        body: `Your ${posWord(
          p.position,
        )} spot is already covered, so he starts on your bench. If ${ahead} misses time he is worth about ${points(
          m.insuranceAdd,
        )} a week, which is exactly what a bench spot is for.`,
      };
    }
  }

  if (input.filledSlot) {
    return {
      id: "lineup",
      tone: "lineup",
      title,
      body: `He fills your open ${input.filledSlot} spot. That is a starting slot you have to cover before this draft ends, and covering it with the best player available beats reaching for it later.`,
    };
  }

  if (input.openSlots.length > 0) {
    return {
      id: "lineup",
      tone: "lineup",
      title,
      body: `He does not fill a hole for you. You still need ${joinList(
        input.openSlots.slice(0, 3),
      )}, but he is far enough ahead of everyone who does fill those that taking him now and covering them later is the better trade.`,
    };
  }

  return {
    id: "lineup",
    tone: "lineup",
    title,
    body: "Your starting lineup is already covered, so this pick is about the asset rather than this week's points. He is the best of what is left.",
  };
}

/** How many of the remaining weeks he actually starts, when we measured it. */
function startsLine(m: MarginalResult): string {
  if (m.weeksStarting <= 0 || m.weeksConsidered <= 0) return "";
  return `We have him in your starting lineup in ${m.weeksStarting} of the ${m.weeksConsidered} weeks left.`;
}

/** Join sentence fragments without leaving a trailing space when one is empty. */
function join(...parts: string[]): string {
  return parts.filter((s) => s.length > 0).join(" ");
}

/** The cost of passing: who survives to your next pick, and by how much worse. */
function timingPoint(input: RationaleInput): RationalePoint | null {
  const p = input.player;
  const m = input.marginal ?? null;
  const until = input.picksUntilNext;
  const title = "What waiting would cost you";

  if (m && m.dropoffEdge > 0.1) {
    const survivor =
      until !== null && until > 0
        ? `the best ${posWord(p.position)} we expect to survive the ${picks(
            until,
          )} before you are back up`
        : `the best ${posWord(p.position)} we expect to still be there next time you pick`;
    return {
      id: "timing",
      tone: "timing",
      title,
      body: `Waiting costs you about ${points(
        m.dropoffEdge,
      )} a week. That is the gap between him and ${survivor}.`,
    };
  }

  if (until !== null && until >= 4) {
    return {
      id: "timing",
      tone: "timing",
      title,
      body: `${picks(
        until,
      )} come off the board before you are up again, so treat anyone you pass on now as gone.`,
    };
  }

  return null;
}

/**
 * What this league's own shape does to this particular player's price. Only
 * returns a sentence when the format actually changes something about HIM: a
 * superflex note on a running back is noise, and the same note on a quarterback
 * is the whole reason he is on the card.
 */
function formatSentence(input: RationaleInput): string {
  const pos = input.player.position;
  // Only the superflex line opens on "This league". The other two deliberately
  // do not, because they follow a league sentence that already did, and two
  // sentences running with the same subject noun and the same "X, so Y" shape
  // drone when they are heard rather than read.
  if (pos === "QB" && input.league.superflex) {
    return " This league starts a second quarterback, so quarterbacks are scarcer here than in a normal league and the startable ones go early.";
  }
  if (pos === "TE" && input.league.tep) {
    return " Tight end premium is in play here, so his catches count for more than a standard league would give him.";
  }
  // The one-quarterback note argues AGAINST spending here, so it is confined to
  // Best Available. On a Team Need card that named quarterback as the open slot,
  // the lineup point one card over has just told the reader to cover it, and two
  // cards arguing opposite sides of the same pick is worse than one card short.
  if (pos === "QB" && !input.league.superflex && input.kind === "best") {
    return " Only one quarterback starts here, so you need one good one and the position is the easiest on the board to fill late.";
  }
  return "";
}

/**
 * Why this player suits this league and the way this drafter is building.
 *
 * Budgeted for the ear. Every branch is at most three sentences, and the
 * projection line is dropped whenever a format sentence already earned its
 * place, because the same number is sitting in a labelled tile a few inches up
 * and a fourth sentence pushes the spoken body past the point where a listener
 * can hold it under a draft clock.
 */
function buildPoint(input: RationaleInput): RationalePoint | null {
  const p = input.player;
  const age = ageYears(p);
  const young = youthScore(p) >= YOUNG_ENOUGH;
  const ppw = usableNumber(p.projPointsPerWeek);
  const format = formatSentence(input);
  // Two sentences, never both. The tile above the card already shows the number.
  const projection =
    format === "" && ppw !== null
      ? ` We project him for ${points(ppw)} a week the rest of the way.`
      : "";
  // A one-year league has no build to fit, so the heading does not claim one.
  const title =
    input.league.type === "dynasty"
      ? "How he fits your league and your build"
      : "How he fits your league";

  // A one-year league has no long game to weigh, and its mode is forced rather
  // than chosen, so it must never be told it "set" anything.
  if (input.league.type === "redraft") {
    return {
      id: "build",
      tone: "build",
      title,
      body: `This is a one-year redraft league, so nothing matters except points between now and your championship week.${format}${projection}`,
    };
  }

  // A keeper league carries a handful of players, not a roster, so we price it
  // off the one-year board and say so rather than pretending either extreme.
  // How many he keeps and who is eligible are rules only the drafter knows.
  if (input.league.type === "keeper") {
    const agePart =
      age !== null && young
        ? ` He is ${age}, so he is worth a keeper slot next year as well as a start this week.`
        : age !== null
          ? ` He is ${age}, so weigh him on this season rather than on how long you could hold him.`
          : "";
    return {
      id: "build",
      tone: "build",
      title,
      body: `This is a keeper league, so we price him on this season and leave the keeper math to you.${agePart}${format}${projection}`,
    };
  }

  if (input.mode === "compete") {
    return {
      id: "build",
      tone: "build",
      title,
      body: `You set this dynasty team to win now, so the board is tilted toward players who score this season rather than assets who pay off later.${format}${projection}`,
    };
  }

  if (input.mode === "rebuild") {
    const agePart =
      age !== null && young
        ? ` He is ${age}, so his best seasons should land while your team is actually good, and his price should climb in the meantime.`
        : age !== null
          ? ` He is ${age}, which is older than a rebuild usually shops for, so he is here on the strength of his value rather than his timeline.`
          : "";
    return {
      id: "build",
      tone: "build",
      title,
      body: `You set this dynasty team to rebuild, so this year's empty starting spots are not the point.${agePart}${format}`,
    };
  }

  const agePart =
    age !== null && young
      ? ` He is ${age}, young enough to still be a starter in a few years.`
      : age !== null
        ? ` He is ${age}, so he is more help this season than he is three seasons from now.`
        : "";
  return {
    id: "build",
    tone: "build",
    title,
    body: `This is a dynasty league and you are building a balanced roster, so we weigh what he does this season against what he is worth in two years.${agePart}${format}${projection}`,
  };
}

/** What he has actually done, as opposed to what a model thinks he will do. */
function trackRecordPoint(input: RationaleInput): RationalePoint | null {
  const p = input.player;
  const parts: string[] = [];

  // Cited seasons and displayed seasons must be the same seasons, or the prose
  // grades a smaller set than the chips beside it show.
  const cited = input.finishes.slice(0, FINISH_SEASONS_CITED);
  if (cited.length > 0) {
    const labels = cited.map(
      (f, i) =>
        i === 0
          ? `${ordinal(f.finish)} among ${posPlural(p.position)} in ${f.season}`
          : `${ordinal(f.finish)} in ${f.season}`,
    );
    parts.push(`He finished ${joinList(labels)}.`);

    const depth = STARTER_DEPTH[p.position] ?? 24;
    const topSeasons = cited.filter((f) => f.finish <= depth).length;
    if (topSeasons === cited.length && cited.length > 1) {
      parts.push(
        `That is a top-${depth} season in every one of them, which is as close to a safe pick as this position gets.`,
      );
    } else if (topSeasons > 0) {
      parts.push(
        `That is ${topSeasons} top-${depth} ${topSeasons === 1 ? "season" : "seasons"} out of ${cited.length}.`,
      );
    } else {
      parts.push(
        "None of those is a starting-caliber season yet, so you are buying what we think he becomes, not what he has been.",
      );
    }
  } else if (p.isRookie) {
    parts.push(
      "He has never played an NFL snap, so there is no track record to lean on. This call is our board and his projection, nothing else.",
    );
  }

  const beatRate = typeof p.beatRate === "number" ? p.beatRate : null;
  if (beatRate !== null) {
    const graded = typeof p.accuracyWeeks === "number" && p.accuracyWeeks > 0 ? p.accuracyWeeks : null;
    const sample = graded ? ` over the ${weeks(graded)} we have on him` : "";
    // A verdict needs a sample. Below the floor we report the rate and stop.
    const enough = graded === null || graded >= MIN_ACCURACY_WEEKS_FOR_VERDICT;
    if (enough) {
      const verdict =
        beatRate >= 0.45
          ? "which is well above average, so his projection is more likely a floor than a ceiling"
          : beatRate <= 0.28
            ? "which is below average, so treat his projection as optimistic"
            : "which is about average for a starter";
      parts.push(`He beats his own weekly projection ${pct(beatRate)} of the time${sample}, ${verdict}.`);
    } else {
      parts.push(
        `He has beaten his own weekly projection ${pct(
          beatRate,
        )} of the time${sample}, which is too small a sample to read anything into yet.`,
      );
    }
  }

  if (parts.length === 0) return null;
  return {
    id: "track",
    tone: "track",
    title: "What he has actually done",
    body: parts.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Caveat
// ---------------------------------------------------------------------------

/**
 * The one thing we would want said back to us before clicking draft. Returns
 * null when there is genuinely nothing to flag, rather than manufacturing doubt.
 *
 * Order matters. The thin-sample check runs BEFORE the rate checks, because a
 * rate computed over three weeks is not evidence of anything and saying so is
 * more useful than repeating the rate with a warning attached.
 */
export function buildCaveat(input: RationaleInput): string | null {
  const p = input.player;
  const graded = typeof p.accuracyWeeks === "number" && p.accuracyWeeks > 0 ? p.accuracyWeeks : null;

  // Our outage, stated as ours. This has to precede the per-player projection
  // check, or a projection service that is down reads as a fact about him.
  if (!input.projectionsAvailable) {
    return "Weekly projections are unavailable right now, so this is value and roster shape rather than points. It gets sharper the moment projections come back.";
  }

  if (graded !== null && graded < MIN_ACCURACY_WEEKS_FOR_VERDICT * 2) {
    return `We only have ${weeks(
      graded,
    )} on him, so read his reliability and availability numbers as a hint rather than a verdict.`;
  }

  const availability = typeof p.availability === "number" ? p.availability : null;
  if (availability !== null && availability < 0.8) {
    return `He has only been on the field for ${pct(
      availability,
    )} of the weeks he was projected to play, so price in some missed time.`;
  }

  if (p.position === "K" || p.position === "DEF") {
    return "Kickers and defenses are close to interchangeable year to year. He is the best one left, but this is the last kind of pick worth spending an early round on.";
  }

  if (usableNumber(p.projPointsPerWeek) === null) {
    return "Nobody publishes a weekly projection for him yet, so this call rests on our board value rather than on points.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build the argument for one card, most persuasive first and capped so the
 * spotlight stays readable under draft-clock pressure.
 *
 * The order differs by card on purpose. Best Available is answering "who is the
 * best player left", so it leads with the board and the market. Team Need is
 * answering "what should MY team do", so it leads with the lineup and the clock.
 *
 * WHY `track` IS LAST ON BOTH. Five points are built and four are shown, so one
 * is always cut in a healthy draft, and the tiebreak is what a reader can find
 * elsewhere on the card. The season-finish strip and the beat-rate tile already
 * show the track record as numbers; the finishes only lose their READING. The
 * build point has no such twin: the league type and the scarcity its format
 * creates appear nowhere else on the page. Ordering `build` below `track` meant
 * the sentence that names a drafter's league was the one that got dropped, on
 * the card most drafters act on.
 */
export function buildRationale(input: RationaleInput): RationalePoint[] {
  const value = valuePoint(input);
  const lineup = lineupPoint(input);
  const timing = timingPoint(input);
  const build = buildPoint(input);
  const track = trackRecordPoint(input);

  const ordered =
    input.kind === "need"
      ? [lineup, timing, build, value, track]
      : [value, build, track, timing, lineup];

  return ordered
    .filter((p): p is RationalePoint => p !== null)
    .slice(0, MAX_RATIONALE_POINTS);
}
