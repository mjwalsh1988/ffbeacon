/**
 * Praise and roasts, keyed to how a manager actually did.
 *
 * The voice in ./voice.ts decides HOW SHARP a line may be. This decides WHICH
 * WAY it points. A writeup grades each manager first, from the same figures it
 * prints (Signal Check's margin, the change in playoff odds, the final score),
 * and only then draws a line from the bank for that grade. So a manager who won
 * a trade by 30% is never handed a roast, and one who lost a game by 50 is
 * never handed a pat on the back, whatever the seed happens to draw.
 *
 * The snark dial still governs everything. At 0 only the heat-0 line in each
 * bank is eligible, and those are plain statements ("a strong piece of business
 * from X"), so turning the dial down keeps the direction and drops the jokes.
 *
 * Every line names the manager through `{name}` and makes a claim about the
 * grade, which the numbers in the same message back up. None of them invents a
 * fact. Same rules as the rest of the relay: hand-written, never generated,
 * chosen by a seeded draw so a retry posts the same words.
 */

import type { Line, Voice } from "./voice";

/** How one manager came out of a trade or a game. */
export type Grade = "great" | "good" | "even" | "bad" | "awful";

/** A score from the writeup's own arithmetic, mapped onto five grades. */
export function gradeFromScore(score: number): Grade {
  if (score >= 1.5) return "great";
  if (score >= 0.5) return "good";
  if (score > -0.5) return "even";
  if (score > -1.5) return "bad";
  return "awful";
}

/** Draw a line for one manager, with their name filled in. */
export function take(voice: Voice, bank: Line[], name: string): string | null {
  const line = voice.pick(bank);
  return line ? line.replaceAll("{name}", name) : null;
}

/* -------------------------------------------------------------------------- */
/* Trades                                                                     */
/* -------------------------------------------------------------------------- */

export const TRADE_TAKES: Record<Exclude<Grade, "even">, Line[]> = {
  great: [
    { heat: 0, text: "A strong piece of business from {name}." },
    { heat: 0, text: "{name} did very well here." },
    { heat: 0.2, text: "{name} should feel great about this one." },
    { heat: 0.3, text: "{name} came in with a plan and left with the better end of it." },
    { heat: 0.3, text: "Hard to find anything {name} would change about this deal." },
    { heat: 0.4, text: "{name} just made every other offer in this league look lazy." },
    { heat: 0.4, text: "If {name} wants to take a victory lap, nobody can stop them." },
    { heat: 0.5, text: "Somebody give {name} a raise." },
    { heat: 0.5, text: "{name} read the numbers. Possibly the only one who did." },
    { heat: 0.6, text: "{name} is going to be insufferable about this, and has earned every bit of it." },
    { heat: 0.6, text: "{name} should screenshot the acceptance and set it as a lock screen." },
    { heat: 0.7, text: "{name} pulled this off in broad daylight and nobody stopped them." },
    { heat: 0.7, text: "Whoever {name} is getting advice from, keep them." },
    { heat: 0.8, text: "{name} ran a heist and filed it as a trade." },
    { heat: 0.9, text: "{name} should be investigated, and then congratulated." },
  ],
  good: [
    { heat: 0, text: "{name} comes out a little ahead." },
    { heat: 0, text: "A sensible deal for {name}." },
    { heat: 0.2, text: "A tidy bit of work from {name}." },
    { heat: 0.3, text: "{name} got the better side without needing to gloat. Yet." },
    { heat: 0.3, text: "{name} gets a quiet nod for this one." },
    { heat: 0.4, text: "{name} won it on points, which is still a win." },
    { heat: 0.5, text: "{name} won the trade and will be telling people by lunch." },
    { heat: 0.5, text: "Not a robbery, but {name} definitely left with the nicer stuff." },
    { heat: 0.6, text: "{name} squeezed out a win here and will absolutely bring it up in the chat." },
    { heat: 0.7, text: "{name} haggled, and it looks like {name} haggled better." },
    { heat: 0.8, text: "{name} got the last word in this negotiation, and probably the first one too." },
  ],
  bad: [
    { heat: 0, text: "{name} comes out a little behind." },
    { heat: 0, text: "Not the best deal {name} will make this year." },
    { heat: 0.2, text: "{name} may want this one back in a month." },
    { heat: 0.3, text: "{name} paid a bit more than they had to." },
    { heat: 0.3, text: "{name} blinked first, and it shows." },
    { heat: 0.4, text: "{name} needed this to work out and it did not quite." },
    { heat: 0.5, text: "{name} brought a decent offer and somehow left with less." },
    { heat: 0.5, text: "{name} is going to defend this in the chat, and it will be a long defence." },
    { heat: 0.6, text: "{name} got talked into something. It happens. It happened." },
    { heat: 0.7, text: "{name} should not be accepting trades before coffee." },
    { heat: 0.8, text: "{name} lost a negotiation they started, which takes some doing." },
  ],
  awful: [
    { heat: 0, text: "{name} gave up far more than they got back." },
    { heat: 0, text: "This is a hard deal to defend from {name}'s side." },
    { heat: 0.2, text: "{name} is going to have to explain this one." },
    { heat: 0.3, text: "{name} lost this trade by a lot, and the numbers are not being polite about it." },
    { heat: 0.4, text: "Somebody check on {name}." },
    { heat: 0.4, text: "{name} will be hearing about this one at every draft for years." },
    { heat: 0.5, text: "{name} got fleeced, and the receipt is right there." },
    { heat: 0.6, text: "{name} basically donated half a roster and got a thank-you note back." },
    { heat: 0.6, text: "Everybody in this league should send {name} an offer today, while it lasts." },
    { heat: 0.7, text: "{name} got robbed, and the worst part is {name} signed for it." },
    { heat: 0.8, text: "Revoke {name}'s trade privileges. For their own protection." },
    { heat: 0.9, text: "{name} has been taken to the cleaners, pressed, folded and sent home on a hanger." },
  ],
};

