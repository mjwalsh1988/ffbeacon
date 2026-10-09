/**
 * Matchup previews and recaps.
 *
 * BOTH ARE BUILT FROM THE SAME MatchupView the Schedule page renders, which is
 * itself built from `league_power_pulse_cache.weekly`. That is deliberate and it
 * is a rule rather than a convenience: if the preview computed its own
 * projection, the number in the Discord post and the number on the league page
 * would drift apart within a week, and a reader who checked would rightly stop
 * trusting both. One source, two renderings.
 *
 * Both read like a short newspaper piece rather than a report: a one-sentence
 * lede, the odds or the score, a line for each manager pointing the way the
 * numbers point (./takes.ts), the players who matter, and a sign-off.
 *
 * THE PREVIEW is written three days out, when lineups are still movable, so it
 * talks about what a manager can still do: who they are projected to start, how
 * close the game is, what leaving points on the bench would cost them.
 *
 * THE RECAP is written on Tuesday, when nothing can be changed, so it talks
 * about what happened and, more usefully, about what did not: the bench points,
 * the busted projection, the manager who won by starting the wrong quarterback.
 *
 * A NULL PROJECTION IS NEVER A ZERO. Sleeper publishes projections for six
 * positions only, so an IDP slot arrives here as null. It is named and excluded
 * from the totals with a footnote rather than summed as nothing, for exactly
 * the reason `lib/league-schedule/` states: a zero sums into the total and is
 * believed.
 *
 * Venue is never claimed. A fantasy matchup has no home field, so the copy
 * says "against" and "faces" rather than "visits" or "hosts".
 *
 * Pure: takes plain data, returns a Writeup.
 */

import type { MatchupSide, MatchupView } from "@/lib/league-schedule/types";
import type { RelayLeague, RelayTeam, Writeup, WriteupField } from "./types";
import { fitPollAnswer } from "./limits";
import {
  COIN_FLIP_TAKES,
  FAVOURITE_TAKES,
  LOSS_TAKES,
  UNDERDOG_TAKES,
  WIN_TAKES,
  take,
} from "./takes";
import { PREVIEW_CLOSERS, RECAP_CLOSERS, Voice, listOf, ordinal, pct, type Line } from "./voice";
import type { MatchupSlot } from "./select-matchup";

export interface MatchupWriteupInput {
  league: RelayLeague;
  view: MatchupView;
  /**
   * Every roster in the league, keyed by Sleeper roster id.
   *
   * Here for ONE fact: `RelayTeam.standingsRank`, the position in the table. A
   * MatchupSide carries the Power Pulse rank and not that one, and printing the
   * Power Pulse rank beside a record without the table position is what made
   * these writeups read as though they had the standings wrong. See the rank
   * rule at the top of ./voice.ts.
   */
  teams: Map<number, RelayTeam>;
  /** Headline or undercard. Only set on a preview; a recap covers every game. */
  slot: MatchupSlot | null;
  snark: number;
  showNumbers: boolean;
  url: string | null;
  seedKey: string;
}

const PREVIEW_OPENERS: Line[] = [
  { heat: 0, text: "This week's headline game." },
  { heat: 0, text: "The best game on the board this week." },
  { heat: 0.2, text: "The one worth watching." },
  { heat: 0.3, text: "Circle this one." },
  { heat: 0.3, text: "Here is the game that decides how this week feels." },
  { heat: 0.4, text: "The schedule gave us a good one." },
  { heat: 0.4, text: "If you only follow one game this week, make it this one." },
  { heat: 0.5, text: "Two managers who will both tell you they are the underdog." },
  { heat: 0.6, text: "Clear your Sunday, or at least your notifications." },
  { heat: 0.7, text: "Two teams, one of whom is about to learn something." },
  { heat: 0.8, text: "Somebody's group chat privileges are on the line." },
];

const UNDERCARD_OPENERS: Line[] = [
  { heat: 0, text: "Elsewhere on the slate." },
  { heat: 0.2, text: "And now, the other end of the table." },
  { heat: 0.4, text: "The other game worth a look, for different reasons." },
  { heat: 0.5, text: "Somebody has to win this one. Regrettably." },
  { heat: 0.6, text: "Down at the quieter end of the league." },
  { heat: 0.7, text: "The game nobody asked for, previewed anyway, because you are all going to watch it." },
  { heat: 0.8, text: "A game being played, technically, for points." },
  { heat: 0.9, text: "Two teams enter. One team wins. Both should feel a bit bad about it." },
];

