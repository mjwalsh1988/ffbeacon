/**
 * The jokes a matchup post is actually made of.
 *
 * ./takes.ts says which way a line about a MANAGER points. This module is the
 * level below it: what happened to the PLAYERS, and which decisions the
 * manager made around them. The over-performer, the under-performer, the
 * player who scored more on the bench than the starter he sat behind, the
 * kicker who outscored the whole receiving corps. That is the material a person
 * doing commentary on a game reaches for, and it is the material the first
 * newspaper-style version of these posts read out as a list of numbers.
 *
 * THE RULES ARE THE SAME AS ./voice.ts. Every line here is hand-written and
 * chosen by a seeded draw, never generated. Every line is attached to a fact
 * this module checked first, and the fact is in the sentence: a joke about a
 * bust names the projection and the score. A line never claims more than its
 * fact supports, so "lost by less than the bench" only fires when the arithmetic
 * says so, and a single swap is only blamed for the game when that one swap was
 * worth more than the margin.
 *
 * Players are never given a pronoun. A team defense is a player in this data,
 * and "he" on a defense reads as a bug. Managers are named, and "they" where a
 * pronoun cannot be avoided.
 *
 * Pure: takes plain data, returns sentences.
 */

import type { MatchupSide, SchedulePlayer } from "@/lib/league-schedule/types";
import type { Line, Voice } from "./voice";

/** Fill every {key} in a line. Unknown keys are left alone so a test can see them. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

/** Draw a line from a bank and fill it in. Null when the dial allows nothing. */
export function say(voice: Voice, bank: Line[], vars: Record<string, string>): string | null {
  const line = voice.pick(bank);
  return line ? fill(line, vars) : null;
}

const pts = (n: number): string => n.toFixed(1);

/* -------------------------------------------------------------------------- */
/* Facts                                                                      */
/* -------------------------------------------------------------------------- */

/** A starter with a result and, where one was published, a projection. */
interface Scored {
  player: SchedulePlayer;
  slotLabel: string;
  actual: number;
  projected: number | null;
}

function scoredStarters(side: MatchupSide): Scored[] {
  const out: Scored[] = [];
  for (const entry of side.slots) {
    const p = entry.player;
    if (!p || p.actual === null) continue;
    out.push({ player: p, slotLabel: entry.slot.label, actual: p.actual, projected: p.projected });
  }
  return out;
}

/** Beat their projection by at least this much to count as the over-performer. */
export const HERO_MIN_GAIN = 6;
/** Missed by at least this much, from at least this projection, to be the bust. */
export const BUST_MIN_MISS = 6;
export const BUST_MIN_PROJECTION = 8;
/** Below this, a projected starter "scored nothing" rather than "scored badly". */
const ZERO_LINE = 2;

export interface PlayerFact {
  name: string;
  position: string;
  slotLabel: string;
  actual: number;
  projected: number | null;
  /** Actual minus projected. Positive for a hero, negative for a bust. */
  diff: number | null;
}

function toFact(s: Scored): PlayerFact {
  return {
    name: s.player.name,
    position: s.player.position,
    slotLabel: s.slotLabel,
    actual: s.actual,
    projected: s.projected,
    diff: s.projected === null ? null : s.actual - s.projected,
  };
}

/** The starter who beat their projection by the most, if anyone beat it by enough. */
export function overPerformer(side: MatchupSide): PlayerFact | null {
  let best: Scored | null = null;
  for (const s of scoredStarters(side)) {
    if (s.projected === null) continue;
    const gain = s.actual - s.projected;
    if (gain < HERO_MIN_GAIN) continue;
    if (!best || gain > best.actual - (best.projected ?? 0)) best = s;
  }
  return best ? toFact(best) : null;
}

/** The starter who missed their projection by the most, if anyone missed by enough. */
export function underPerformer(side: MatchupSide): PlayerFact | null {
  let worst: Scored | null = null;
  for (const s of scoredStarters(side)) {
    if (s.projected === null || s.projected < BUST_MIN_PROJECTION) continue;
    const miss = s.projected - s.actual;
    if (miss < BUST_MIN_MISS) continue;
    if (!worst || miss > (worst.projected ?? 0) - worst.actual) worst = s;
  }
  return worst ? toFact(worst) : null;
}

