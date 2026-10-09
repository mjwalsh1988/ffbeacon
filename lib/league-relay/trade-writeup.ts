/**
 * The trade writeup.
 *
 * A trade is the one thing that happens in a fantasy league where everybody has
 * an opinion and nobody has the numbers. The writeup reads like a short piece
 * in a league newspaper: who sent what, who won it, a line of praise for the
 * manager who did well and a roast for the one who did not, what it does to
 * each team's season, and a sign-off. It is assembled from three sources, all
 * of which the site already computes for its own pages:
 *
 *   SIGNAL CHECK      who won on value, by how much, and how sure it is.
 *                     lib/league-signal-check.ts, the same pipeline behind
 *                     /tools/trade-calculator and the League Pulse feed.
 *   TRADE IMPACT      what it does to each team's remaining season: optimal
 *                     lineup points per week, projected wins, playoff odds,
 *                     title odds. lib/league-relay/trade-impact.ts.
 *   THE LEAGUE ITSELF where each team sits, and whether this is a dynasty
 *                     league where age and picks are currency or a one-year
 *                     league where only the next nine weeks exist.
 *
 * THE PRAISE AND THE ROAST FOLLOW THE NUMBERS. Each manager is graded first
 * (`tradeScore`), and the line is drawn from the bank for that grade, so the
 * winner of a 30% blowout is never the one being mocked. In a redraft league
 * the grade leans on playoff odds, because value barely matters when there is
 * no next year; in a dynasty league it leans on value, adjusted for whether the
 * direction suits where the team actually sits.
 *
 * Pure: takes plain data, returns a Writeup, touches no database and no clock.
 */

import { NO_VERDICT_REASON, NO_VERDICT_LABEL, partialGradeNote } from "@/lib/trade-grading/partial";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { LeagueTradeAssetMeta } from "@/lib/league-signal-check";
import type { SideKey } from "@/lib/signal-check/types";
import type { ExecutedTeamImpact, ExecutedTradeImpact } from "./trade-impact";
import type { RelayLeague, RelayTeam, Writeup, WriteupField } from "./types";
import { fitPollAnswer } from "./limits";
import { TRADE_CLOSERS, TRADE_TAKES, gradeFromScore, take, type Grade } from "./takes";
import {
  EVEN_LINES,
  TRADE_OPENERS,
  Voice,
  bandFromRank,
  listOf,
  pct,
  ppChange,
  pulseFieldSize,
  pulsePhrase,
  signed,
} from "./voice";

export interface TradeWriteupInput {
  league: RelayLeague;
  /** The two teams, A first. A is the lower Sleeper roster id, as Signal Check orders them. */
  teamA: RelayTeam;
  teamB: RelayTeam;
  /** Signal Check's read. Side "a" is teamA. */
  view: BuilderView;
  assetMeta: Record<SideKey, LeagueTradeAssetMeta[]>;
  /** Null when the swap could not be modelled. The writeup then runs on values alone. */
  impact: ExecutedTradeImpact | null;
  /** The trade's NFL week, when it has one. */
  week: number | null;
  /** Snark dial, 0 to 1. */
  snark: number;
  showNumbers: boolean;
  /** The league page on ffbeacon.com, or null when linking back is switched off. */
  url: string | null;
  /** Seeds the voice, so the same trade always reads the same. */
  seedKey: string;
}

/** Asset names for one side, bare. */
function assetNames(view: BuilderView, side: SideKey): string[] {
  const s = view.sides.find((x) => x.side === side);
  return (s?.assets ?? []).map((a) => a.name);
}

/** "a two-for-one", "a straight one-for-one". How the deal is described in one phrase. */
function tradeShape(aCount: number, bCount: number): string {
  if (aCount === 1 && bCount === 1) return "a straight one-for-one";
  const word = (n: number): string =>
    ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"][n] ?? String(n);
  // Larger side first, which is how anybody says it out loud.
  const [big, small] = aCount >= bCount ? [aCount, bCount] : [bCount, aCount];
  return `a ${word(big)}-for-${word(small)}`;
}

/** The winner's team name, or null on a neutral verdict. */
function winnerName(view: BuilderView, teamA: RelayTeam, teamB: RelayTeam): string | null {
  if (view.isNeutral || !view.winnerSide) return null;
  return view.winnerSide === "a" ? teamA.name : teamB.name;
}