const BLOWOUT_LINES: Line[] = [
  { heat: 0.3, text: "This was over early." },
  { heat: 0.4, text: "Nobody needed the late games for this one." },
  { heat: 0.5, text: "It stopped being a contest some time on Sunday morning." },
  { heat: 0.6, text: "Somebody should run a wellness check on the losing side." },
  { heat: 0.8, text: "The scoreboard has asked for it to stop." },
  { heat: 0.9, text: "There is video of this. There should not be." },
];

const NAILBITER_LINES: Line[] = [
  { heat: 0.2, text: "That went to the wire." },
  { heat: 0.3, text: "Decided by less than a single carry." },
  { heat: 0.4, text: "That is the kind of margin people remember in December." },
  { heat: 0.5, text: "Two managers watched the same Monday night game for very different reasons." },
  { heat: 0.6, text: "One catch. That is the whole story." },
  { heat: 0.7, text: "Somebody is going to recount this by hand." },
  { heat: 0.8, text: "A rounding error decided somebody's week. Enjoy it." },
];

/**
 * What a matchup writeup calls a manager: their SLEEPER USERNAME.
 *
 * `loadScheduleBoard` prefers the team name, which is right for the league
 * pages on the site. It is wrong here: the trade and waiver writeups name
 * people by username, and one person appearing as "Midnight Blitz" in a recap
 * and "kendawg9" in a trade post the same morning is a confusion worth avoiding.
 */
function sideName(side: MatchupSide): string {
  return side.ownerHandle?.trim() || side.teamName;
}

function record(side: MatchupSide): string {
  const r = side.record;
  return `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ""}`;
}

/**
 * "**kendawg9** (1-0, 3rd of 12)". The way every team is introduced.
 *
 * THE TABLE POSITION, NOT THE POWER PULSE RANK. This sits immediately after the
 * record, and a rank in that position is read as the standings whatever it
 * actually measures.
 */
function nameWithContext(
  side: MatchupSide,
  league: RelayLeague,
  teams: Map<number, RelayTeam>,
): string {
  const standing = teams.get(side.sleeperRosterId)?.standingsRank ?? null;
  const rank = standing !== null ? `, ${ordinal(standing)} of ${league.totalRosters}` : "";
  return `**${sideName(side)}** (${record(side)}${rank})`;
}

/** The two or three players carrying a side, by projection. */
function topStarters(side: MatchupSide, count = 3): string[] {
  return side.slots
    .map((s) => s.player)
    .filter((p): p is NonNullable<typeof p> => p !== null && p.projected !== null)
    .sort((a, b) => (b.projected ?? 0) - (a.projected ?? 0))
    .slice(0, count)
    .map((p) => `${p.name} (${(p.projected ?? 0).toFixed(1)})`);
}

/** The players who actually decided a finished game. */
function topScorers(side: MatchupSide, count = 3): string[] {
  return side.slots
    .map((s) => s.player)
    .filter((p): p is NonNullable<typeof p> => p !== null && p.actual !== null)
    .sort((a, b) => (b.actual ?? 0) - (a.actual ?? 0))
    .slice(0, count)
    .map((p) => `${p.name} (${(p.actual ?? 0).toFixed(1)})`);
}

