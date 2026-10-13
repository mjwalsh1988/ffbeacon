/**
 * The jokes a waiver or free agent post is made of.
 *
 * Every line here is pinned to a fact ./waiver-fit.ts measured against the
 * claiming roster: does the new player start, how often, how many points a week
 * the move is worth, whether he is covering a bye or an injury, whether the
 * player who was cut had been starting. The verdict follows the fact, so a
 * claim that walks into the lineup gets the credit and a claim that will never
 * leave the bench gets the roast, whatever the seed happens to draw.
 *
 * Same rules as ./commentary.ts: hand-written, chosen by a seeded draw, never
 * generated; players never get a pronoun; every bank keeps a heat-0 line so the
 * snark dial still produces a plain sentence at zero.
 *
 * Pure: takes plain data, returns sentences.
 */

import { say } from "./commentary";
import type { WaiverFit } from "./waiver-fit";
import type { Line, Voice } from "./voice";

/** A move is a real lineup change at or above this many points a week. */
export const REAL_GAIN = 1;
/** A move made the lineup worse at or beyond this many points a week. */
export const REAL_LOSS = 0.5;

const pts = (n: number): string => Math.abs(n).toFixed(1);

/* -------------------------------------------------------------------------- */
/* What the arrival does for the roster                                       */
/* -------------------------------------------------------------------------- */

/**
 * He starts this week because a regular has no projection this week. That is
 * nearly always a bye, but a missing projection is not proof of one, so no line
 * says "bye". Vars: name, player, starter.
 */
export const COVER_ABSENT: Line[] = [
  { heat: 0, text: "With {starter} not projected to play this week, {player} goes straight into {name}'s lineup." },
  { heat: 0.3, text: "{starter} is not projected to play this week, so {player} gets the start for {name}. Planning ahead: rare, and appreciated." },
  { heat: 0.5, text: "{name} saw the {starter}-shaped hole in this week's lineup and actually filled it, which already puts {name} ahead of half this league." },
  { heat: 0.7, text: "{starter} is off the board this week and {name} had a plan for it. Write the date down. It may not happen again." },
];

/** He starts this week because a regular is listed as out. Vars: name, player, starter, status. */
export const COVER_INJURY: Line[] = [
  { heat: 0, text: "With {starter} listed as {status}, {player} steps into {name}'s lineup this week." },
  { heat: 0.3, text: "{starter} is listed as {status}, and {name} had the replacement lined up before the injury report finished loading." },
  { heat: 0.5, text: "{starter} is {status}. {name} did not panic, did not refresh the app forty times, and just fixed it. Allegedly." },
  { heat: 0.7, text: "{starter} is listed as {status} and {name} has already moved on. Cold, but correct." },
];

/** He starts most of the window and the lineup is better for it. Vars: name, player, starts, weeks, gain. */
export const ADD_STARTER: Line[] = [
  { heat: 0, text: "{player} starts for {name} in {starts} of the next {weeks} weeks, adding about {gain} points a week to the best lineup." },
  { heat: 0.3, text: "{player} walks straight into {name}'s lineup, worth about {gain} points a week. A real upgrade, off the wire, in this league." },
  { heat: 0.4, text: "{name} found {gain} extra points a week lying on the waiver wire. Everybody else walked right past it." },
  { heat: 0.6, text: "{player} starts {starts} of the next {weeks} weeks for {name}, about {gain} points a week better than what was there. Somebody on that roster just got demoted and nobody has told them." },
  { heat: 0.8, text: "{name} upgraded the lineup by {gain} points a week from the free pile. Every other manager in here is now pretending they were about to make that claim." },
];

/** He starts some of the window. Vars: name, player, starts, weeks. */
export const ADD_PART_TIME: Line[] = [
  { heat: 0, text: "{player} cracks {name}'s best lineup in {starts} of the next {weeks} weeks." },
  { heat: 0.3, text: "{player} starts {starts} of the next {weeks} weeks for {name}. Part-time help, priced accordingly, hopefully." },
  { heat: 0.5, text: "{player} is a spot starter for {name}, {starts} of the next {weeks} weeks. A substitute teacher with a helmet." },
];

/** He starts none of the window. Vars: name, player, weeks. */
export const ADD_BENCH: Line[] = [
  { heat: 0, text: "{player} does not make {name}'s best lineup in any of the next {weeks} weeks." },
  { heat: 0.3, text: "{player} starts zero of the next {weeks} weeks for {name}. Bench depth, which is the polite word for it." },
  { heat: 0.4, text: "On {name}'s roster, {player} is not starting in any of the next {weeks} weeks. A spare tyre in a jersey." },
  { heat: 0.6, text: "{name} added {player}, who is projected to start for exactly nobody, {name} included, for the next {weeks} weeks." },
  { heat: 0.8, text: "{player} will not start a single one of the next {weeks} weeks for {name}. That is not a pickup, that is a collectible." },
];