/**
 * How a trade article can sign off. None of them mentions a poll, because the
 * channel's poll switch can be off and a closer pointing at a poll that is not
 * there reads as a bug.
 */
export const TRADE_CLOSERS: Line[] = [
  { heat: 0, text: "Who won it? Have your say." },
  { heat: 0, text: "Time will tell on this one." },
  { heat: 0.2, text: "Make your case in the chat." },
  { heat: 0.3, text: "Be honest about who won this." },
  { heat: 0.3, text: "Let the arguing begin." },
  { heat: 0.4, text: "The chat has opinions. Here is the place for them." },
  { heat: 0.5, text: "Somebody is going to read this twice." },
  { heat: 0.6, text: "Check back in December to see who was right." },
  { heat: 0.7, text: "Commissioner, you may want to stay near your phone." },
  { heat: 0.8, text: "We will revisit this when it is funnier." },
];

/* -------------------------------------------------------------------------- */
/* Game results                                                               */
/* -------------------------------------------------------------------------- */

/** For the winner of a game, by how the game went. */
export const WIN_TAKES: Record<"big" | "normal" | "close", Line[]> = {
  big: [
    { heat: 0, text: "{name} was the better team by a distance." },
    { heat: 0, text: "A dominant week from {name}." },
    { heat: 0.2, text: "{name} left nothing to chance." },
    { heat: 0.3, text: "{name} looked like the team everybody was afraid of in August." },
    { heat: 0.4, text: "{name} put up a number the rest of the slate should be embarrassed by." },
    { heat: 0.5, text: "{name} treated this like a scrimmage." },
    { heat: 0.5, text: "{name} ran up the score and, frankly, good for them." },
    { heat: 0.6, text: "{name} won this one by halftime of the early games." },
    { heat: 0.7, text: "{name} made a statement, and the statement was rude." },
    { heat: 0.8, text: "{name} should send the opponent a sympathy card. It would be the kind thing." },
  ],
  normal: [
    { heat: 0, text: "{name} did enough." },
    { heat: 0, text: "A clean win for {name}." },
    { heat: 0.2, text: "{name} handled business." },
    { heat: 0.3, text: "{name} got the job done without much fuss." },
    { heat: 0.4, text: "{name} takes it, and nobody can say it was undeserved." },
    { heat: 0.5, text: "{name} was never really in trouble, and never really showing off either." },
    { heat: 0.6, text: "{name} won comfortably enough to enjoy the evening games." },
    { heat: 0.7, text: "{name} won the way a good team wins, which is boringly." },
  ],
  close: [
    { heat: 0, text: "{name} held on." },
    { heat: 0.2, text: "{name} got away with one." },
    { heat: 0.3, text: "{name} survived, and survival is all that counts by Tuesday." },
    { heat: 0.4, text: "{name} will not care how it looked." },
    { heat: 0.5, text: "{name} owes the Monday night game a thank-you note." },
    { heat: 0.6, text: "A win is a win, and {name} is going to say that a lot this week." },
    { heat: 0.7, text: "{name} won, and should probably not ask too many questions about how." },
  ],
};