/** The starter who scored the most. */
export function topScorer(side: MatchupSide): PlayerFact | null {
  let best: Scored | null = null;
  for (const s of scoredStarters(side)) {
    if (!best || s.actual > best.actual) best = s;
  }
  return best ? toFact(best) : null;
}

/* -------------------------------------------------------------------------- */
/* The result line                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How a recap opens: who won, and the score, with a joke on the margin. Every
 * line states the winner and the final score, so whichever one is drawn the
 * reader has the result in the first sentence. Vars: W, L, wp, lp, margin.
 */
export const RESULT_LINES: Record<"big" | "normal" | "close" | "tie", Line[]> = {
  big: [
    { heat: 0, text: "**{W}** beat **{L}** {wp} to {lp}, a {margin} point win." },
    { heat: 0, text: "Final: **{W}** {wp}, **{L}** {lp}." },
    { heat: 0.3, text: "**{W}** beat **{L}** {wp} to {lp}, and it was over before the late games kicked off." },
    { heat: 0.4, text: "**{W}** {wp}, **{L}** {lp}. A {margin} point margin, which is less a game and more a cry for help." },
    { heat: 0.5, text: "**{W}** hung {wp} on **{L}**, who answered with {lp} and a long, meaningful silence." },
    { heat: 0.6, text: "**{W}** {wp}, **{L}** {lp}. Somebody check whether **{L}** set a lineup or just opened the app and sighed." },
    { heat: 0.7, text: "**{W}** beat **{L}** by {margin}. That is not a margin, that is a restraining order." },
    { heat: 0.8, text: "**{W}** {wp}, **{L}** {lp}. There is no mercy rule in fantasy football, and **{L}** found that out the hard way." },
    { heat: 0.9, text: "**{W}** beat **{L}** {wp} to {lp}. In a boxing match the referee stops this in the second round and calls **{L}**'s family." },
  ],
  normal: [
    { heat: 0, text: "**{W}** beat **{L}** {wp} to {lp}." },
    { heat: 0, text: "Final: **{W}** {wp}, **{L}** {lp}." },
    { heat: 0.3, text: "**{W}** took care of **{L}**, {wp} to {lp}, without breaking much of a sweat." },
    { heat: 0.4, text: "**{W}** {wp}, **{L}** {lp}. Not a blowout, but not the kind of loss you can pin on one bad bounce either." },
    { heat: 0.5, text: "**{W}** beat **{L}** {wp} to {lp}, the fantasy version of a firm handshake and a polite 'better luck next time'." },
    { heat: 0.6, text: "**{W}** beat **{L}** by {margin}. Close enough for **{L}** to talk about it, not close enough for anybody to listen." },
    { heat: 0.7, text: "**{W}** {wp}, **{L}** {lp}. **{L}** stayed in it right up until the part where the points were counted." },
  ],
  close: [
    { heat: 0, text: "**{W}** edged **{L}** {wp} to {lp}." },
    { heat: 0, text: "Final: **{W}** {wp}, **{L}** {lp}, a {margin} point finish." },
    { heat: 0.3, text: "**{W}** got past **{L}** {wp} to {lp}, a margin of roughly one dropped pass." },
    { heat: 0.4, text: "**{W}** {wp}, **{L}** {lp}. That is {margin} points, and somebody's heart rate is still coming down." },
    { heat: 0.5, text: "**{W}** beat **{L}** by {margin}, and **{L}** is already rewatching Monday night looking for someone to blame." },
    { heat: 0.6, text: "**{W}** {wp}, **{L}** {lp}. A {margin} point loss is the worst kind, because suddenly every decision mattered." },
    { heat: 0.7, text: "**{W}** won by {margin}. **{L}** lost by {margin}. One of those sentences hurts a lot more than the other." },
    { heat: 0.8, text: "**{W}** beat **{L}** {wp} to {lp}, a margin so thin that **{L}** is going to refresh the app all week hoping for a stat correction." },
  ],
  tie: [
    { heat: 0, text: "**{W}** and **{L}** tied at {wp}." },
    { heat: 0.3, text: "**{W}** {wp}, **{L}** {lp}. A tie, the one result nobody prepares a speech for." },
    { heat: 0.5, text: "**{W}** and **{L}** both scored {wp}. Three hours of football, and everybody goes home holding half a win." },
    { heat: 0.7, text: "**{W}** and **{L}** tied at {wp}, which is fantasy football's way of saying neither of you deserved it." },
  ],
};

