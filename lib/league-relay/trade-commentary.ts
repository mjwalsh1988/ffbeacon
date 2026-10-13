/**
 * The jokes a trade post is made of.
 *
 * Every line is pinned to a figure the trade impact model already computed for
 * this exact deal (lib/league-relay/trade-impact.ts, which is the Trade Ideas
 * engine pointed at a trade that happened): how many of the remaining weeks each
 * player a manager RECEIVED will start for them, how many the players they SENT
 * would have started, what the deal does to their best weekly lineup and their
 * playoff odds, and whether the direction suits where the team sits. The praise
 * and the roast follow those figures, so a manager who traded a bench piece for
 * a weekly starter is never the one being mocked, and one who sold a starter for
 * a backup is never the one being congratulated.
 *
 * Same rules as ./commentary.ts: hand-written, chosen by a seeded draw, never
 * generated; players never get a pronoun; every bank keeps a heat-0 line so the
 * snark dial still produces a plain sentence at zero.
 *
 * Pure: takes plain data, returns sentences.
 */

import { say } from "./commentary";
import type { Grade } from "./takes";
import type { ExecutedTeamImpact } from "./trade-impact";
import { pct, ppChange, type Line, type Voice } from "./voice";

/** A received player is a starter when he starts at least this share of the weeks left. */
const STARTER_SHARE = 0.6;
/** Playoff odds have moved enough to be the story at this many points. */
const ODDS_SWING = 5;
/** The weekly lineup has moved enough to mention at this many points. */
const LINEUP_SWING = 1;

const pts = (n: number): string => Math.abs(n).toFixed(1);

/**
 * Draw from a bank, at most this hot. A cap of 0 keeps the plain statement of
 * the fact and drops the joke, which is how a paragraph that opened with praise
 * still reports a bad number without roasting the person it just praised.
 */
function sayAt(voice: Voice, bank: Line[], vars: Record<string, string>, cap: number): string | null {
  return say(voice, bank.filter((l) => l.heat <= cap), vars);
}

/* -------------------------------------------------------------------------- */
/* What came in                                                               */
/* -------------------------------------------------------------------------- */

/** A received player who starts most weeks. Vars: name, player, starts, weeks. */
export const RECEIVED_STARTER: Line[] = [
  { heat: 0, text: "{player} goes straight into {name}'s lineup, starting {starts} of the {weeks} weeks left." },
  { heat: 0.3, text: "{player} starts {starts} of {name}'s {weeks} remaining weeks. That is a lineup piece, not a souvenir." },
  { heat: 0.5, text: "{name} went shopping with a list: {player} starts in {starts} of the {weeks} weeks left. How mature." },
  { heat: 0.7, text: "{player} walks into {name}'s starting lineup for {starts} of {weeks} weeks. Somebody on that roster just got demoted and has not been told." },
];

/**
 * A received player who starts most weeks, on a team whose lineup still got
 * weaker. The arrival is real; the bill was bigger. Vars: name, player, starts, weeks.
 */
export const RECEIVED_STARTER_COSTLY: Line[] = [
  { heat: 0, text: "{player} starts {starts} of {name}'s {weeks} remaining weeks, but the lineup still comes out weaker." },
  { heat: 0.4, text: "{player} will start {starts} of {weeks} weeks for {name}, which helps. Just not as much as what left." },
  { heat: 0.6, text: "{name} did get a starter, {player}, for {starts} of {weeks} weeks. It cost a better one." },
];

/** A received player who starts some weeks. Vars: name, player, starts, weeks. */
export const RECEIVED_PART: Line[] = [
  { heat: 0, text: "{player} cracks {name}'s best lineup in {starts} of the {weeks} weeks left." },
  { heat: 0.4, text: "{player} starts {starts} of {weeks} weeks for {name}: a part-timer, handy on bye weeks." },
  { heat: 0.6, text: "{player} is a sometimes-starter for {name}, {starts} of {weeks} weeks. A timeshare, bought at full price." },
];