/** The same, in a league where a stash is a legitimate plan. Vars: name, player, weeks. */
export const ADD_STASH: Line[] = [
  { heat: 0, text: "{player} does not start for {name} in the next {weeks} weeks, so this one is a stash." },
  { heat: 0.4, text: "{player} is a stash for {name}, with no starts in the next {weeks} weeks. In a dynasty league that is called patience." },
  { heat: 0.6, text: "{name} is stashing {player}, who starts in none of the next {weeks} weeks. Dynasty managers call this vision. Everybody else calls it a roster spot." },
];

/** The move left the best lineup weaker. Vars: name, loss. */
export const MADE_WORSE: Line[] = [
  { heat: 0, text: "After the drop, {name}'s best lineup is about {loss} points a week weaker." },
  { heat: 0.3, text: "{name} made a move and the lineup got {loss} points a week worse. That is the opposite of how this works." },
  { heat: 0.5, text: "After this move {name}'s best lineup is {loss} points a week lighter. Somebody got worse on purpose, in public." },
  { heat: 0.8, text: "{name} is {loss} points a week worse after this. The waiver wire is a shop, not a donation bin." },
];

/** The arrival went straight to IR or the taxi squad. Vars: name, player. */
export const PARKED: Line[] = [
  { heat: 0, text: "{player} goes straight onto {name}'s injured reserve or taxi squad, so there is no lineup help yet." },
  { heat: 0.4, text: "{player} joins {name} and heads directly to IR or the taxi squad. A signing that starts with a lie-down." },
  { heat: 0.7, text: "{name} picked up {player} and immediately parked the new arrival out of the lineup. Buying a car to keep in the garage." },
];

/* -------------------------------------------------------------------------- */
/* What left                                                                  */
/* -------------------------------------------------------------------------- */

/** A starter was cut and the lineup paid for it. Vars: name, dropped, dstarts, weeks. */
export const DROP_STARTER_HURT: Line[] = [
  { heat: 0, text: "{dropped} was starting for {name} in {dstarts} of the next {weeks} weeks and is now gone." },
  { heat: 0.4, text: "{name} cut {dropped}, a starter in {dstarts} of the next {weeks} weeks. The lineup noticed, even if {name} did not." },
  { heat: 0.7, text: "{name} released {dropped}, who was in the lineup {dstarts} of the next {weeks} weeks. Firing a starter to hire a backup is a bold management style." },
];

/** A starter was cut and the lineup still came out ahead. Vars: name, dropped, dstarts, weeks. */
export const DROP_STARTER_FINE: Line[] = [
  { heat: 0, text: "{name} cut {dropped}, a starter in {dstarts} of the next {weeks} weeks, and the lineup still comes out ahead." },
  { heat: 0.4, text: "{dropped} was starting for {name} and got cut anyway, because the replacement is better. Ruthless, and right." },
  { heat: 0.7, text: "{name} benched {dropped} straight off the roster and improved. No farewell tour, no regrets." },
];

/** A starter was cut and the lineup is about level. Vars: name, dropped, dstarts, weeks. */
export const DROP_STARTER_EVEN: Line[] = [
  { heat: 0, text: "{name} cut {dropped}, a starter in {dstarts} of the next {weeks} weeks, and the lineup comes out about level." },
  { heat: 0.4, text: "{dropped} was starting for {name} and is now gone, replaced by roughly the same output. A lateral move, with paperwork." },
];

/** An occasional starter was cut. Vars: name, dropped, dstarts, weeks. */
export const DROP_PART: Line[] = [
  { heat: 0, text: "{dropped} would only have started {dstarts} of the next {weeks} weeks for {name}." },
  { heat: 0.4, text: "{name} cut {dropped}, an occasional starter at {dstarts} of {weeks} weeks. Nobody is lighting a candle." },
];

/** A bench player was cut. Vars: name, dropped, weeks. */
export const DROP_BENCH: Line[] = [
  { heat: 0, text: "{dropped} goes the other way, and was not starting for {name} anyway." },
  { heat: 0.4, text: "Out goes {dropped}, who was not starting in any of the next {weeks} weeks. Nobody will notice, including {dropped}." },
  { heat: 0.7, text: "{name} cut {dropped}, a bench player with no starts coming. The roster spot will be missed more than the player." },
];