/* -------------------------------------------------------------------------- */
/* Players                                                                    */
/* -------------------------------------------------------------------------- */

/** Over-performer on the WINNING side. Vars: name, player, act, proj, diff. */
export const HERO_ON_WINNER: Line[] = [
  { heat: 0, text: "{player} led the way for {name} with {act} on a {proj} projection." },
  { heat: 0, text: "{player} beat a {proj} projection by {diff} for {name}." },
  { heat: 0.3, text: "{player} turned a {proj} projection into {act}, and {name} will be calling that a calculated start all week." },
  { heat: 0.4, text: "{player} put up {act} against a projection of {proj}. {name} will absolutely be taking credit for that." },
  { heat: 0.5, text: "{player} dropped {act} on a {proj} projection, the kind of start that makes {name} unbearable in the group chat." },
  { heat: 0.5, text: "{name} rode {player} to {act}, {diff} more than anyone predicted, and is now pretending that was the plan." },
  { heat: 0.6, text: "{player} went for {act} when the projection said {proj}. {name} did not see that coming either, and will never admit it." },
  { heat: 0.7, text: "{player} scored {act} on a {proj} projection. Somebody check whether {name} knows something the rest of us do not." },
  { heat: 0.8, text: "{player} gave {name} {act} on a {proj} projection. That is not a breakout, that is a heist with a helmet on." },
];

/** Over-performer on the LOSING side: the one bright spot. Same vars. */
export const HERO_ON_LOSER: Line[] = [
  { heat: 0, text: "{player} did the job for {name}, {act} on a {proj} projection." },
  { heat: 0, text: "{player} beat a {proj} projection by {diff}, which was not enough for {name}." },
  { heat: 0.3, text: "{player} put up {act} for {name}, {diff} over projection, and still took a loss. Somebody owes {player} an apology." },
  { heat: 0.4, text: "{player} scored {act} on a {proj} projection, the only member of {name}'s roster with nothing to apologize for." },
  { heat: 0.5, text: "{player} went for {act} against a {proj} projection and got a loss for the trouble. Wasted on {name}, frankly." },
  { heat: 0.6, text: "{player} cooked up {act} on a {proj} projection and {name} still managed to burn the meal." },
  { heat: 0.7, text: "{player} scored {act}, {diff} over projection, and {name} lost anyway. {player} has grounds to request a trade." },
  { heat: 0.8, text: "{player} put up {act} for {name} and should be filing a formal complaint about the supporting cast." },
];

/** Under-performer on the LOSING side. Vars: name, player, act, proj, miss. */
export const BUST_ON_LOSER: Line[] = [
  { heat: 0, text: "{player} was projected for {proj} and scored {act}." },
  { heat: 0, text: "{player} finished {miss} below a {proj} projection for {name}." },
  { heat: 0.3, text: "{player} was supposed to give {name} {proj} and came back with {act}. That one stings." },
  { heat: 0.4, text: "{name} counted on {proj} from {player} and got {act}. Somewhere a fantasy analyst is quietly deleting a post." },
  { heat: 0.5, text: "{player} put up {act} on a {proj} projection. {name} might want to confirm {player} was actually in uniform." },
  { heat: 0.6, text: "{player} scored {act} when {name} needed {proj}. That is not a slump, that is a disappearing act." },
  { heat: 0.7, text: "{player} gave {name} {act}. The projection said {proj}. The projection was lying to everybody." },
  { heat: 0.8, text: "{player} scored {act} on a {proj} projection, and {name} should be sending an invoice." },
  { heat: 0.9, text: "{player} returned {act} on a {proj} projection. {name} has set better lineups by accident." },
];