/** A received player who starts none of the weeks left. Vars: name, player, weeks. */
export const RECEIVED_BENCH: Line[] = [
  { heat: 0, text: "{player} does not crack {name}'s best lineup in any of the {weeks} weeks left." },
  { heat: 0.3, text: "{player} is projected to start zero of {name}'s {weeks} remaining weeks. A very expensive bench ornament." },
  { heat: 0.5, text: "{name} traded for {player}, who starts in none of the {weeks} weeks left. Acquiring a backup on purpose takes nerve." },
  { heat: 0.7, text: "{player} will spend all {weeks} remaining weeks on {name}'s bench, with a lovely view of the players {name} already had." },
];

/** The same, in a dynasty or keeper league, where a stash can be the point. Vars: name, player, weeks. */
export const RECEIVED_STASH: Line[] = [
  { heat: 0, text: "{player} does not start for {name} in any of the {weeks} weeks left, so this one is for next year." },
  { heat: 0.4, text: "{player} starts none of {name}'s {weeks} remaining weeks. In a dynasty league that is a plan. Probably." },
  { heat: 0.6, text: "{name} is buying {player} for later, with zero starts in the {weeks} weeks left. Patience, or a very long excuse." },
];

/** A received player who is on IR or the taxi squad. Vars: name, player. */
export const RECEIVED_PARKED: Line[] = [
  { heat: 0, text: "{player} is on {name}'s injured reserve or taxi squad and cannot start yet." },
  { heat: 0.4, text: "{name} traded for {player} and parked the new arrival on IR or the taxi squad straight away. A long game." },
  { heat: 0.7, text: "{player} arrives at {name}'s place and goes directly to a lie-down. Buying a car to keep in the garage." },
];

/* -------------------------------------------------------------------------- */
/* What went out                                                              */
/* -------------------------------------------------------------------------- */

/** A sent player who would have started, and the lineup is worse for it. Vars: name, player, starts, weeks. */
export const SENT_STARTER_HURT: Line[] = [
  { heat: 0, text: "{player} would have started {starts} of {name}'s {weeks} remaining weeks, and now starts for somebody else." },
  { heat: 0.4, text: "{name} shipped out {player}, a starter in {starts} of the {weeks} weeks left. The replacement plan had better be good." },
  { heat: 0.6, text: "{player} was in {name}'s lineup {starts} of {weeks} weeks. Past tense now. {name} looked at a working starter and decided it was the problem." },
];

/** A sent player who would have started, and the lineup still improves. Vars: name, player, starts, weeks. */
export const SENT_STARTER_FINE: Line[] = [
  { heat: 0, text: "{name} gave up {player}, a starter in {starts} of the {weeks} weeks left, and the lineup still comes out ahead." },
  { heat: 0.4, text: "Losing {player} costs {name} nothing on Sunday, because what came back is better. That is how it is done." },
];

/** A sent starter whose loss the lineup barely notices. Vars: name, player, starts, weeks. */
export const SENT_STARTER_EVEN: Line[] = [
  { heat: 0, text: "{name} gave up {player}, a starter in {starts} of the {weeks} weeks left, and the lineup barely notices." },
  { heat: 0.4, text: "{player} leaves {name}'s lineup after starting {starts} of {weeks} weeks, and the replacement covers it almost exactly. A lateral move, with paperwork." },
];

/** A sent player who started only now and then. Vars: name, player, starts, weeks. */
export const SENT_PART: Line[] = [
  { heat: 0, text: "{player} would only have started {starts} of {name}'s {weeks} remaining weeks." },
  { heat: 0.4, text: "{name} sold {player}, an occasional starter at {starts} of {weeks} weeks. Nobody is lighting a candle." },
];

/** A sent player who was not starting at all. Vars: name, player, weeks. */
export const SENT_BENCH: Line[] = [
  { heat: 0, text: "{player} was not starting for {name} in any of the {weeks} weeks left." },
  { heat: 0.4, text: "{name} turned {player}, a bench piece with no starts coming, into something. Selling spare parts is the dream." },
  { heat: 0.6, text: "{name} sold {player} straight off the bench, where {player} was doing nothing in particular for {name}." },
];

/* -------------------------------------------------------------------------- */
/* What it does to the season                                                 */
/* -------------------------------------------------------------------------- */

