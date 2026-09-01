/**
 * The trade writeup.
 *
 * A trade is the one thing that happens in a fantasy league where everybody has
 * an opinion and nobody has the numbers, so this is the longest and most
 * opinionated thing the relay writes. It is assembled from three sources, all
 * of which the site already computes for its own pages:
 *
 *   SIGNAL CHECK      who won on value, by how much, and how sure it is.
 *                     lib/league-signal-check.ts, the same pipeline behind
 *                     /tools/signal-check and the League Pulse feed.
 *   TRADE IMPACT      what it does to each team's remaining season: optimal
 *                     lineup points per week, projected wins, playoff odds,
 *                     title odds. lib/league-relay/trade-impact.ts.
 *   THE LEAGUE ITSELF where each team sits, and whether this is a dynasty
 *                     league where age and picks are currency or a one-year
 *                     league where only the next nine weeks exist.
 *
 * THE TWO MEASUREMENTS ROUTINELY DISAGREE AND THE DISAGREEMENT IS THE STORY. A
 * deal that adds value and costs wins is right for a rebuilder and wrong for a
 * contender. The writeup says both numbers and then says which one this
 * particular manager should have cared about, which is the part a bullet list
 * cannot do.
 *
 * REDRAFT AND DYNASTY GET DIFFERENT WRITEUPS, not the same one with a word
 * changed. In a one-year league a 2027 pick does not exist, a 31-year-old is
 * not a liability, and "value" means almost nothing next to whether the lineup
 * scores more on Sunday. The branch is on `impact.isDynasty`, which comes from
 * the league's own derived format rather than from a guess.
 *
 * Pure: takes plain data, returns a Writeup, touches no database and no clock.
 */

import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { LeagueTradeAssetMeta } from "@/lib/league-signal-check";
import type { SideKey } from "@/lib/signal-check/types";
import type { ExecutedTeamImpact, ExecutedTradeImpact } from "./trade-impact";
import type { RelayLeague, RelayTeam, Writeup, WriteupField } from "./types";
import { fitPollAnswer } from "./limits";
import { nameSides } from "./side-names";
import {
  EVEN_LINES,
  LOPSIDED_LINES,
  TRADE_OPENERS,
  Voice,
  bandFromRank,
  describeBand,
  listOf,
  ordinal,
  pct,
  ppChange,
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

/**
 * The assets one side received, one per line, with whatever detail we have.
 *
 * A player carries his position and NFL team; a pick carries its slot and
 * whether that slot is our estimate rather than a fact. Both come straight from
 * Signal Check's own asset view, so the bullets and the valuation can never
 * disagree about what was in the trade.
 */
function assetLines(view: BuilderView, side: SideKey): string {
  const s = view.sides.find((x) => x.side === side);
  const assets = s?.assets ?? [];
  if (assets.length === 0) return "- _nothing_";
  return assets
    .map((a) => (a.detail ? `- **${a.name}** (${a.detail})` : `- **${a.name}**`))
    .join("\n");
}

/**
 * "a two-for-one", "a straight swap". How the deal is described in one phrase.
 *
 * The hook needs to say what KIND of trade this is without listing it, because
 * the block underneath lists it. Counting is the honest way to do that: a
 * four-for-three is a genuinely different animal to a one-for-one and every
 * manager reading already knows it.
 */
function tradeShape(aCount: number, bCount: number): string {
  if (aCount === 1 && bCount === 1) return "a straight one-for-one";
  const word = (n: number): string =>
    ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"][n] ?? String(n);
  // Larger side first, which is how anybody says it out loud.
  const [big, small] = aCount >= bCount ? [aCount, bCount] : [bCount, aCount];
  return `a ${word(big)}-for-${word(small)}`;
}

/**
 * Drop the sentence in Signal Check's explanation that restates the margin.
 *
 * The explanation opens by saying who won and by how much, which is exactly
 * what the writeup's own verdict sentence has just said, so the paragraph read
 * "it is CillianH's deal, by 3.3%. CillianH wins by 3.3% of total trade value."
 * The rest of the explanation is the part worth keeping: which asset is the
 * best one, what shape the trade is, whether a consolidation credit applied.
 *
 * Matched on the FIGURE rather than on the wording, because the wording is an
 * admin-editable template and a phrase match would rot the first time somebody
 * edited it.
 */
function dropRepeatedMargin(explanation: string, marginPct: number): string {
  const figure = `${marginPct.toFixed(1)}%`;
  return explanation
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !sentence.includes(figure))
    .join(" ")
    .trim();
}