/**
 * The loser's bust, when that one miss was bigger than the whole margin. Only
 * drawn when it is arithmetically true. Vars: name, player, act, proj, miss,
 * margin.
 */
export const BUST_COST_GAME: Line[] = [
  { heat: 0, text: "{player} missed a {proj} projection by {miss}, more than the {margin} {name} lost by." },
  { heat: 0.3, text: "{player} came in {miss} under projection with {act}, and {name} lost by {margin}. Do the math." },
  { heat: 0.5, text: "{player} scored {act} on a {proj} projection. {name} lost by {margin}. An average day from {player} wins this game." },
  { heat: 0.7, text: "{name} lost by {margin}, and {player} was {miss} short of projection on their own. {player} is not getting a holiday card." },
];

/** Under-performer on the WINNING side. Vars: name, player, act, proj, miss. */
export const BUST_ON_WINNER: Line[] = [
  { heat: 0, text: "{player} was projected for {proj} and scored {act}, which {name} could afford." },
  { heat: 0, text: "{player} came in {miss} under projection for {name}." },
  { heat: 0.3, text: "{player} gave {name} {act} on a {proj} projection and still gets to call it a team win." },
  { heat: 0.4, text: "{name} won in spite of {player}, who managed {act} on a {proj} projection." },
  { heat: 0.5, text: "{player} scored {act} when {name} needed {proj}. Nobody will mention it, because winning fixes everything." },
  { heat: 0.6, text: "{player} put up {act} on a {proj} projection and got carried to a win like a kid asleep in the back seat." },
  { heat: 0.7, text: "{player} scored {act} for {name}. The projection was {proj}. The rest of the roster would like a word." },
];

/** A projected starter who scored next to nothing, on either side. Vars: name, player, act, proj. */
export const ZERO_LINES: Line[] = [
  { heat: 0, text: "{player} scored {act} for {name} on a {proj} projection." },
  { heat: 0.3, text: "{player} scored {act}. Not a typo. {name} started that on purpose." },
  { heat: 0.4, text: "{player} put up {act} for {name}, which is technically a number." },
  { heat: 0.5, text: "{player} gave {name} {act} on a {proj} projection. A cardboard cutout scores the same and costs less." },
  { heat: 0.6, text: "{name} started {player} and got {act} back. Leaving the slot empty would have been nearly as productive." },
  { heat: 0.8, text: "{player} scored {act} for {name}. Projected for {proj}. Delivered a participation trophy." },
];

/** Top scorer, when nobody beat their projection by enough to be the hero. Vars: name, player, act. */
export const TOP_SCORER_WINNER: Line[] = [
  { heat: 0, text: "{player} led {name} with {act}." },
  { heat: 0.3, text: "{player} carried {name} with {act}." },
  { heat: 0.5, text: "{player} put up {act} and {name} gets to take the credit." },
];

export const TOP_SCORER_LOSER: Line[] = [
  { heat: 0, text: "{player} led {name} with {act}." },
  { heat: 0.4, text: "{player} scored {act}, the best {name} had to offer. Read that again." },
  { heat: 0.6, text: "{name}'s best performer was {player} with {act}, which tells you everything about the rest of it." },
];

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The loser benched a player who outscored a starter by MORE THAN THE MARGIN.
 * One swap wins the game, and that is the cruellest fact in fantasy football.
 * Vars: name, in, inAct, out, outAct, slot, margin.
 */
export const SWAP_LOST_IT: Line[] = [
  { heat: 0, text: "{in} scored {inAct} on {name}'s bench while {out} scored {outAct} at {slot}. {name} lost by {margin}." },
  { heat: 0.3, text: "{name} benched {in} ({inAct}) to start {out} ({outAct}) at {slot}, then lost by {margin}. The math is not kind." },
  { heat: 0.5, text: "{in} put up {inAct} from the bench. {out} put up {outAct} in the lineup. {name} lost by {margin}. Everybody here can do that subtraction." },
  { heat: 0.6, text: "{name} lost by {margin} with {in} sitting on the bench holding {inAct} points. That lineup call is going on the blooper reel." },
  { heat: 0.8, text: "{name} started {out} ({outAct}) over {in} ({inAct}) and lost by {margin}. Frame it and hang it where the trophy would have gone." },
];