/** The starter who most spectacularly failed to show up. */
function biggestBust(voice: Voice, side: MatchupSide): string | null {
  let worst: { name: string; miss: number; actual: number; projected: number } | null = null;
  for (const slot of side.slots) {
    const p = slot.player;
    if (!p || p.projected === null || p.actual === null) continue;
    if (p.projected < 8) continue; // Nobody was counting on him anyway.
    const miss = p.projected - p.actual;
    if (miss <= 0) continue;
    if (!worst || miss > worst.miss) {
      worst = { name: p.name, miss, actual: p.actual, projected: p.projected };
    }
  }
  if (!worst || worst.miss < 5) return null;
  // The team is named, always. Both lineups are on the same screen and a bare
  // player name leaves a reader working out whose he was.
  const team = sideName(side);
  const proj = worst.projected.toFixed(1);
  const got = worst.actual.toFixed(1);
  return voice.pickPlain([
    `${team}'s ${worst.name} was projected for ${proj} and gave them ${got}.`,
    `${worst.name} was supposed to be good for ${proj}. ${team} got ${got}.`,
    `${team} counted on ${proj} from ${worst.name} and got ${got} back.`,
    `${worst.name} put up ${got} for ${team}, against a projection of ${proj}.`,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

export function buildMatchupPreview(input: MatchupWriteupInput): Writeup | null {
  const { view, league } = input;
  if (!view.away) return null;
  const voice = new Voice(input.seedKey, input.snark);
  const home = view.home;
  const away = view.away;
  const isUndercard = input.slot === "undercard";

  /* ---------------------------------------------------------------- lede */
  const one = nameWithContext(away, league, input.teams);
  const two = nameWithContext(home, league, input.teams);
  const lede = voice.pickPlain([
    `${one} faces ${two} in week ${view.week}.`,
    `Week ${view.week} has ${one} against ${two}.`,
    `It is ${one} against ${two} this week.`,
    `${one} takes on ${two} in week ${view.week}.`,
    `${one} and ${two} meet in week ${view.week}.`,
  ]);
  const opener = voice.next() < 0.6 ? voice.pick(isUndercard ? UNDERCARD_OPENERS : PREVIEW_OPENERS) : null;
  const hook = [opener, lede].filter((s): s is string => Boolean(s)).join(" ");

  /* ------------------------------------------------------------ the odds */
  const winProb = view.homeWinProb;
  const haveTotals = home.projectedTotal !== null && away.projectedTotal !== null;
  // The favourite by win probability when there is one, by projected total
  // otherwise, so the two halves of the sentence can never disagree.
  const homeFavoured =
    winProb !== null ? winProb >= 0.5 : (home.projectedTotal ?? 0) >= (away.projectedTotal ?? 0);
  const fav = homeFavoured ? home : away;
  const dog = homeFavoured ? away : home;
  const favName = sideName(fav);
  const dogName = sideName(dog);
  const chance = winProb !== null ? pct(homeFavoured ? winProb : 1 - winProb) : null;
  const favPts = (fav.projectedTotal ?? 0).toFixed(1);
  const dogPts = (dog.projectedTotal ?? 0).toFixed(1);

  let oddsLine = "";
  if (haveTotals && chance) {
    oddsLine = voice.pickPlain([
      `The model has ${favName} at ${favPts} and ${dogName} at ${dogPts}, and gives ${favName} a ${chance} chance.`,
      `${favName} projects for ${favPts} to ${dogName}'s ${dogPts}, which makes ${favName} a ${chance} favourite.`,
      `On projections it is ${favName} ${favPts}, ${dogName} ${dogPts}. ${favName} wins this ${chance} of the time.`,
      `${favName} is the ${chance} pick, ${favPts} to ${dogPts} on projections.`,
    ]);
  } else if (haveTotals) {
    oddsLine = `The model has ${favName} at ${favPts} and ${dogName} at ${dogPts}.`;
  } else if (chance) {
    oddsLine = `The model gives ${favName} a ${chance} chance.`;
  }

  const edge = winProb !== null ? Math.abs(winProb - 0.5) : null;
  const oddsTakes: string[] = [];
  if (edge !== null && edge < 0.06) {
    const line = voice.pick(COIN_FLIP_TAKES);
    if (line) oddsTakes.push(line);
  } else if (edge !== null && edge >= 0.2) {
    const f = take(voice, FAVOURITE_TAKES, favName);
    const d = take(voice, UNDERDOG_TAKES, dogName);
    if (f) oddsTakes.push(f);
    if (d) oddsTakes.push(d);
  }

  /* --------------------------------------------------------- who matters */
  const startersLines: string[] = [];
  for (const side of [away, home]) {
    const top = topStarters(side);
    if (top.length === 0) continue;
    const name = sideName(side);
    const list = listOf(top);
    startersLines.push(
      voice.pickPlain([
        `${name} will lean on ${list}.`,
        `For ${name} it is ${list} carrying the load.`,
        `${name} needs ${list} to show up.`,
        `${name}'s week runs through ${list}.`,
        `Most of ${name}'s hopes sit with ${list}.`,
      ]),
    );
  }
  const starters = startersLines.join(" ");

  /* ------------------------------------------------------------ the bench */
  const benchLines: string[] = [];
  for (const side of [away, home]) {
    if (side.pointsLeftOnBench === null || side.pointsLeftOnBench < 3) continue;
    const name = sideName(side);
    const pts = side.pointsLeftOnBench.toFixed(1);
    const best = side.benchUpgrades[0];
    const fix = best
      ? ` ${voice.pickPlain([
          `Start with ${best.inPlayer.name} over ${best.outPlayer.name} at ${best.slotLabel}.`,
          `${best.inPlayer.name} over ${best.outPlayer.name} at ${best.slotLabel} would be a start.`,
          `Swapping ${best.inPlayer.name} in for ${best.outPlayer.name} at ${best.slotLabel} is the obvious fix.`,
        ])}`
      : "";
    const jab =
      side.pointsLeftOnBench >= 12
        ? voice.pick([
            { heat: 0.3, text: "There are a few days to sort that out." },
            { heat: 0.4, text: "That is a whole starter's worth of points sitting down." },
            { heat: 0.5, text: "That is bigger than most of this week's projected margins." },
            { heat: 0.6, text: "Nobody has to lose this way. And yet." },
            { heat: 0.7, text: "Fix it, or do not, and give the channel something to talk about." },
            { heat: 0.8, text: "This is the number that gets quoted back on Tuesday." },
          ])
        : null;
    benchLines.push(
      `${voice.pickPlain([
        `${name} has ${pts} projected points sitting on the bench right now.`,
        `As things stand, ${name} is leaving ${pts} projected points on the bench.`,
        `${name}'s current lineup leaves ${pts} projected points unused.`,
      ])}${fix}${jab ? ` ${jab}` : ""}`,
    );
  }
  const bench = benchLines.join(" ");

  const closer = voice.pick(PREVIEW_CLOSERS) ?? "Lineups lock Sunday.";

  const footnote = view.hasUnprojectableSlots
    ? "_This league starts positions nobody publishes a projection for, so those slots are named without a number rather than counted as zero._"
    : "";

  /* -------------------------------------------------------------- fields */
  const fields: WriteupField[] = [];
  if (input.showNumbers) {
    for (const side of [away, home]) {
      const rows: string[] = [];
      if (side.projectedTotal !== null) rows.push(`Projected: ${side.projectedTotal.toFixed(1)}`);
      if (side.optimalTotal !== null) rows.push(`Best legal: ${side.optimalTotal.toFixed(1)}`);
      if (side.pointsLeftOnBench !== null) rows.push(`On the bench: ${side.pointsLeftOnBench.toFixed(1)}`);
      rows.push(`Record: ${record(side)}`);
      fields.push({ name: sideName(side), value: rows.join("\n"), inline: true, priority: 0 });
    }
  }

  /* ---------------------------------------------------------------- poll */
  const answerHome = fitPollAnswer(sideName(home));
  const answerAway = fitPollAnswer(sideName(away));
  const poll =
    answerHome && answerAway && answerHome !== answerAway
      ? { question: `Week ${view.week}: who wins?`, answers: [answerAway, answerHome] }
      : null;

  const label = isUndercard ? "Undercard" : "Game of the week";
  return {
    header: league.header,
    type: "matchup_preview",
    title: `${label}: ${sideName(away)} vs ${sideName(home)} (Week ${view.week})`.slice(0, 256),
    sections: [
      { key: "hook", text: hook, priority: 0 },
      { key: "odds", text: [oddsLine, ...oddsTakes].filter(Boolean).join(" "), priority: 1 },
      { key: "starters", text: starters, priority: 2 },
      { key: "bench", text: bench, priority: 2 },
      { key: "closer", text: closer, priority: 3 },
      { key: "footnote", text: footnote, priority: 4 },
    ],
    fields,
    footer: `Week ${view.week} preview`,
    url: input.url,
    poll,
  };
}

/* -------------------------------------------------------------------------- */
/* Recap                                                                      */
/* -------------------------------------------------------------------------- */

/** Margins that change how a result is described. */
const BLOWOUT_MARGIN = 30;
const CLOSE_MARGIN = 5;

export function buildMatchupRecap(input: MatchupWriteupInput): Writeup | null {
  const { view, league } = input;
  if (!view.away) return null;
  // A game that is not final has no result to write about, and guessing at one
  // is the single worst thing this feature could do.
  if (!view.isFinal) return null;
  const voice = new Voice(input.seedKey, input.snark);

  const home = view.home;
  const away = view.away;
  const homePts = home.actualTotal;
  const awayPts = away.actualTotal;
  if (homePts === null || awayPts === null) return null;

  const margin = Math.abs(homePts - awayPts);
  const winner = homePts >= awayPts ? home : away;
  const loser = winner === home ? away : home;
  const tied = margin < 0.01;
  const kind: "big" | "normal" | "close" =
    margin >= BLOWOUT_MARGIN ? "big" : margin < CLOSE_MARGIN ? "close" : "normal";
  const W = sideName(winner);
  const L = sideName(loser);
  const wp = Math.max(homePts, awayPts).toFixed(1);
  const lp = Math.min(homePts, awayPts).toFixed(1);

  /* --------------------------------------------------------------- lede */
  const verb = voice.pickPlain(
    kind === "big"
      ? ["rolled over", "buried", "ran away from", "flattened", "had no trouble with", "blew out"]
      : kind === "close"
        ? ["edged", "held off", "squeaked past", "just got past", "outlasted"]
        : ["beat", "got past", "took care of", "handled", "saw off"],
  );
  const lede = tied
    ? voice.pickPlain([
        `**${sideName(away)}** and **${sideName(home)}** tied at ${awayPts.toFixed(1)}.`,
        `It finished level: **${sideName(away)}** ${awayPts.toFixed(1)}, **${sideName(home)}** ${homePts.toFixed(1)}.`,
      ])
    : voice.pickPlain([
        `**${W}** ${verb} **${L}**, ${wp} to ${lp}.`,
        `**${W}** ${verb} **${L}** ${wp} to ${lp} in week ${view.week}.`,
        `${wp} to ${lp}: **${W}** ${verb} **${L}**.`,
        `Final score, **${W}** ${wp}, **${L}** ${lp}.`,
      ]);
  const colour = tied
    ? voice.pick([
        { heat: 0.2, text: "A tie. Nobody wanted this." },
        { heat: 0.3, text: "A tie, the one result nobody prepares a speech for." },
        { heat: 0.5, text: "Half a win each, and two managers who would rather have lost." },
        { heat: 0.8, text: "Three hours of football for half a point in the standings." },
      ])
    : kind === "close"
      ? voice.pick(NAILBITER_LINES)
      : kind === "big"
        ? voice.pick(BLOWOUT_LINES)
        : null;
  const hook = [lede, colour].filter((s): s is string => Boolean(s)).join(" ");

  /* -------------------------------------------------------------- takes */
  // One line each, in the direction the score points: the winner gets credit
  // sized to the margin, the loser gets the bill. When the loser left more on
  // the bench than they lost by, that is the roast, with the number attached.
  const takes: string[] = [];
  if (!tied) {
    const praise = take(voice, WIN_TAKES[kind], W);
    if (praise) takes.push(praise);

    const benched = loser.pointsLeftOnBench;
    if (benched !== null && benched > 0 && benched >= margin) {
      const jab = voice.pick([
        { heat: 0.3, text: "The right lineup wins this game." },
        { heat: 0.4, text: "The roster was good enough. The Sunday morning was not." },
        { heat: 0.5, text: "This one was lost before kickoff." },
        { heat: 0.6, text: "The lineup screen did more damage than the opponent." },
        { heat: 0.7, text: "The opponent did not beat them. The bench did." },
        { heat: 0.8, text: "No variance excuse available here, which is the cruel part." },
        { heat: 0.9, text: "Print this out. Frame it. Live with it." },
      ]);
      takes.push(
        `${voice.pickPlain([
          `${L} left ${benched.toFixed(1)} points on the bench, more than the ${margin.toFixed(1)} they lost by.`,
          `${L} had ${benched.toFixed(1)} points sitting on the bench and lost by ${margin.toFixed(1)}.`,
          `The bench outscored the margin: ${benched.toFixed(1)} points unused by ${L}, beaten by ${margin.toFixed(1)}.`,
        ])}${jab ? ` ${jab}` : ""}`,
      );
    } else {
      const roast = take(voice, LOSS_TAKES[kind], L);
      if (roast) takes.push(roast);
    }
  }

  /* ---------------------------------------------------------- who did it */
  const scorerLines: string[] = [];
  for (const side of tied ? [away, home] : [winner, loser]) {
    const top = topScorers(side);
    if (top.length === 0) continue;
    const name = sideName(side);
    const list = listOf(top);
    scorerLines.push(
      voice.pickPlain([
        `${list} did the scoring for ${name}.`,
        `${name} got ${list}.`,
        `For ${name} it was ${list}.`,
        `${name}'s points came from ${list}.`,
      ]),
    );
  }
  const scorers = scorerLines.join(" ");

  /* ------------------------------------------------------- what went wrong */
  const wrongLines: string[] = [];
  const loserBust = biggestBust(voice, loser);
  if (loserBust) wrongLines.push(loserBust);
  if (
    !tied &&
    winner.pointsLeftOnBench !== null &&
    loser.pointsLeftOnBench !== null &&
    winner.pointsLeftOnBench > loser.pointsLeftOnBench &&
    winner.pointsLeftOnBench >= 5
  ) {
    const jab = voice.pick([
      { heat: 0.3, text: "Winning is winning." },
      { heat: 0.4, text: "Nobody checks the bench of the team that won." },
      { heat: 0.6, text: "Setting the worse lineup and winning anyway is its own kind of talent." },
      { heat: 0.8, text: "Two managers set two bad lineups and only one of them has to answer for it." },
    ]);
    wrongLines.push(
      `${W} left ${winner.pointsLeftOnBench.toFixed(1)} on their own bench, more than ${L} did, and won anyway.${
        jab ? ` ${jab}` : ""
      }`,
    );
  }
  const winnerBust = biggestBust(voice, winner);
  if (winnerBust && wrongLines.length < 2) wrongLines.push(winnerBust);
  const wrong = wrongLines.join(" ");

  /* ------------------------------------------------------------ standings */
  // Records only, and the table position a reader can check in Sleeper.
  const where = (side: MatchupSide): string => {
    const rank = input.teams.get(side.sleeperRosterId)?.standingsRank ?? null;
    return rank !== null ? `${record(side)}, ${ordinal(rank)} of ${league.totalRosters}` : record(side);
  };
  const standings = tied
    ? `Both sit at ${record(home)} now.`
    : voice.pickPlain([
        `${W} moves to ${where(winner)}. ${L} drops to ${where(loser)}.`,
        `That puts ${W} at ${where(winner)} and ${L} at ${where(loser)}.`,
        `${W} is now ${where(winner)}, ${L} ${where(loser)}.`,
      ]);

  const closer = voice.pick(RECAP_CLOSERS) ?? "On to next week.";

  /* -------------------------------------------------------------- fields */
  const fields: WriteupField[] = [];
  if (input.showNumbers) {
    for (const side of [winner, loser]) {
      const rows: string[] = [];
      if (side.actualTotal !== null) rows.push(`Scored: ${side.actualTotal.toFixed(1)}`);
      if (side.projectedTotal !== null) {
        const diff = (side.actualTotal ?? 0) - side.projectedTotal;
        rows.push(
          `Projected: ${side.projectedTotal.toFixed(1)} (${diff >= 0 ? "+" : ""}${diff.toFixed(1)})`,
        );
      }
      if (side.optimalTotal !== null) rows.push(`Best legal: ${side.optimalTotal.toFixed(1)}`);
      if (side.pointsLeftOnBench !== null) {
        rows.push(`Left on bench: ${side.pointsLeftOnBench.toFixed(1)}`);
      }
      rows.push(`Record: ${record(side)}`);
      fields.push({ name: sideName(side), value: rows.join("\n"), inline: true, priority: 0 });
    }
  }

  return {
    header: league.header,
    type: "matchup_recap",
    // "beat" would be a lie on a tie, and a tie is rare enough that nobody
    // would have caught it in review for months.
    title: (tied
      ? `Week ${view.week}: ${sideName(away)} tied ${sideName(home)}`
      : `Week ${view.week}: ${W} beat ${L}`
    ).slice(0, 256),
    sections: [
      { key: "hook", text: hook, priority: 0 },
      { key: "takes", text: takes.join(" "), priority: 1 },
      { key: "scorers", text: scorers, priority: 2 },
      { key: "autopsy", text: wrong, priority: 2 },
      { key: "standings", text: standings, priority: 3 },
      { key: "closer", text: closer, priority: 3 },
    ],
    fields,
    footer: `Week ${view.week} recap`,
    url: input.url,
    // No poll on a recap. The game is over; there is nothing left to predict,
    // and a poll on a settled result is just an invitation to pile on.
    poll: null,
  };
}
