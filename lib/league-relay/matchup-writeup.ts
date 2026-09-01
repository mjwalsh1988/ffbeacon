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
 * THE PREVIEW is written three days out, when lineups are still movable, so it
 * talks about what a manager can still do: who they are projected to start, how
 * close the game is, what leaving points on the bench would cost them.
 *
 * THE RECAP is written on Tuesday, when nothing can be changed, so it talks
 * about what happened and, more usefully, about what did not: the bench points,
 * the busted projection, the manager who won by starting the wrong quarterback.
 * That is the funniest information in fantasy football and it is only available
 * after the fact.
 *
 * A NULL PROJECTION IS NEVER A ZERO. Sleeper publishes projections for six
 * positions only, so an IDP slot arrives here as null. It is named and excluded
 * from the totals with a footnote rather than summed as nothing, for exactly
 * the reason `lib/league-schedule/` states: a zero sums into the total and is
 * believed.
 *
 * Pure: takes plain data, returns a Writeup.
 */

import type { MatchupSide, MatchupView } from "@/lib/league-schedule/types";
import type { RelayLeague, Writeup, WriteupField } from "./types";
import { fitPollAnswer } from "./limits";
import {
  PREVIEW_CLOSERS,
  RECAP_CLOSERS,
  Voice,
  bandFromRank,
  describeBand,
  listOf,
  ordinal,
  pct,
  type Line,
} from "./voice";
import type { MatchupSlot } from "./select-matchup";

export interface MatchupWriteupInput {
  league: RelayLeague;
  view: MatchupView;
  /** Headline or undercard. Only set on a preview; a recap covers every game. */
  slot: MatchupSlot | null;
  snark: number;
  showNumbers: boolean;
  url: string | null;
  seedKey: string;
}

const PREVIEW_OPENERS: Line[] = [
  { heat: 0, text: "This week's headline game." },
  { heat: 0.3, text: "Circle this one." },
  { heat: 0.5, text: "Two managers who will both tell you they are underdogs." },
];

const UNDERCARD_OPENERS: Line[] = [
  { heat: 0.2, text: "And now, the other end of the table." },
  { heat: 0.5, text: "Somebody has to win this. Regrettably." },
  { heat: 0.7, text: "The game nobody asked for, previewed anyway, because you are all watching." },
  { heat: 0.9, text: "Two teams enter. One team wins. Both teams should feel bad." },
];

const BLOWOUT_LINES: Line[] = [
  { heat: 0.3, text: "This was over early." },
  { heat: 0.6, text: "This was not a fantasy matchup, it was a wellness check." },
  { heat: 0.9, text: "There is video of this. There should not be." },
];

const NAILBITER_LINES: Line[] = [
  { heat: 0.2, text: "That went to the wire." },
  { heat: 0.3, text: "Decided by less than a single carry." },
  { heat: 0.5, text: "Somebody's Monday night kicker earned a Christmas card." },
  { heat: 0.5, text: "Two managers watched the same Monday night game for entirely different reasons." },
  { heat: 0.7, text: "One roster move in either direction and this flips. Sleep well." },
  { heat: 0.8, text: "A rounding error decided somebody's playoff seeding. Enjoy your week." },
];

/**
 * What a matchup writeup calls a manager: their SLEEPER USERNAME.
 *
 * `loadScheduleBoard` prefers the team name, which is right for the league
 * pages on the site: there the roster is the subject and its name is a label
 * the manager chose. It is wrong here. A Discord channel can carry several
 * leagues, the trade and waiver writeups name people by username, and one
 * person appearing as "Midnight Blitz" in a recap and "kendawg9" in a trade
 * post the same morning is precisely the confusion the header exists to end.
 *
 * The board already carries the handle, so this is a preference rather than an
 * extra read, and the shared loader keeps behaving as the site needs.
 */
function sideName(side: MatchupSide): string {
  return side.ownerHandle?.trim() || side.teamName;
}

function record(side: MatchupSide): string {
  const r = side.record;
  return `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ""}`;
}