/** Playoff odds up. Vars: name, from, to. */
export const ODDS_UP: Line[] = [
  { heat: 0, text: "{name}'s playoff odds go from {from} to {to}." },
  { heat: 0.3, text: "{name} goes from {from} to {to} to make the playoffs. Somebody is pricing up a new jersey." },
  { heat: 0.5, text: "{name}'s playoff odds jump from {from} to {to}. The rest of the bubble just got a little quieter." },
];

/** Playoff odds down. Vars: name, from, to. */
export const ODDS_DOWN: Line[] = [
  { heat: 0, text: "{name}'s playoff odds drop from {from} to {to}." },
  { heat: 0.3, text: "{name} goes from {from} to {to} to make the playoffs. That is the sound of a season leaking." },
  { heat: 0.5, text: "{name} traded the playoff odds from {from} down to {to}, which is a strange thing to pay for." },
  { heat: 0.7, text: "{from} to {to}. {name} made the team worse at making the playoffs, which is the only job it has." },
];

/** Best lineup stronger. Vars: name, pts. */
export const LINEUP_UP: Line[] = [
  { heat: 0, text: "{name}'s best lineup gets about {pts} points a week stronger." },
  { heat: 0.4, text: "{name} adds about {pts} points a week to the starting lineup. That is real, every week." },
];

/** Best lineup weaker. Vars: name, pts. */
export const LINEUP_DOWN: Line[] = [
  { heat: 0, text: "{name}'s best lineup gets about {pts} points a week weaker." },
  { heat: 0.4, text: "It costs {name}'s starters about {pts} points a week. Paying to get worse is a niche strategy." },
  { heat: 0.6, text: "{name} is {pts} points a week lighter after this. Bold, considering the games keep happening." },
];

/** Neither moved. Vars: name. */
export const NOTHING_CHANGES: Line[] = [
  { heat: 0, text: "On the field this changes almost nothing for {name}." },
  { heat: 0.4, text: "For {name} the lineup barely moves. All that negotiating for a rounding error." },
];

/* -------------------------------------------------------------------------- */
/* Builder                                                                    */
/* -------------------------------------------------------------------------- */