/**
 * How well one side did, as a number the grade bands read.
 *
 * VALUE is Signal Check's verdict: plus one for the winner, minus one for the
 * loser, doubled on a blowout, nothing on a neutral or ungraded trade.
 *
 * In a REDRAFT league value counts half, and the change in playoff odds
 * carries the rest, because a redraft manager who gave up value to jump from
 * 30% to 55% made the right trade and deserves the praise for it.
 *
 * In a DYNASTY league value counts in full, adjusted by fit: buying win-now
 * help from the bottom of the league costs a grade step, selling for the future
 * from down there earns half of one, and the same moves from the top of the
 * league point the other way.
 */
function tradeScore(
  view: BuilderView,
  side: SideKey,
  team: ExecutedTeamImpact | null,
  isDynasty: boolean,
  league: RelayLeague,
): number {
  let value = 0;
  if (view.graded !== false && !view.isNeutral && view.winnerSide) {
    value = (view.winnerSide === side ? 1 : -1) * (view.isBlowout ? 2 : 1);
  }
  if (!team) return value;

  if (!isDynasty) {
    let wins = 0;
    const playoff = ppChange(team.playoffOddsBefore, team.playoffOddsAfter)?.delta ?? 0;
    if (playoff >= 15) wins = 1.5;
    else if (playoff >= 5) wins = 1;
    else if (playoff <= -15) wins = -1.5;
    else if (playoff <= -5) wins = -1;
    else if (team.lineupDelta !== null && Math.abs(team.lineupDelta) >= 1.5) {
      wins = team.lineupDelta > 0 ? 0.5 : -0.5;
    }
    return value * 0.5 + wins;
  }

  const band = bandFromRank(team.pulseRank, pulseFieldSize(league));
  const contender = band === "elite" || band === "good";
  const struggling = band === "poor" || band === "dire";
  const buyingNow = (team.lineupDelta ?? 0) > 0.5 && team.valueDelta < 0;
  const sellingOff = (team.lineupDelta ?? 0) < -0.5 && team.valueDelta > 0;
  let fit = 0;
  if (buyingNow && struggling) fit = -1;
  else if (buyingNow && contender) fit = 0.5;
  else if (sellingOff && struggling) fit = 0.5;
  else if (sellingOff && contender) fit = -0.5;
  return value + fit;
}

/**
 * The single figure that best says what the deal did to one team's season,
 * as one sentence. Playoff odds when they moved, the weekly lineup when they
 * did not. A null figure is left out rather than printed as a zero.
 */
function seasonLine(voice: Voice, team: ExecutedTeamImpact, name: string): string | null {
  const playoff = ppChange(team.playoffOddsBefore, team.playoffOddsAfter);
  const from = pct(team.playoffOddsBefore);
  const to = pct(team.playoffOddsAfter);
  if (playoff && playoff.delta !== 0 && from && to) {
    return voice.pickPlain([
      `${name}'s playoff odds go from ${from} to ${to}.`,
      `It moves ${name} from ${from} to ${to} to make the playoffs.`,
      `${name} goes from a ${from} playoff shot to ${to}.`,
      `For ${name}, the playoff odds move from ${from} to ${to}.`,
      `${name} now makes the playoffs ${to} of the time, from ${from}.`,
    ]);
  }
  if (team.lineupDelta !== null && Math.abs(team.lineupDelta) >= 0.3) {
    const pts = Math.abs(team.lineupDelta).toFixed(1);
    return team.lineupDelta > 0
      ? voice.pickPlain([
          `${name}'s best lineup picks up about ${pts} points a week.`,
          `It is worth roughly ${pts} more points a week to ${name}'s starters.`,
          `${name} gets about ${pts} points a week stronger.`,
        ])
      : voice.pickPlain([
          `${name}'s best lineup gets about ${pts} points a week weaker.`,
          `It costs ${name}'s starters roughly ${pts} points a week.`,
          `${name} is about ${pts} points a week lighter.`,
        ]);
  }
  return null;
}

/** Value, age and picks for a dynasty side, in one short sentence. */
function dynastyLine(voice: Voice, team: ExecutedTeamImpact, name: string): string | null {
  const bits: string[] = [];
  if (Math.abs(team.valueDelta) >= 1) {
    bits.push(`${signed(team.valueDelta, 0)} in trade value`);
  }
  if (team.ageDelta !== null && Math.abs(team.ageDelta) >= 0.2) {
    bits.push(`${Math.abs(team.ageDelta).toFixed(1)} years ${team.ageDelta < 0 ? "younger" : "older"} where it counts`);
  }
  if (team.pickCountDelta !== 0) {
    const n = Math.abs(team.pickCountDelta);
    bits.push(`${n} ${team.pickCountDelta > 0 ? "more" : "fewer"} draft pick${n === 1 ? "" : "s"}`);
  }
  if (bits.length === 0) return null;
  const list = listOf(bits);
  return voice.pickPlain([`For ${name}: ${list}.`, `${name} comes away ${list}.`, `The tally for ${name}: ${list}.`]);
}