/** For the loser of a game, by how the game went. */
export const LOSS_TAKES: Record<"big" | "normal" | "close", Line[]> = {
  big: [
    { heat: 0, text: "{name} never got going." },
    { heat: 0, text: "A week to forget for {name}." },
    { heat: 0.2, text: "{name} was out of this one early." },
    { heat: 0.3, text: "{name} got buried, and it was not close." },
    { heat: 0.4, text: "{name} was a spectator in their own matchup." },
    { heat: 0.5, text: "{name} might want to double check the lineup was actually set." },
    { heat: 0.5, text: "That was hard to watch from {name}'s side of the screen." },
    { heat: 0.6, text: "{name}'s starters clocked in, stood around and clocked out." },
    { heat: 0.7, text: "{name} has been asked not to talk about this game, and should listen." },
    { heat: 0.8, text: "{name} lost so badly the app should have offered a refund." },
    { heat: 0.9, text: "{name} was evicted from this game by halftime of the early window." },
  ],
  normal: [
    { heat: 0, text: "{name} came up short." },
    { heat: 0, text: "Not {name}'s week." },
    { heat: 0.2, text: "{name} could not keep pace." },
    { heat: 0.3, text: "{name} needed more from somebody. Anybody." },
    { heat: 0.4, text: "{name} had chances and did not take them." },
    { heat: 0.5, text: "{name} will spend the week reading box scores out of spite." },
    { heat: 0.6, text: "{name} showed up, which is about the nicest thing that can be said." },
    { heat: 0.7, text: "{name} brought a knife to a gunfight, and left the knife on the bench." },
  ],
  close: [
    { heat: 0, text: "A tough one for {name}." },
    { heat: 0.2, text: "{name} was a play or two away." },
    { heat: 0.3, text: "{name} deserved better and got nothing." },
    { heat: 0.4, text: "{name} lost by the width of a dropped pass." },
    { heat: 0.5, text: "{name} is going to replay this one in their head for days." },
    { heat: 0.6, text: "Brutal beat for {name}, and the chat will not be gentle about it." },
    { heat: 0.7, text: "{name} did everything except win, which is the only part that counts." },
  ],
};

/* -------------------------------------------------------------------------- */
/* Previews                                                                   */
/* -------------------------------------------------------------------------- */

/** For the clear favourite in a preview. */
export const FAVOURITE_TAKES: Line[] = [
  { heat: 0, text: "{name} goes in as the clear favourite." },
  { heat: 0.2, text: "{name} should handle this." },
  { heat: 0.3, text: "{name} is the pick, and it is not a hard one." },
  { heat: 0.4, text: "{name} has every reason to be confident." },
  { heat: 0.5, text: "{name} only has to avoid doing anything silly with the lineup." },
  { heat: 0.6, text: "{name} has already started drafting the victory post." },
  { heat: 0.7, text: "Anything but a {name} win and somebody owes the model an apology." },
];

/** For the clear underdog in a preview. */
export const UNDERDOG_TAKES: Line[] = [
  { heat: 0, text: "{name} needs a big week to pull this off." },
  { heat: 0.2, text: "{name} needs some help." },
  { heat: 0.3, text: "{name} needs a ceiling game from somebody, and soon." },
  { heat: 0.4, text: "{name} is not favoured, and the projections are being polite about it." },
  { heat: 0.5, text: "{name} is going to need two players to have career days." },
  { heat: 0.6, text: "{name} has a path to winning. It is narrow and poorly lit." },
  { heat: 0.7, text: "{name} might want to start praying to the injury report." },
  { heat: 0.9, text: "{name} could start every player twice and still be behind." },
];

/** For a preview where nothing separates the two. */
export const COIN_FLIP_TAKES: Line[] = [
  { heat: 0, text: "There is almost nothing between them." },
  { heat: 0.2, text: "A genuine coin flip." },
  { heat: 0.3, text: "The model has no idea, and says so." },
  { heat: 0.4, text: "Nothing separates these two on paper, so it comes down to the parts nobody projects." },
  { heat: 0.5, text: "Fifty-fifty, so both managers get to spend the week convinced they are being disrespected." },
  { heat: 0.6, text: "A coin flip, which means one of them gets to be very annoying about it on Tuesday." },
  { heat: 0.7, text: "This one is going to come down to a kicker, and everybody knows it." },
];