/** The loser's total bench cost beat the margin, with no single decisive swap. Vars: name, bench, margin. */
export const BENCH_LOST_IT: Line[] = [
  { heat: 0, text: "{name} left {bench} points on the bench, more than the {margin} they lost by." },
  { heat: 0.3, text: "{name} had {bench} points sitting on the bench and lost by {margin}. The roster was good enough. The Sunday morning was not." },
  { heat: 0.5, text: "{name} lost by {margin} and left {bench} on the bench. The opponent did not beat them. The lineup screen did." },
  { heat: 0.7, text: "{bench} points on the bench, a {margin} point loss. {name} has no variance excuse here, which is the cruel part." },
  { heat: 0.9, text: "{name} left {bench} on the bench and lost by {margin}. Print it out, frame it, live with it." },
];

/**
 * The loser left a lot on the bench, but less than the margin, so the right
 * lineup still loses. Vars: name, bench, margin.
 */
export const BENCH_WOULD_NOT_MATTER: Line[] = [
  { heat: 0, text: "{name} left {bench} on the bench, which would not have covered the {margin} they lost by." },
  { heat: 0.4, text: "{name} also left {bench} on the bench. Not enough to change the result, just enough to be embarrassing." },
  { heat: 0.6, text: "Even the perfect lineup loses this one for {name}, {bench} points short of a {margin} hole. Small mercies." },
  { heat: 0.8, text: "{name} left {bench} on the bench and still would have lost by plenty. A bad lineup on top of a bad roster, which takes commitment." },
];

/** The winner benched a big score and won anyway. Vars: name, in, inAct, out, outAct, slot. */
export const SWAP_WINNER_SHRUG: Line[] = [
  { heat: 0, text: "{in} scored {inAct} on {name}'s bench, more than {out} managed at {slot} with {outAct}." },
  { heat: 0.3, text: "{name} sat {in} ({inAct}) and started {out} ({outAct}) at {slot}. Won anyway. Nobody checks the bench of the team that won." },
  { heat: 0.5, text: "{in} put up {inAct} on {name}'s bench while {out} gave them {outAct}. {name} won, so this stays between us and the whole channel." },
  { heat: 0.7, text: "{name} benched {in} for {inAct} and started {out} for {outAct}, then won. Being wrong and lucky is still a strategy." },
];

/** An unfilled starting slot on a final week. Vars: name, slot. */
export const EMPTY_SLOT_LINES: Line[] = [
  { heat: 0, text: "{name} left the {slot} slot empty." },
  { heat: 0.4, text: "{name} started nobody at {slot}. Not a bad player. Nobody." },
  { heat: 0.6, text: "{name} played a man down at {slot}. Bold. Wrong, but bold." },
  { heat: 0.8, text: "{name} left {slot} empty, the fantasy equivalent of turning up to the game in pajamas." },
];

/* -------------------------------------------------------------------------- */
/* Oddities                                                                   */
/* -------------------------------------------------------------------------- */

/** The kicker was the team's top scorer. Vars: name, player, act. */
export const KICKER_MVP: Line[] = [
  { heat: 0, text: "{player}, the kicker, was {name}'s top scorer with {act}." },
  { heat: 0.4, text: "{name}'s leading scorer was the kicker. {player}, {act} points. Let that sink in." },
  { heat: 0.6, text: "The kicker, {player}, outscored every other starter {name} had with {act}. Somebody call a meeting." },
  { heat: 0.8, text: "When the kicker is your MVP, something has gone wrong upstream. {player}, {act}, for {name}." },
];

/** The team defense was the team's top scorer. Vars: name, player, act. */
export const DEFENSE_MVP: Line[] = [
  { heat: 0, text: "{name}'s defense, {player}, was their top scorer with {act}." },
  { heat: 0.4, text: "{name}'s best player this week was a defense. {player}, {act} points. The offense should be embarrassed." },
  { heat: 0.7, text: "{player} outscored every offensive player {name} started, with {act}. The defense is the offense now." },
];