/* -------------------------------------------------------------------------- */
/* What it cost                                                               */
/* -------------------------------------------------------------------------- */

/** A big bid that bought a starter. Vars: name, bid. */
export const BIG_BID_STARTER: Line[] = [
  { heat: 0, text: "{bid} is a lot, but it bought a starter." },
  { heat: 0.4, text: "{bid} is real money, and for once it bought something that plays on Sunday." },
  { heat: 0.6, text: "{name} paid {bid} and got a starter for it. Expensive, defensible, and still going to be mocked." },
];

/** A big bid that bought nobody who starts. Vars: name, bid. */
export const BIG_BID_BENCH: Line[] = [
  { heat: 0, text: "{bid} is a lot to spend on a player who is not starting." },
  { heat: 0.3, text: "{name} spent {bid} on a bench player. That budget is not coming back." },
  { heat: 0.5, text: "{bid} for somebody who will not start. {name} could have set that money on fire and at least been warm." },
  { heat: 0.7, text: "{name} paid {bid} for a backup. Somewhere an accountant felt a disturbance." },
  { heat: 0.9, text: "{bid} for a player who sits. {name} should be banned from the waiver screen for their own safety." },
];

/** A big bid on a fill-in for a missing starter. Vars: name, bid. */
export const BIG_BID_COVER: Line[] = [
  { heat: 0, text: "{bid} is a lot for a fill-in, though the hole was real." },
  { heat: 0.4, text: "{bid} for cover is steep. The hole was real; the price was enthusiastic." },
  { heat: 0.6, text: "{name} paid {bid} to plug one gap. Emergency rates apply, apparently." },
];

/** A fill-in for little or nothing. Vars: name, bid. */
export const CHEAP_COVER: Line[] = [
  { heat: 0, text: "Cover {bid}, which is the right price for it." },
  { heat: 0.4, text: "A fill-in {bid}. Sensible, cheap, and therefore suspicious." },
];

/** A starter for little or nothing. Vars: name, bid. */
export const STEAL: Line[] = [
  { heat: 0, text: "A starter {bid}, which is good value." },
  { heat: 0.3, text: "A starter {bid}. That is theft, and it is legal." },
  { heat: 0.5, text: "{name} got a starter {bid} while everybody else was busy overbidding on names." },
];

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

/** How the arrival fits, in one word. The digest tags and the cost lines key off it. */
export type FitKind = "cover" | "starter" | "part" | "bench" | "worse" | "parked" | "unknown";

/**
 * The single verdict on a move. WORSE wins over everything, because a move
 * that costs points is the story whatever else is true; PARKED next, because a
 * player on IR is not going to start whatever his projection says.
 */
export function fitKind(fit: WaiverFit | null | undefined, parked: string[] = []): FitKind {
  if (fit && fit.lineupDelta <= -REAL_LOSS) return "worse";
  if (!fit?.lead && parked.length > 0) return "parked";
  if (!fit?.lead) return "unknown";
  if (fit.cover) return "cover";
  const { starts } = fit.lead;
  if (starts === 0) return "bench";
  // Two of every three weeks, in integers, so a 2-of-3 player in the usual
  // three-week window counts. Math.ceil(3 * 0.67) is 3, which silently made
  // that impossible.
  if (fit.lead.startsThisWeek && starts * 3 >= fit.weeksConsidered * 2 && fit.lineupDelta >= REAL_GAIN) {
    return "starter";
  }
  return "part";
}