/** "Team Name (4-2, 3rd)". The way every team is introduced. */
function nameWithContext(side: MatchupSide, totalRosters: number): string {
  const rank = side.pulseRank !== null ? `, ${ordinal(side.pulseRank)} of ${totalRosters}` : "";
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
function biggestBust(side: MatchupSide): string | null {
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
  return `${sideName(side)}'s ${worst.name} was projected for ${worst.projected.toFixed(
    1,
  )} and returned ${worst.actual.toFixed(1)}.`;
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

  const opener =
    voice.pick(isUndercard ? UNDERCARD_OPENERS : PREVIEW_OPENERS) ??
    (isUndercard ? "The other end of the table." : "This week's headline game.");

  const hook = `${opener} ${nameWithContext(away, league.totalRosters)} at ${nameWithContext(
    home,
    league.totalRosters,
  )}, week ${view.week}.`;

  /* ------------------------------------------------------------ the odds */
  const oddsBits: string[] = [];
  if (home.projectedTotal !== null && away.projectedTotal !== null) {
    const favourite = home.projectedTotal >= away.projectedTotal ? home : away;
    const underdog = favourite === home ? away : home;
    const gap = Math.abs(home.projectedTotal - away.projectedTotal);
    oddsBits.push(
      `The model has ${sideName(favourite)} at ${(favourite.projectedTotal ?? 0).toFixed(
        1,
      )} and ${sideName(underdog)} at ${(underdog.projectedTotal ?? 0).toFixed(1)}`,
    );
    if (gap < 5) oddsBits.push("which is close enough to be nothing at all");
    else if (gap > 25) oddsBits.push(`a ${gap.toFixed(0)} point chasm`);
  }
  const winProb = view.homeWinProb;
  if (winProb !== null) {
    const favourite = winProb >= 0.5 ? home : away;
    const p = pct(winProb >= 0.5 ? winProb : 1 - winProb);
    oddsBits.push(`${sideName(favourite)} wins this ${p} of the time`);
  }
  const oddsLine = oddsBits.length > 0 ? `${listOf(oddsBits)}.` : "";

  const flavour = (() => {
    if (winProb === null) return null;
    const edge = Math.abs(winProb - 0.5);
    if (edge < 0.06) {
      return voice.pick([
        { heat: 0.2, text: "A genuine coin flip, which nobody involved will accept as an excuse afterwards." },
        { heat: 0.6, text: "Fifty-fifty, so both managers get to spend the week convinced they are being robbed." },
      ]);
    }
    if (edge > 0.28) {
      const dog = winProb >= 0.5 ? away : home;
      return voice.pick([
        { heat: 0.3, text: `${sideName(dog)} needs help. Quite a lot of it.` },
        { heat: 0.6, text: `${sideName(dog)} is not favoured, and the projections are being polite about it.` },
        { heat: 0.9, text: `${sideName(dog)} could start every player twice and still be behind.` },
      ]);
    }
    return null;
  })();

  /* --------------------------------------------------------- who matters */
  const startersLines: string[] = [];
  for (const side of [away, home]) {
    const top = topStarters(side);
    if (top.length > 0) {
      startersLines.push(`**${sideName(side)}** lean on ${listOf(top)}.`);
    }
  }
  // One paragraph rather than two stacked lines: the two lists are meant to be
  // compared, and a line break between them invites reading them separately.
  const starters = startersLines.join(" ");

  /* ------------------------------------------------------------ the bench */
  const benchLines: string[] = [];
  for (const side of [away, home]) {
    if (side.pointsLeftOnBench !== null && side.pointsLeftOnBench >= 3) {
      const best = side.benchUpgrades[0];
      const jab =
        side.pointsLeftOnBench >= 12
          ? voice.pick([
              { heat: 0.4, text: "That is a whole starter's worth of nothing." },
              { heat: 0.7, text: "Fix it, or do not, and let the channel enjoy itself." },
            ])
          : null;
      benchLines.push(
        `${sideName(side)} currently have ${side.pointsLeftOnBench.toFixed(
          1,
        )} projected points on the bench${
          best ? `, starting with ${best.inPlayer.name} over ${best.outPlayer.name} in the ${best.slotLabel}` : ""
        }.${jab ? ` ${jab}` : ""}`,
      );
    }
  }
  // No heading. "Still fixable" was a label for a sentence that already says so,
  // and the bold text made the message look like a form.
  const bench = benchLines.join(" ");

  /* ----------------------------------------------------------- standings */
  const stakes = (() => {
    const clauses: string[] = [];
    for (const side of [away, home]) {
      if (side.pulseRank === null) continue;
      const band = bandFromRank(side.pulseRank, league.totalRosters);
      clauses.push(`${sideName(side)} are ${describeBand(voice, band)}`);
    }
    if (clauses.length === 0) return "";
    // One sentence: the whole value of naming both bands is the contrast
    // between them, which two separate lines throws away.
    return `${clauses.join("; ")}.`;
  })();

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
    title: `${label}: ${sideName(away)} at ${sideName(home)} (Week ${view.week})`.slice(0, 256),
    sections: [
      { key: "hook", text: hook, priority: 0 },
      { key: "odds", text: [oddsLine, flavour].filter(Boolean).join(" "), priority: 1 },
      { key: "starters", text: starters, priority: 2 },
      { key: "bench", text: bench, priority: 2 },
      { key: "stakes", text: stakes, priority: 3 },
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
  const tied = Math.abs(homePts - awayPts) < 0.01;

  /* --------------------------------------------------------------- hook */
  const verdict = tied
    ? voice.pick([
        { heat: 0.2, text: "A tie. Nobody wanted this." },
        { heat: 0.6, text: "A tie, which is fantasy football's way of wasting everybody's Sunday." },
      ]) ?? "A tie."
    : margin < 5
      ? voice.pick(NAILBITER_LINES) ?? "That went to the wire."
      : margin > 40
        ? voice.pick(BLOWOUT_LINES) ?? "This was over early."
        : "";

  const scoreLine = tied
    ? `${sideName(away)} ${awayPts.toFixed(1)}, ${sideName(home)} ${homePts.toFixed(1)}. Tied.`
    : `**${sideName(winner)} ${Math.max(homePts, awayPts).toFixed(1)}, ${
        sideName(loser)
      } ${Math.min(homePts, awayPts).toFixed(1)}.** A margin of ${margin.toFixed(1)}.`;

  const hook = [scoreLine, verdict].filter(Boolean).join(" ");

  /* ---------------------------------------------------------- who did it */
  const scorerLines: string[] = [];
  for (const side of [winner, loser]) {
    const top = topScorers(side);
    if (top.length > 0) scorerLines.push(`${listOf(top)} for **${sideName(side)}**.`);
  }
  // No heading, one paragraph. The two lists exist to be read against each
  // other, which is what the bold label above them was standing in for.
  const scorers =
    scorerLines.length > 0 ? `The work was done by ${scorerLines.join(" ")}` : "";

  /* ------------------------------------------------------- what went wrong */
  const wrongLines: string[] = [];
  const loserBust = biggestBust(loser);
  if (loserBust) wrongLines.push(loserBust);

  // The bench line is the cruellest fact available and the reason people read
  // recaps: it says the loss was avoidable, with a number attached.
  if (loser.pointsLeftOnBench !== null && loser.pointsLeftOnBench > 0 && !tied) {
    const enough = loser.pointsLeftOnBench >= margin;
    if (enough) {
      const jab = voice.pick([
        { heat: 0.3, text: "The right lineup wins this game." },
        { heat: 0.6, text: "That is not a loss to the opponent. That is a loss to the lineup screen." },
        { heat: 0.9, text: "Print this out. Frame it. Live with it." },
      ]);
      wrongLines.push(
        `${sideName(loser)} left ${loser.pointsLeftOnBench.toFixed(
          1,
        )} points on the bench, more than the ${margin.toFixed(1)} they lost by.${jab ? ` ${jab}` : ""}`,
      );
    } else if (loser.pointsLeftOnBench >= 5) {
      wrongLines.push(
        `${sideName(loser)} left ${loser.pointsLeftOnBench.toFixed(
          1,
        )} on the bench, which was not enough to matter, for once.`,
      );
    }
  }

  if (
    winner.pointsLeftOnBench !== null &&
    loser.pointsLeftOnBench !== null &&
    winner.pointsLeftOnBench > loser.pointsLeftOnBench &&
    winner.pointsLeftOnBench >= 5
  ) {
    const jab = voice.pick([
      { heat: 0.3, text: "Winning is winning." },
      { heat: 0.6, text: "Setting the worse lineup and winning anyway is its own kind of talent." },
      { heat: 0.9, text: "Two managers set two bad lineups and only one of them has to answer for it." },
    ]);
    wrongLines.push(
      `${sideName(winner)} left ${winner.pointsLeftOnBench.toFixed(
        1,
      )} on their own bench, more than ${sideName(loser)} did, and won regardless.${
        jab ? ` ${jab}` : ""
      }`,
    );
  }

  const winnerBust = biggestBust(winner);
  if (winnerBust && wrongLines.length < 3) {
    // biggestBust already names the team, so a "TeamName won anyway despite
    // this" prefix said the name twice and left a fragment between them. Two
    // whole sentences rather than a colon, because lowercasing the second one
    // to splice it in would have mangled any team name that starts with a
    // capital, which is most of them.
    wrongLines.push(`It was not one-sided incompetence. ${winnerBust}`);
  }
  const wrong = wrongLines.join(" ");

  /* ------------------------------------------------------------ standings */
  const standings = (() => {
    const clauses: string[] = [];
    for (const side of [winner, loser]) {
      if (side.pulseRank === null) continue;
      const band = bandFromRank(side.pulseRank, league.totalRosters);
      clauses.push(
        `${sideName(side)} are ${record(side)} and ${ordinal(side.pulseRank)} of ${
          league.totalRosters
        }, which is to say ${describeBand(voice, band)}`,
      );
    }
    if (clauses.length === 0) return "";
    return `That leaves the table where it was: ${clauses.join("; ")}.`;
  })();

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
      : `Week ${view.week}: ${sideName(winner)} beat ${sideName(loser)}`
    ).slice(0, 256),
    sections: [
      { key: "hook", text: hook, priority: 0 },
      { key: "scorers", text: scorers, priority: 1 },
      { key: "autopsy", text: wrong, priority: 1 },
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