/** The team defense finished below zero. Vars: name, player, act. */
export const DEFENSE_NEGATIVE: Line[] = [
  { heat: 0, text: "{name}'s defense, {player}, finished on {act}." },
  { heat: 0.4, text: "{name}'s defense, {player}, scored {act}. Negative. Starting nobody would have been worth more." },
  { heat: 0.7, text: "{player} posted {act} for {name}. The defense took points off the board, which is the opposite of the job." },
];

/** The loser beat their own projection by a lot and still lost. Vars: name, act, proj, diff. */
export const LOSER_OVER_PROJECTION: Line[] = [
  { heat: 0, text: "{name} scored {act} against a projection of {proj} and still lost." },
  { heat: 0.4, text: "{name} beat their own projection by {diff} and lost anyway. Sometimes the schedule just picks you." },
  { heat: 0.6, text: "{name} put up {act}, {diff} over projection, and lost. Did everything right except draw a different opponent." },
];

/** The winner fell well short of projection and won anyway. Vars: name, act, proj, diff. */
export const WINNER_UNDER_PROJECTION: Line[] = [
  { heat: 0, text: "{name} scored {act}, {diff} under projection, and won anyway." },
  { heat: 0.4, text: "{name} came in {diff} under projection and still won. Ugly wins count the same." },
  { heat: 0.7, text: "{name} won with {act}, {diff} below projection. Winning while playing badly is a skill, and {name} has it." },
];

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

/** Below this, a team beating or missing its projection is not worth a line. */
const TEAM_PROJECTION_SWING = 10;
/** A winner's bench swap has to be at least this big to be worth teasing. */
const WINNER_SWAP_MIN = 8;
/** A loser's bench below the margin is only worth a line when it is this big. */
const LOSER_BENCH_MENTION = 10;

/**
 * One team's paragraph: the over-performer and the under-performer, pointed the
 * way the result points. Returns the sentences in reading order, without the
 * opening take about the manager, which the caller supplies.
 */
export function playerLines(
  voice: Voice,
  side: MatchupSide,
  name: string,
  result: "won" | "lost" | "tied",
  margin: number,
): string[] {
  const lines: string[] = [];
  const hero = overPerformer(side);
  const bust = underPerformer(side);

  const heroLine = (): string | null => {
    if (hero && hero.projected !== null && hero.diff !== null) {
      // A tie takes the winner's banks for the hero and the loser's for the
      // bust: nobody lost, so nobody is "carried to a win" either.
      return say(voice, result === "lost" ? HERO_ON_LOSER : HERO_ON_WINNER, {
        name,
        player: hero.name,
        act: pts(hero.actual),
        proj: pts(hero.projected),
        diff: pts(hero.diff),
      });
    }
    const top = topScorer(side);
    // Without a hero, the top scorer stands in, unless he is also the bust.
    if (!top || (bust && top.name === bust.name)) return null;
    return say(voice, result === "lost" ? TOP_SCORER_LOSER : TOP_SCORER_WINNER, {
      name,
      player: top.name,
      act: pts(top.actual),
    });
  };

  const bustLine = (): string | null => {
    if (!bust || bust.projected === null) return null;
    const miss = bust.projected - bust.actual;
    const vars = {
      name,
      player: bust.name,
      act: pts(bust.actual),
      proj: pts(bust.projected),
      miss: pts(miss),
      margin: pts(margin),
    };
    if (bust.actual < ZERO_LINE) return say(voice, ZERO_LINES, vars);
    if (result === "lost" && miss > margin) return say(voice, BUST_COST_GAME, vars);
    return say(voice, result === "won" ? BUST_ON_WINNER : BUST_ON_LOSER, vars);
  };

  // A loser's paragraph leads with what went wrong and ends on the one player
  // who showed up. A winner's leads with the hero and ends on the passenger.
  const order = result === "lost" ? [bustLine, heroLine] : [heroLine, bustLine];
  for (const make of order) {
    const line = make();
    if (line) lines.push(line);
  }
  return lines;
}

function isEmptyStandIn(p: SchedulePlayer): boolean {
  return p.playerId === null && p.sleeperId.startsWith("empty-");
}

/**
 * The lineup decisions worth a joke, for the whole game. At most two lines:
 * the loser's, when their bench beat the margin, and the winner's, when they
 * sat a big score and got away with it.
 */