/** One team's commentary, received players first, then the bill, then the season. */
export function tradeTeamLines(
  voice: Voice,
  opts: {
    team: ExecutedTeamImpact;
    name: string;
    weeksLeft: number;
    isDynasty: boolean;
    /** No lineup model ran, so start counts and lineup figures are unknown. */
    noLineup: boolean;
    /** No season simulation ran, so the odds are unknown. */
    noOdds: boolean;
    /**
     * The take this paragraph opens with. The facts below are always reported,
     * but they never argue with it: after praise, a bad number is stated plainly
     * rather than mocked, and after a roast a good number is not cheered.
     */
    grade: Grade;
  },
): string[] {
  const { team, name, weeksLeft, isDynasty } = opts;
  const out: string[] = [];
  const weeks = String(weeksLeft);
  const lineupDelta = team.lineupDelta ?? 0;
  // A dynasty team taking value for points is selling on purpose; the lost
  // points are the price, not the joke.
  const sellingForValue = isDynasty && team.valueDelta > 0 && lineupDelta < 0;
  const praised = opts.grade === "great" || opts.grade === "good";
  const roasted = opts.grade === "bad" || opts.grade === "awful";
  const downCap = praised || sellingForValue ? 0 : 1;
  const upCap = roasted ? 0 : 1;

  /* ------------------------------------------------------------- received */
  if (!opts.noLineup && weeksLeft > 0) {
    // The two received players worth talking about: the one who starts most and,
    // if different, one who never starts. A five-player return does not get five
    // sentences, it gets the hit and the miss.
    const players = team.received.filter(
      (a): a is Extract<typeof a, { kind: "player" }> => a.kind === "player",
    );
    const parked = players.filter((p) => p.isInactive);
    const active = players.filter(
      (p) => !p.isInactive && team.receivedStartWeeks[p.playerId] !== undefined,
    );
    const byStarts = [...active].sort(
      (x, y) => (team.receivedStartWeeks[y.playerId] ?? 0) - (team.receivedStartWeeks[x.playerId] ?? 0),
    );
    const top = byStarts[0];
    if (top) {
      const starts = team.receivedStartWeeks[top.playerId] ?? 0;
      const vars = { name, player: top.name, starts: String(starts), weeks };
      const bank =
        starts === 0
          ? isDynasty
            ? RECEIVED_STASH
            : RECEIVED_BENCH
          : starts / weeksLeft >= STARTER_SHARE
            ? lineupDelta <= -LINEUP_SWING
              ? RECEIVED_STARTER_COSTLY
              : RECEIVED_STARTER
            : RECEIVED_PART;
      const cap = bank === RECEIVED_STARTER ? upCap : bank === RECEIVED_STASH ? 1 : downCap;
      const line = sayAt(voice, bank, vars, cap);
      if (line) out.push(line);
    }
    const bench = byStarts.length > 1 ? byStarts[byStarts.length - 1] : null;
    if (bench && (team.receivedStartWeeks[bench.playerId] ?? 0) === 0 && bench !== top) {
      // The second player named is often a throw-in, and nothing here knows
      // what it cost, so it gets the plain fact and no joke about the price.
      const line = sayAt(voice, isDynasty ? RECEIVED_STASH : RECEIVED_BENCH, {
        name,
        player: bench.name,
        weeks,
      }, 0);
      if (line) out.push(line);
    }
    if (parked[0]) {
      const line = say(voice, RECEIVED_PARKED, { name, player: parked[0].name });
      if (line) out.push(line);
    }

    /* -------------------------------------------------------------- sent */
    // The departed player who would have started most. A starter sent away is
    // the bill; a bench piece sent away is the bargain.
    let sentTop: { name: string; starts: number } | null = null;
    for (const asset of team.sent) {
      if (asset.kind !== "player") continue;
      const starts = team.departedStartWeeks[asset.playerId];
      if (starts === undefined) continue;
      if (!sentTop || starts > sentTop.starts) sentTop = { name: asset.name, starts };
    }
    if (sentTop) {
      const vars = { name, player: sentTop.name, starts: String(sentTop.starts), weeks };
      // A player is only "a starter" when he started most of the window, and
      // his loss only "hurt" when the lineup fell by a real amount. One start in
      // nine is not a working starter, and a 0.2 point dip is not a wound.
      const bank =
        sentTop.starts === 0
          ? SENT_BENCH
          : sentTop.starts / weeksLeft < STARTER_SHARE
            ? SENT_PART
            : lineupDelta <= -LINEUP_SWING
              ? SENT_STARTER_HURT
              : lineupDelta >= LINEUP_SWING
                ? SENT_STARTER_FINE
                : SENT_STARTER_EVEN;
      const cap =
        bank === SENT_STARTER_HURT ? downCap : bank === SENT_STARTER_FINE || bank === SENT_BENCH ? upCap : 1;
      const line = sayAt(voice, bank, vars, cap);
      if (line) out.push(line);
    }
  }

  /* --------------------------------------------------------------- season */
  const odds = opts.noOdds ? null : ppChange(team.playoffOddsBefore, team.playoffOddsAfter);
  const from = pct(team.playoffOddsBefore);
  const to = pct(team.playoffOddsAfter);
  if (odds && from && to && Math.abs(odds.delta) >= ODDS_SWING) {
    const line = odds.delta > 0
      ? sayAt(voice, ODDS_UP, { name, from, to }, upCap)
      : sayAt(voice, ODDS_DOWN, { name, from, to }, downCap);
    if (line) out.push(line);
  } else if (!opts.noLineup && team.lineupDelta !== null) {
    if (Math.abs(lineupDelta) >= LINEUP_SWING) {
      const line = lineupDelta > 0
        ? sayAt(voice, LINEUP_UP, { name, pts: pts(lineupDelta) }, upCap)
        : sayAt(voice, LINEUP_DOWN, { name, pts: pts(lineupDelta) }, downCap);
      if (line) out.push(line);
    } else if (!isDynasty) {
      // In a dynasty league a flat lineup is often the point of the deal, so
      // "changes nothing" would be the wrong joke there.
      const line = say(voice, NOTHING_CHANGES, { name });
      if (line) out.push(line);
    }
  }

  return out;
}