/**
 * Whether the direction of the deal suits where the team sits. Only the four
 * cases worth saying out loud produce a sentence. The Power Pulse rank is
 * named wherever it is printed (see the rank rule in ./voice.ts).
 */
function fitLine(
  team: ExecutedTeamImpact,
  name: string,
  league: RelayLeague,
  isDynasty: boolean,
): string | null {
  const band = bandFromRank(team.pulseRank, pulseFieldSize(league));
  const pulse = pulsePhrase(team.pulseRank, league);
  if (!pulse) return null;
  const contender = band === "elite" || band === "good";
  const struggling = band === "poor" || band === "dire";
  const delta = team.lineupDelta ?? 0;

  if (isDynasty) {
    const buyingNow = delta > 0.5 && team.valueDelta < 0;
    const sellingOff = delta < -0.5 && team.valueDelta > 0;
    if (buyingNow && contender) return `${name} is ${pulse}, and paying up to win now is exactly what a team there should do.`;
    if (buyingNow && struggling) return `Buying win-now help from ${pulse} is a brave call.`;
    if (sellingOff && struggling) return `Selling for the future from ${pulse} is the textbook move, so credit to ${name}.`;
    if (sellingOff && contender) return `Selling from ${pulse} is either a long game or a mistake, and December will say which.`;
    return null;
  }
  if (delta >= 0.3 && struggling) {
    return `${name} is ${pulse}, so this is rearranging the furniture, but it is nicer furniture.`;
  }
  if (delta <= -0.3 && contender) {
    return `Giving up points from ${pulse} in a league with no next year is a bold read on the cushion.`;
  }
  return null;
}

/**
 * "The player you sold would still have started" fact, with how many weeks it
 * rests on, so the caller can pick the more striking of the two.
 */
function departedFact(
  team: ExecutedTeamImpact,
  teamName: string,
  weeksLeft: number,
): { text: string; weeks: number } | null {
  let best: { name: string; weeks: number } | null = null;
  for (const asset of team.sent) {
    if (asset.kind !== "player") continue;
    const weeks = team.departedStartWeeks[asset.playerId] ?? 0;
    if (!best || weeks > best.weeks) best = { name: asset.name, weeks };
  }
  if (!best || best.weeks === 0 || weeksLeft === 0) return null;

  if (best.weeks >= weeksLeft) {
    return {
      weeks: best.weeks,
      text: `${best.name} would have started every one of ${teamName}'s remaining ${weeksLeft} week${
        weeksLeft === 1 ? "" : "s"
      }.`,
    };
  }
  if (best.weeks / weeksLeft >= 0.5) {
    return {
      weeks: best.weeks,
      text: `${best.name} would have started for ${teamName} in ${best.weeks} of the ${weeksLeft} weeks left.`,
    };
  }
  return {
    weeks: best.weeks,
    text: `${best.name} would only have cracked ${teamName}'s lineup ${best.weeks} time${
      best.weeks === 1 ? "" : "s"
    } in ${weeksLeft} weeks, which is the best argument for this deal.`,
  };
}