/** The arrival and departure lines for one move, most important first. */
export function wireFitLines(
  voice: Voice,
  opts: {
    name: string;
    fit: WaiverFit | null | undefined;
    parked: string[];
    /** True in dynasty and keeper leagues, where a stash is a plan. */
    isDynasty: boolean;
  },
): { arrival: string[]; departure: string | null } {
  const { name, fit, parked } = opts;
  const arrival: string[] = [];
  const kind = fitKind(fit, parked);
  const weeks = String(fit?.weeksConsidered ?? 0);

  if (fit?.lead) {
    const vars = {
      name,
      player: fit.lead.name,
      starts: String(fit.lead.starts),
      weeks,
      gain: pts(fit.lineupDelta),
      starter: fit.cover?.name ?? "",
      status: fit.cover?.status ?? "",
    };
    const bank =
      kind === "cover"
        ? fit.cover?.reason === "absent"
          ? COVER_ABSENT
          : COVER_INJURY
        : kind === "starter"
          ? ADD_STARTER
          : fit.lead.starts === 0
            ? opts.isDynasty
              ? ADD_STASH
              : ADD_BENCH
            : ADD_PART_TIME;
    const line = say(voice, bank, vars);
    if (line) arrival.push(line);
  }
  for (const player of parked) {
    const line = say(voice, PARKED, { name, player });
    if (line) arrival.push(line);
  }
  if (fit && kind === "worse") {
    const line = say(voice, MADE_WORSE, { name, loss: pts(fit.lineupDelta) });
    if (line) arrival.push(line);
  }

  let departure: string | null = null;
  if (fit?.droppedStarter) {
    const vars = {
      name,
      dropped: fit.droppedStarter.name,
      dstarts: String(fit.droppedStarter.starts),
      weeks,
    };
    // "A starter" only for two of every three weeks, "hurt" only for a real
    // loss and "still ahead" only for a real gain; anything between is level.
    const bank =
      fit.droppedStarter.starts * 3 < fit.weeksConsidered * 2
        ? DROP_PART
        : fit.lineupDelta <= -REAL_LOSS
          ? DROP_STARTER_HURT
          : fit.lineupDelta > 0
            ? DROP_STARTER_FINE
            : DROP_STARTER_EVEN;
    departure = say(voice, bank, vars);
  }
  return { arrival, departure };
}

/**
 * The bench-only drop line, used by the writeup when a departure had no starts
 * in the window. Kept apart so the caller can name the player it already knows.
 */
export function benchDropLine(voice: Voice, name: string, dropped: string, weeks: number): string | null {
  return say(voice, DROP_BENCH, { name, dropped, weeks: String(weeks) });
}

/** One short tag for a move in the digest list. Null when we know nothing. */
const DIGEST_TAGS: Record<Exclude<FitKind, "unknown">, Line[]> = {
  cover: [
    { heat: 0, text: "Covers a starter this week." },
    { heat: 0.4, text: "Emergency cover, and sensible." },
  ],
  starter: [
    { heat: 0, text: "Starts right away." },
    { heat: 0.4, text: "Straight into the lineup." },
    { heat: 0.6, text: "An actual upgrade. Write it down." },
  ],
  part: [
    { heat: 0, text: "Spot starter." },
    { heat: 0.4, text: "Starts some weeks, sits others." },
  ],
  bench: [
    { heat: 0, text: "Bench only." },
    { heat: 0.4, text: "Bench decoration." },
    { heat: 0.6, text: "Will not start. Anywhere." },
  ],
  worse: [
    { heat: 0, text: "Lineup gets weaker." },
    { heat: 0.4, text: "Made the team worse, somehow." },
    { heat: 0.7, text: "Net loss. Impressive, in a way." },
  ],
  parked: [
    { heat: 0, text: "Straight to IR or taxi." },
    { heat: 0.4, text: "Parked before unpacking." },
  ],
};

export function digestTag(voice: Voice, fit: WaiverFit | null | undefined, parked: string[] = []): string | null {
  const kind = fitKind(fit, parked);
  if (kind === "unknown") return null;
  return voice.pick(DIGEST_TAGS[kind]);
}

/** The best move of a run. Vars: name, player, gain. */
export const BEST_MOVE: Line[] = [
  { heat: 0, text: "Best move of the run: {player} to {name}, worth about {gain} points a week to the lineup." },
  { heat: 0.4, text: "Move of the morning goes to {name}: {player}, about {gain} points a week better than what was there." },
  { heat: 0.6, text: "{name} won the wire with {player}, a {gain} point weekly upgrade. Everybody else just shopped." },
];

/** The worst move of a run: money spent on a non-starter. Vars: name, player, bid, weeks. */
export const WORST_BID: Line[] = [
  { heat: 0, text: "Most expensive bench add: {name} paid {bid} for {player}, who starts in none of the next {weeks} weeks." },
  { heat: 0.4, text: "{name} paid {bid} for {player}, who will not start in any of the next {weeks} weeks. The receipt has been kept for evidence." },
  { heat: 0.7, text: "Worst money of the run: {bid} from {name} for {player}, a player with zero starts coming. Frame the receipt." },
];

/** The worst move of a run: the lineup got weaker. Vars: name, loss. */
export const WORST_LOSS: Line[] = [
  { heat: 0, text: "{name}'s move leaves the lineup about {loss} points a week weaker, the worst of the run." },
  { heat: 0.4, text: "Special mention to {name}, whose move costs the lineup {loss} points a week. Going backwards takes effort." },
  { heat: 0.7, text: "{name} somehow left the wire {loss} points a week worse off. Most people come out of a shop with more than they went in with." },
];