export function decisionLines(
  voice: Voice,
  winner: MatchupSide,
  loser: MatchupSide,
  W: string,
  L: string,
  margin: number,
  tied: boolean,
): string[] {
  const lines: string[] = [];
  if (!tied) {
    const benched = loser.pointsLeftOnBench;
    const swap = loser.benchUpgrades[0];
    if (
      swap &&
      !isEmptyStandIn(swap.outPlayer) &&
      swap.inPlayer.actual !== null &&
      swap.outPlayer.actual !== null &&
      swap.gain > margin
    ) {
      const line = say(voice, SWAP_LOST_IT, {
        name: L,
        in: swap.inPlayer.name,
        inAct: pts(swap.inPlayer.actual),
        out: swap.outPlayer.name,
        outAct: pts(swap.outPlayer.actual),
        slot: swap.slotLabel,
        margin: pts(margin),
      });
      if (line) lines.push(line);
    } else if (benched !== null && benched > 0 && benched >= margin) {
      const line = say(voice, BENCH_LOST_IT, { name: L, bench: pts(benched), margin: pts(margin) });
      if (line) lines.push(line);
    } else if (benched !== null && benched >= LOSER_BENCH_MENTION) {
      const line = say(voice, BENCH_WOULD_NOT_MATTER, { name: L, bench: pts(benched), margin: pts(margin) });
      if (line) lines.push(line);
    }
  }

  // Every line in this bank says the team won, so a tie never draws one.
  const wSwap = tied ? undefined : winner.benchUpgrades[0];
  if (
    wSwap &&
    !isEmptyStandIn(wSwap.outPlayer) &&
    wSwap.inPlayer.actual !== null &&
    wSwap.outPlayer.actual !== null &&
    wSwap.gain >= WINNER_SWAP_MIN
  ) {
    const line = say(voice, SWAP_WINNER_SHRUG, {
      name: W,
      in: wSwap.inPlayer.name,
      inAct: pts(wSwap.inPlayer.actual),
      out: wSwap.outPlayer.name,
      outAct: pts(wSwap.outPlayer.actual),
      slot: wSwap.slotLabel,
    });
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * The strange things that happened, at most two, in a fixed order of how funny
 * they tend to be: an empty slot, a kicker or defense as top scorer, a defense
 * below zero, then the team that beat its projection and lost or missed it and
 * won.
 */
export function oddityLines(
  voice: Voice,
  sides: Array<{ side: MatchupSide; name: string; result: "won" | "lost" | "tied" }>,
): string[] {
  const candidates: Array<() => string | null> = [];

  for (const { side, name } of sides) {
    const empty = side.slots.find((s) => s.player === null && s.slot.projectable);
    if (empty) candidates.push(() => say(voice, EMPTY_SLOT_LINES, { name, slot: empty.slot.label }));
  }
  for (const { side, name } of sides) {
    const top = topScorer(side);
    if (!top) continue;
    const pos = top.position.toUpperCase();
    if (pos === "K") candidates.push(() => say(voice, KICKER_MVP, { name, player: top.name, act: pts(top.actual) }));
    if (pos === "DEF") candidates.push(() => say(voice, DEFENSE_MVP, { name, player: top.name, act: pts(top.actual) }));
  }
  for (const { side, name } of sides) {
    for (const s of scoredStarters(side)) {
      if (s.player.position.toUpperCase() === "DEF" && s.actual < 0) {
        candidates.push(() => say(voice, DEFENSE_NEGATIVE, { name, player: s.player.name, act: pts(s.actual) }));
      }
    }
  }
  for (const { side, name, result } of sides) {
    if (side.actualTotal === null || side.projectedTotal === null) continue;
    const swing = side.actualTotal - side.projectedTotal;
    const vars = {
      name,
      act: pts(side.actualTotal),
      proj: pts(side.projectedTotal),
      diff: pts(Math.abs(swing)),
    };
    if (result === "lost" && swing >= TEAM_PROJECTION_SWING) {
      candidates.push(() => say(voice, LOSER_OVER_PROJECTION, vars));
    }
    if (result === "won" && swing <= -TEAM_PROJECTION_SWING) {
      candidates.push(() => say(voice, WINNER_UNDER_PROJECTION, vars));
    }
  }

  const lines: string[] = [];
  for (const make of candidates) {
    if (lines.length >= 2) break;
    const line = make();
    if (line) lines.push(line);
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

/** The player a preview says a team's week rides on. Vars: name, player, proj. */
export const KEY_PLAYER_LINES: Line[] = [
  { heat: 0, text: "{name}'s week runs through {player}, projected for {proj}." },
  { heat: 0, text: "{name} needs {player} to deliver something close to the {proj} projected." },
  { heat: 0.3, text: "{name} is leaning on {player} for {proj}. No pressure." },
  { heat: 0.4, text: "{player} is projected for {proj}, and {name} has been refreshing the injury report about it since Tuesday." },
  { heat: 0.5, text: "If {player} does not get to {proj}, {name} is going to have a very quiet Monday." },
  { heat: 0.6, text: "{name} has handed the whole week to {player} ({proj} projected) and is hoping nobody notices there is no plan B." },
  { heat: 0.7, text: "{player} at {proj} projected is {name}'s entire personality this week." },
];

/** A starter currently carrying an injury designation. Vars: name, player, status. */
export const SHAKY_STARTER_LINES: Line[] = [
  { heat: 0, text: "{name} is starting {player}, currently listed as {status}." },
  { heat: 0.3, text: "{name} has {player} in the lineup, listed as {status}. Worth a look before Sunday." },
  { heat: 0.5, text: "{name} is starting {player}, who is {status}. Brave. Possibly too brave." },
  { heat: 0.6, text: "{player} is listed as {status} and is in {name}'s lineup anyway. Somebody set an alarm for the inactives." },
  { heat: 0.8, text: "{name} is starting {player}, listed as {status}, which is the fantasy version of leaving the oven on and going on holiday." },
];

/** An unfilled starting slot before the games. Vars: name, slot. */
export const EMPTY_SLOT_PREVIEW_LINES: Line[] = [
  { heat: 0, text: "{name} has nobody in the {slot} slot right now." },
  { heat: 0.4, text: "{name} currently has an empty {slot} slot. That is a choice, and not a good one." },
  { heat: 0.6, text: "{name} is starting nobody at {slot}. There are free agents. Many of them. Any of them." },
];

/** Sleeper designations worth mentioning, in the words a reader would use. */
const STATUS_WORDS: Record<string, string> = {
  questionable: "questionable",
  doubtful: "doubtful",
  out: "out",
  ir: "on injured reserve",
  sus: "suspended",
  pup: "on the PUP list",
};

/**
 * One team's preview lines: the player the week rests on, then anything shaky
 * about the lineup they have set. Before the games, so projections only, and
 * an injury designation is read as it stands when the post is written.
 */
export function previewTeamLines(voice: Voice, side: MatchupSide, name: string): string[] {
  const lines: string[] = [];

  let key: SchedulePlayer | null = null;
  for (const entry of side.slots) {
    const p = entry.player;
    if (!p || p.projected === null) continue;
    if (!key || p.projected > (key.projected ?? 0)) key = p;
  }
  if (key && key.projected !== null) {
    const line = say(voice, KEY_PLAYER_LINES, { name, player: key.name, proj: pts(key.projected) });
    if (line) lines.push(line);
  }

  const empty = side.slots.find((s) => s.player === null && s.slot.projectable);
  if (empty) {
    const line = say(voice, EMPTY_SLOT_PREVIEW_LINES, { name, slot: empty.slot.label });
    if (line) lines.push(line);
  } else {
    const shaky = side.slots.find((s) => {
      const status = s.player?.injuryStatus?.trim().toLowerCase();
      return status !== undefined && status in STATUS_WORDS;
    });
    const status = shaky?.player?.injuryStatus?.trim().toLowerCase();
    if (shaky?.player && status) {
      const line = say(voice, SHAKY_STARTER_LINES, {
        name,
        player: shaky.player.name,
        status: STATUS_WORDS[status],
      });
      if (line) lines.push(line);
    }
  }
  return lines;
}