/** The winner's team name, or null on a neutral verdict. */
function winnerName(view: BuilderView, teamA: RelayTeam, teamB: RelayTeam): string | null {
  if (view.isNeutral || !view.winnerSide) return null;
  return view.winnerSide === "a" ? teamA.name : teamB.name;
}

/**
 * What the deal does to one team's rest of season, as prose.
 *
 * The three figures a manager actually asks about, in the order they ask them:
 * does my lineup score more, do I make the playoffs more often, do I win the
 * thing more often. A null figure is left out of the sentence rather than
 * printed as a zero. `gaps` says why it is missing, and a zero would be
 * believed.
 */
function seasonSentence(team: ExecutedTeamImpact, teamName: string): string | null {
  const clauses: string[] = [];

  if (team.lineupDelta !== null && Math.abs(team.lineupDelta) >= 0.1) {
    clauses.push(
      `${team.lineupDelta > 0 ? "adds" : "costs"} ${Math.abs(team.lineupDelta).toFixed(
        1,
      )} points a week to the optimal lineup`,
    );
  }

  const playoff = ppChange(team.playoffOddsBefore, team.playoffOddsAfter);
  if (playoff && playoff.delta !== 0) {
    clauses.push(
      `swings their playoff odds from ${pct(team.playoffOddsBefore)} to ${pct(
        team.playoffOddsAfter,
      )}`,
    );
  }

  const title = ppChange(team.titleOddsBefore, team.titleOddsAfter);
  if (title && Math.abs(title.delta) >= 1) {
    clauses.push(`moves their title odds to ${pct(team.titleOddsAfter, 1)}`);
  }

  const wins = (() => {
    const before = team.projectedWinsBefore;
    const after = team.projectedWinsAfter;
    if (before === null || after === null) return null;
    if (Math.abs(after - before) < 0.05) {
      return `Their projected win total does not move off ${after.toFixed(1)}.`;
    }
    return `Their projected wins go from ${before.toFixed(1)} to ${after.toFixed(1)}.`;
  })();

  if (clauses.length === 0) return wins;
  // listOf supplies the final "and", so no clause above may bring its own. An
  // earlier version had the title clause start with "and" and produced
  // "... and and their title odds ...", which shipped in the first real run.
  const sentence = `For ${teamName} it ${listOf(clauses)}.`;
  return wins ? `${sentence} ${wins}` : sentence;
}

/**
 * Both teams' rest of season, woven into one paragraph.
 *
 * The two sides used to be two blocks under a bold heading, which read as a
 * form rather than as a piece of writing. Joined by a connective that names the
 * relationship between them, the paragraph does the job the heading was
 * standing in for: it says these are the same number pointing in opposite
 * directions, which is the whole reason both are printed.
 */
function seasonParagraph(
  voice: Voice,
  impact: ExecutedTradeImpact,
  nameA: string,
  nameB: string,
): string {
  const a = seasonSentence(impact.a, nameA);
  const b = seasonSentence(impact.b, nameB);
  if (!a && !b) return "";
  if (!a || !b) return (a ?? b) as string;

  const sameDirection = (impact.a.lineupDelta ?? 0) > 0 === ((impact.b.lineupDelta ?? 0) > 0);
  const connective = sameDirection
    ? voice.pickPlain([
        "The other side of it is much the same story.",
        "It reads similarly from the other bench.",
      ])
    : voice.pickPlain([
        "The other side of it goes the other way.",
        "From the other bench it looks like the opposite trade, because it is.",
      ]);

  return `${a} ${connective} ${b}`;
}

/**
 * The dynasty-specific read: value, age, picks, and whether the direction suits
 * the band this team is actually in.
 */