/** The stat block. Dropped whole if the embed is tight; never trimmed. */
function buildFields(
  view: BuilderView,
  impact: ExecutedTradeImpact | null,
  teamA: RelayTeam,
  teamB: RelayTeam,
  showNumbers: boolean,
): WriteupField[] {
  if (!showNumbers) return [];
  const fields: WriteupField[] = [];
  const winnerLabel = winnerName(view, teamA, teamB) ?? "Neither";

  const verdictBits = [
    view.graded === false
      ? NO_VERDICT_LABEL
      : view.isNeutral
        ? "Too close to call"
        : `${winnerLabel} by ${view.marginPct.toFixed(1)}%`,
    view.partial ? partialGradeNote(view.unpricedCount) : null,
    // Already a full phrase ("High confidence"); appending the noun again
    // produced "High confidence confidence" in the first real run.
    view.confidenceLabel,
    view.tradeShapeLabel,
  ].filter((b): b is string => Boolean(b));
  fields.push({
    name: "Signal Check",
    value: verdictBits.join(" | "),
    priority: 0,
  });

  if (impact) {
    for (const [team, label] of [
      [impact.a, teamA.name],
      [impact.b, teamB.name],
    ] as const) {
      const rows: string[] = [];
      if (team.lineupBefore !== null && team.lineupAfter !== null) {
        rows.push(
          `Lineup/wk: ${team.lineupBefore.toFixed(1)} to ${team.lineupAfter.toFixed(1)} (${signed(
            team.lineupDelta ?? 0,
          )})`,
        );
      }
      if (team.projectedWinsBefore !== null && team.projectedWinsAfter !== null) {
        rows.push(
          `Proj wins: ${team.projectedWinsBefore.toFixed(1)} to ${team.projectedWinsAfter.toFixed(1)}`,
        );
      }
      const playoffFrom = pct(team.playoffOddsBefore);
      const playoffTo = pct(team.playoffOddsAfter);
      if (playoffFrom && playoffTo) rows.push(`Playoffs: ${playoffFrom} to ${playoffTo}`);
      const titleFrom = pct(team.titleOddsBefore, 1);
      const titleTo = pct(team.titleOddsAfter, 1);
      if (titleFrom && titleTo) rows.push(`Title: ${titleFrom} to ${titleTo}`);
      if (impact.isDynasty && Math.abs(team.valueDelta) >= 1) {
        rows.push(`Value: ${signed(team.valueDelta, 0)}`);
      }
      if (impact.isDynasty && team.ageDelta !== null && Math.abs(team.ageDelta) >= 0.1) {
        rows.push(`Age: ${signed(team.ageDelta)} yrs`);
      }
      if (rows.length > 0) {
        fields.push({ name: label, value: rows.join("\n"), inline: true, priority: 1 });
      }
    }
  }

  return fields;
}