function dynastyRead(
  voice: Voice,
  team: ExecutedTeamImpact,
  teamName: string,
  totalRosters: number,
): string | null {
  const bits: string[] = [];

  if (Math.abs(team.valueDelta) >= 1) {
    const direction = team.valueDelta > 0 ? "gain" : "give up";
    bits.push(`${teamName} ${direction} ${Math.abs(Math.round(team.valueDelta))} points of trade value`);
  }
  if (team.ageDelta !== null && Math.abs(team.ageDelta) >= 0.2) {
    const younger = team.ageDelta < 0;
    bits.push(
      // No leading "and": listOf supplies the conjunction, and a clause that
      // brings its own produces "value and and get 5.1 years younger".
      `get ${Math.abs(team.ageDelta).toFixed(1)} years ${younger ? "younger" : "older"} where it counts`,
    );
  }
  if (team.pickCountDelta !== 0) {
    const n = Math.abs(team.pickCountDelta);
    bits.push(
      `${team.pickCountDelta > 0 ? "banking" : "spending"} ${n} draft pick${n === 1 ? "" : "s"}`,
    );
  }
  if (bits.length === 0) return null;

  const band = bandFromRank(team.pulseRank, totalRosters);
  const sentence = `${listOf(bits)}.`;

  // The fit read. A contender shipping value for wins is doing its job; a
  // bottom-four team doing the same is the joke, and vice versa.
  const buyingNow = (team.lineupDelta ?? 0) > 0.5 && team.valueDelta < 0;
  const sellingOff = (team.lineupDelta ?? 0) < -0.5 && team.valueDelta > 0;

  if (buyingNow && (band === "elite" || band === "good")) {
    return `${sentence} That is a contender paying the going rate, which is exactly what ${ordinal(
      team.pulseRank ?? 0,
    )} in the league buys you the right to do.`;
  }
  if (buyingNow && (band === "poor" || band === "dire")) {
    const jab = describeBand(voice, band);
    return `${sentence} Buying win-now help while ${ordinal(
      team.pulseRank ?? 0,
    )} of ${totalRosters} is a choice. This is ${jab}, and the calendar is not going to fix that.`;
  }
  if (sellingOff && (band === "poor" || band === "dire")) {
    return `${sentence} A team ${ordinal(
      team.pulseRank ?? 0,
    )} of ${totalRosters} selling the present for the future is the one textbook move available to it, so credit where it is due.`;
  }
  if (sellingOff && (band === "elite" || band === "good")) {
    return `${sentence} Selling from ${ordinal(
      team.pulseRank ?? 0,
    )} is either a long game or an act of self-sabotage, and we will know by December.`;
  }
  return sentence;
}

/** The redraft read. Picks do not exist, age does not matter, Sunday does. */
function redraftRead(
  voice: Voice,
  team: ExecutedTeamImpact,
  teamName: string,
  totalRosters: number,
  weeksLeft: number,
): string | null {
  if (team.lineupDelta === null) return null;
  const band = bandFromRank(team.pulseRank, totalRosters);
  const delta = team.lineupDelta;

  if (Math.abs(delta) < 0.3) {
    return `${teamName} move their weekly ceiling by ${signed(delta)} points, which over ${weeksLeft} week${
      weeksLeft === 1 ? "" : "s"
    } is close enough to nothing that both managers can claim they won.`;
  }

  const gained = delta > 0;
  const total = Math.abs(delta * weeksLeft);
  // The per-week figure is already in the season paragraph above, so this
  // sentence leads with the cumulative one, which is the part that is new.
  //
  // The lead-in is drawn rather than fixed because BOTH teams get one of these
  // sentences, back to back, and two paragraphs opening "Over the 14 weeks
  // left" read as a template rather than as writing. The voice does not repeat
  // itself within a message, so the second team always gets the other form.
  const weekLabel = `${weeksLeft} week${weeksLeft === 1 ? "" : "s"}`;
  const base = voice.pickPlain([
    `Over the ${weekLabel} left that is about ${total.toFixed(0)} points ${
      gained ? "gained" : "given up"
    } by ${teamName}`,
    `That is roughly ${total.toFixed(0)} points ${
      gained ? "to the good" : "out of the door"
    } for ${teamName} across the ${weekLabel} that remain`,
  ]);

  if (gained && (band === "poor" || band === "dire")) {
    const jab = describeBand(voice, band);
    return `${base}. They are ${ordinal(
      team.pulseRank ?? 0,
    )} of ${totalRosters} and ${jab}, so this is rearranging furniture, but it is better furniture.`;
  }
  if (gained) {
    return `${base}, which for a team already ${ordinal(
      team.pulseRank ?? 0,
    )} in the league is the kind of margin that decides a bye.`;
  }
  if (!gained && (band === "elite" || band === "good")) {
    return `${base}. Giving that up from ${ordinal(
      team.pulseRank ?? 0,
    )} in a league with no next year is a bold read on how much cushion they have.`;
  }
  return `${base}, and they did not have points to spare.`;
}

/**
 * The "the player you sold would still have started" fact.
 *
 * Returns the sentence AND how many weeks it rests on, so the caller can pick
 * the more striking of the two teams' facts rather than one at random. A player
 * who would have started every remaining week is the line people quote; a
 * random pick threw that away half the time.
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
      }. Every single one.`,
    };
  }
  if (best.weeks / weeksLeft >= 0.5) {
    return {
      weeks: best.weeks,
      text: `${best.name} would have been in ${teamName}'s starting lineup ${best.weeks} of the remaining ${weeksLeft} weeks.`,
    };
  }
  return {
    weeks: best.weeks,
    text: `${best.name} would only have cracked ${teamName}'s lineup ${best.weeks} time${
      best.weeks === 1 ? "" : "s"
    } in ${weeksLeft} weeks, which is the strongest argument for this deal anybody has made.`,
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
    view.isNeutral ? "Too close to call" : `${winnerLabel} by ${view.marginPct.toFixed(1)}%`,
    // Already a full phrase ("High confidence"); appending the noun again
    // produced "High confidence confidence" in the first real run.
    view.confidenceLabel,
    view.tradeShapeLabel,
  ].filter((b): b is string => Boolean(b));
  fields.push({
    name: "Signal Check",
    value: verdictBits.join(" · ").replace(/ · /g, " | "),
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

  /* ---------------------------------------------------------------- hook */
  // THE HOOK NAMES THE EVENT, THE BLOCK NAMES THE ASSETS, and neither does the
  // other's job. An earlier version listed every player in the opening sentence
  // AND again in the block underneath, so a reader got the whole trade twice.
  // Saying "a four-for-three" instead is shorter, reads like a person wrote it,
  // and leaves the per-asset detail to the place built for it.
  const opener = voice.pick(TRADE_OPENERS) ?? "A trade has landed.";
  const verdictOpener = view.isNeutral
    ? voice.pick(EVEN_LINES)
    : view.isBlowout
      ? voice.pick(LOPSIDED_LINES)
      : null;
  const hook = [
    opener,
    `**${teamA.name}** and **${teamB.name}** have agreed ${tradeShape(
      aGets.length,
      bGets.length,
    )}.`,
    verdictOpener,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" ");

  /* ---------------------------------------------------------------- deal */
  // Positions and pick slots per asset, under a heading naming the manager who
  // received them. The one place in the message where scanning beats reading:
  // "who got what" is a lookup, not a narrative.
  const deal = [
    `**${teamA.name} acquires**`,
    assetLines(view, "a"),
    "",
    `**${teamB.name} acquires**`,
    assetLines(view, "b"),
  ].join("\n");

  /* -------------------------------------------------------- signal check */
  // The confidence rides inside the verdict sentence rather than standing on
  // its own. "Medium confidence." as a sentence is a fragment, and three short
  // fragments in a row is the bullet list this rewrite exists to escape.
  const confidence = view.confidenceLabel
    ? `, at ${view.confidenceLabel.toLowerCase()}`
    : "";
  const verdictSentence = winner
    ? `On ${view.formatDisplay} values it is **${winner}'s** deal, by ${view.marginPct.toFixed(
        1,
      )}%${confidence}.`
    : `On ${view.formatDisplay} values it is **too close to call**, the two sides ${view.marginPct.toFixed(
        1,
      )}% apart${confidence}.`;
  const signalCheck = [
    verdictSentence,
    // Signal Check's templates say "Side A". Everybody in this channel knows
    // these two people by name, and the writeup has already used those names in
    // its first sentence, so the verdict uses them too.
    dropRepeatedMargin(nameSides(view.explanation, teamA.name, teamB.name), view.marginPct),
  ]
    .filter((s): s is string => Boolean(s))
    .join(" ");

  /* -------------------------------------------------------- season swing */
  const seasonSection = impact ? seasonParagraph(voice, impact, teamA.name, teamB.name) : "";

  /* --------------------------------------------------------------- reads */
  const readParts: string[] = [];
  if (impact) {
    for (const [team, name] of [
      [impact.a, teamA.name],
      [impact.b, teamB.name],
    ] as const) {
      const read = isDynasty
        ? dynastyRead(voice, team, name, league.totalRosters)
        : redraftRead(voice, team, name, league.totalRosters, weeksLeft);
      if (read) readParts.push(read);
    }
    // The more striking of the two, not a random one. A player who would have
    // started every remaining week is the sentence people quote; picking at
    // random threw that away half the time.
    const departed = [
      departedFact(impact.a, teamA.name, weeksLeft),
      departedFact(impact.b, teamB.name, weeksLeft),
    ]
      .filter((d): d is { text: string; weeks: number } => d !== null)
      .sort((x, y) => y.weeks - x.weeks);
    if (departed.length > 0) readParts.push(departed[0].text);
  }
  // No heading. The paragraph opens with the team's own name and the register
  // changes on its own, so a bold label above it was doing nothing except
  // making the message look like a form.
  const readSection = readParts.join(" ");

  /* ------------------------------------------------------------ standing */
  const standing = (() => {
    if (!impact) return "";
    const clauses: string[] = [];
    for (const [team, t] of [
      [impact.a, teamA],
      [impact.b, teamB],
    ] as const) {
      if (team.pulseRank === null) continue;
      const phrase = describeBand(voice, bandFromRank(team.pulseRank, league.totalRosters));
      // A 0-0 record is not a record, it is a season that has not started, and
      // "sit 5th of 12 at 0-0" reads as though five teams had already beaten
      // them. Before a game is played the rank is a projection and says so.
      const played = t.record.wins + t.record.losses + t.record.ties > 0;
      const where = played
        ? `sit ${ordinal(team.pulseRank)} of ${league.totalRosters} at ${t.record.wins}-${
            t.record.losses
          }${t.record.ties > 0 ? `-${t.record.ties}` : ""}`
        : `are projected ${ordinal(team.pulseRank)} of ${
            league.totalRosters
          } before a game has been played`;
      clauses.push(`${t.name} ${where}, which is to say ${phrase}`);
    }
    if (clauses.length === 0) return "";
    // Two clauses joined into one sentence rather than stacked as two lines,
    // because the comparison between the two teams is the point of printing
    // either of them.
    return `For context: ${clauses.join("; ")}.`;
  })();

  /* -------------------------------------------------------------- caveat */
  const caveats: string[] = [];
  if (!impact) {
    caveats.push(
      "The season impact could not be modelled for this one: at least one of these assets has already moved on, so only the value read above applies.",
    );
  } else {
    if (impact.gaps.lineup) {
      caveats.push("No weekly projections are published yet, so there are no lineup figures.");
    }
    if (impact.gaps.simulation) {
      caveats.push("No regular-season games are left, so the odds are not modelled.");
    }
    caveats.push(...impact.caveats);
  }
  const caveatSection = caveats.length > 0 ? `_${caveats.join(" ")}_` : "";

  /* --------------------------------------------------------------- title */
  const weekLabel = input.week ? `Week ${input.week}` : `${league.season}`;
  const title = `Trade: ${teamA.name} and ${teamB.name} (${weekLabel})`.slice(0, 256);

  /* ---------------------------------------------------------------- poll */
  const answerA = fitPollAnswer(teamA.name);
  const answerB = fitPollAnswer(teamB.name);
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
      { key: "hook", text: hook, priority: 0 },
      // The deal block is essential. A trade writeup that dropped it to save
      // room would be an opinion about assets it never named.
      { key: "deal", text: deal, priority: 0 },
      { key: "signal-check", text: signalCheck, priority: 1 },
      { key: "season", text: seasonSection, priority: 2 },
      { key: "read", text: readSection, priority: 2 },
      { key: "standing", text: standing, priority: 3 },
      { key: "caveats", text: caveatSection, priority: 4 },
    ],
    fields: buildFields(view, impact, teamA, teamB, input.showNumbers),
    // The league name is in the header; the footer carries the one thing the
    // header does not, which is where the prices came from.
    footer: impact
      ? `${impact.formatDisplay} values from ${impact.sourceDisplay}`
      : view.formatDisplay,
    url: input.url,
    poll,
  };
}