/** Build the trade writeup. Returns null only when there is nothing to say. */
export function buildTradeWriteup(input: TradeWriteupInput): Writeup | null {
  const { view, impact, teamA, teamB, league } = input;
  const voice = new Voice(input.seedKey, input.snark);

  const aGets = assetNames(view, "a");
  const bGets = assetNames(view, "b");
  if (aGets.length === 0 && bGets.length === 0) return null;

  const weeksLeft = impact?.weeksConsidered ?? 0;
  const isDynasty = impact?.isDynasty ?? false;
  const winner = winnerName(view, teamA, teamB);
  const A = teamA.name;
  const B = teamB.name;

  /* ---------------------------------------------------------------- lede */
  // The assets are named once, here, in a sentence. A trade is the one message
  // whose poll names only the two teams, so the article has to say what moved,
  // and a sentence says it in fewer lines than a list under two headings.
  const aList = listOf(aGets);
  const bList = listOf(bGets);
  const be = (n: number) => (n > 1 ? "are" : "is");
  const shape = tradeShape(aGets.length, bGets.length);
  const lede = voice.pickPlain([
    `**${A}** sent ${bList} to **${B}** for ${aList}.`,
    `**${A}** and **${B}** have agreed ${shape}: ${aList} to ${A}, ${bList} to ${B}.`,
    `**${B}** landed ${bList} from **${A}**, who took ${aList} back.`,
    `${aList} ${be(aGets.length)} headed to **${A}**, and ${bList} ${be(bGets.length)} going the other way to **${B}**.`,
    `It is ${shape} between **${A}** and **${B}**, with ${aList} going to ${A} and ${bList} to ${B}.`,
    `**${A}** has moved ${bList} to **${B}** and gets ${aList} in return.`,
  ]);
  // An opener on about half of them, so the lede does not always start the
  // same way and does not always have a throat-clearing line in front of it.
  const opener = voice.next() < 0.5 ? voice.pick(TRADE_OPENERS) : null;
  const hook = [opener, lede].filter((s): s is string => Boolean(s)).join(" ");

  /* ------------------------------------------------------------- verdict */
  const ungraded = view.graded === false;
  const m = `${view.marginPct.toFixed(1)}%`;
  const fmt = view.formatDisplay;
  const conf = view.confidenceLabel ? ` (${view.confidenceLabel.toLowerCase()})` : "";
  const verdict = ungraded
    ? `No Signal Check verdict on this one: ${NO_VERDICT_REASON.charAt(0).toLowerCase()}${NO_VERDICT_REASON.slice(1)}`
    : winner
      ? voice.pickPlain([
          `Signal Check has it as **${winner}'s** deal, by ${m} on ${fmt} values${conf}.`,
          `On ${fmt} values, **${winner}** wins it by ${m}${conf}.`,
          `Signal Check scores it ${m} in favour of **${winner}**${conf}.`,
          `By Signal Check's ${fmt} numbers, **${winner}** comes out ${m} ahead${conf}.`,
        ])
      : voice.pickPlain([
          `Signal Check has the two sides ${m} apart on ${fmt} values, which is too close to call${conf}.`,
          `On ${fmt} values it is basically even, ${m} apart${conf}.`,
          `Signal Check cannot split them: ${m} apart on ${fmt} values${conf}.`,
        ]);
  const partial = !ungraded && view.partial ? partialGradeNote(view.unpricedCount) : null;

  // The takes. The better-graded side first, so the paragraph reads as praise
  // and then the bill. Two even grades get one line about the pair instead.
  const graded: Array<{ name: string; grade: Grade; score: number }> = [
    { name: A, score: tradeScore(view, "a", impact?.a ?? null, isDynasty, league), grade: "even" },
    { name: B, score: tradeScore(view, "b", impact?.b ?? null, isDynasty, league), grade: "even" },
  ]
    .map((g) => ({ ...g, grade: gradeFromScore(g.score) }))
    .sort((x, y) => y.score - x.score);
  const takes: string[] = [];
  for (const g of graded) {
    if (g.grade === "even") continue;
    const line = take(voice, TRADE_TAKES[g.grade], g.name);
    if (line) takes.push(line);
  }
  if (takes.length === 0 && !ungraded && view.isNeutral) {
    const even = voice.pick(EVEN_LINES);
    if (even) takes.push(even);
  }
  const verdictSection = [verdict, partial, ...takes]
    .filter((s): s is string => Boolean(s))
    .join(" ");

  /* -------------------------------------------------------------- season */
  const seasonParts: string[] = [];
  if (impact) {
    for (const [team, name] of [
      [impact.a, A],
      [impact.b, B],
    ] as const) {
      const line = isDynasty
        ? (dynastyLine(voice, team, name) ?? seasonLine(voice, team, name))
        : seasonLine(voice, team, name);
      if (line) seasonParts.push(line);
      const fit = fitLine(team, name, league, isDynasty);
      if (fit) seasonParts.push(fit);
    }
    const departed = [departedFact(impact.a, A, weeksLeft), departedFact(impact.b, B, weeksLeft)]
      .filter((d): d is { text: string; weeks: number } => d !== null)
      .sort((x, y) => y.weeks - x.weeks);
    if (departed.length > 0) seasonParts.push(departed[0].text);
  }
  const seasonSection = seasonParts.join(" ");

  /* -------------------------------------------------------------- caveat */
  const caveats: string[] = [];
  if (!impact) {
    caveats.push("The season impact could not be modelled: one of these assets has already moved on.");
  } else {
    if (impact.gaps.lineup) caveats.push("No weekly projections are out yet, so there are no lineup figures.");
    if (impact.gaps.simulation) {
      caveats.push(
        impact.gaps.simulationCause === "engine-switch"
          ? "This league's projections are being rebuilt on a new source, so the odds are not modelled yet."
          : impact.gaps.simulationCause === "not-built"
            ? "Projections for every team are not built yet, so the odds are not modelled yet."
            : "No regular-season games are left, so the odds are not modelled.",
      );
    }
    caveats.push(...impact.caveats);
  }
  const caveatSection = caveats.length > 0 ? `_${caveats.join(" ")}_` : "";

  /* --------------------------------------------------------------- close */
  const closer = voice.pick(TRADE_CLOSERS) ?? "";

  /* --------------------------------------------------------------- title */
  const weekLabel = input.week ? `Week ${input.week}` : `${league.season}`;
  const title = `Trade: ${A} and ${B} (${weekLabel})`.slice(0, 256);

  /* ---------------------------------------------------------------- poll */
  const answerA = fitPollAnswer(A);
  const answerB = fitPollAnswer(B);
  // NOTHING IS DROPPED TO MAKE A POLL FIT. If either team's name cannot be
  // named inside Discord's 55 characters even after whole words are removed,
  // the message goes out without a poll rather than with an answer that names
  // the wrong team. See lib/league-relay/limits.ts.
  const poll =
    answerA && answerB && answerA !== answerB
      ? { question: "Who won this trade?", answers: [answerA, answerB] }
      : null;

  return {
    header: league.header,
    type: "trade",
    title,
    sections: [
      // The lede is essential: it is the only place the assets are named, and
      // a trade writeup that dropped it would be an opinion about nothing.
      { key: "hook", text: hook, priority: 0 },
      { key: "verdict", text: verdictSection, priority: 1 },
      { key: "season", text: seasonSection, priority: 2 },
      { key: "closer", text: closer, priority: 3 },
      { key: "caveats", text: caveatSection, priority: 4 },
    ],
    fields: buildFields(view, impact, teamA, teamB, input.showNumbers),
    footer: impact
      ? `${impact.formatDisplay} values from ${impact.sourceDisplay}`
      : view.formatDisplay,
    url: input.url,
    poll,
  };
}
