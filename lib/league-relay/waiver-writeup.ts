/**
 * The waiver and free agent writeups: the single review, and the run digest.
 *
 * WHY THIS IS NOT A SMALL TRADE WRITEUP. A trade is two rosters changing at
 * once and is worth a Monte Carlo season on both sides. A waiver claim is one
 * player arriving, and there are twenty of them on a Wednesday morning. Running
 * the season simulation per claim would put a minute of compute behind the
 * fifteen-minute cron for a message whose whole content is "he is a backup, and
 * they paid 41% of their budget for him".
 *
 * So this is built from figures that are already stored: what the player is
 * projected to score under THIS league's own scoring, what the market thinks of
 * him and which way that has moved this month, what was paid, and who paid it.
 * Every one of those is a single indexed read, and together they say more about
 * a waiver claim than a simulation would.
 *
 * TWO SHAPES, AND THE RUN SIZE PICKS ONE. A quiet run gets a real review per
 * claim. A busy one gets a single digest that lists every move, because eleven
 * separate embeds is a wall and the one claim worth reading about is buried in
 * the middle of it. Nothing is dropped from the digest list: the whole point of
 * it is that a reader sees all eleven without scrolling past all eleven.
 *
 * FAAB IS THE JOKE AND FAAB IS ALSO THE INFORMATION. A bid is the only moment
 * in a fantasy season where a manager states a number out loud, and it is
 * therefore the only number that can be held against them. Both shapes state
 * the bid as a share of what they had, which is the version that stings.
 *
 * Pure: takes plain data, returns a Writeup.
 */

import type { RelayLeague, RelayTeam, Writeup, WriteupField } from "./types";
import { Voice, bandFromRank, describeBand, listOf, ordinal, type Line } from "./voice";

/** One player in a waiver move, with everything cheap we know about him. */
export interface WaiverPlayer {
  name: string;
  position: string;
  nflTeam: string | null;
  /** Sleeper's designation, verbatim. Null when healthy. */
  injuryStatus: string | null;
  /** Projected points per week under the league's own scoring. Null = unpublished. */
  projectedPoints: number | null;
  /** Market value in the league's format. Null when the source does not cover him. */
  value: number | null;
  /** 30-day move in that value, as a percentage. Null without enough history. */
  change30dPct: number | null;
  /** Positional rank by value among rostered players, when known. */
  positionRank: number | null;
}

/** One move, in the shape both the review and the digest read from. */
export interface WaiverMove {
  team: RelayTeam;
  /** Power Pulse rank for the moving team. Null when the league has no cache. */
  pulseRank: number | null;
  kind: "waiver" | "free_agent";
  added: WaiverPlayer[];
  dropped: WaiverPlayer[];
  /** FAAB spent, in the league's own budget units. Null on a free agent pickup. */
  faabSpent: number | null;
  week: number | null;
  /** Seeds this move's own voice, so a review reads the same on every render. */
  seedKey: string;
}

export interface WaiverWriteupInput extends WaiverMove {
  league: RelayLeague;
  /** The league's full FAAB budget, for the share arithmetic. Null when not a FAAB league. */
  faabBudget: number | null;
  /** What the median winning bid in this league has been this season. Null with no history. */
  faabMedian: number | null;
  /** The weakest starting position on this roster by projected output. Null without projections. */
  weakestPosition: string | null;
  snark: number;
  showNumbers: boolean;
  url: string | null;
}

const ADD_OPENERS: Line[] = [
  { heat: 0, text: "A move on the wire." },
  { heat: 0.3, text: "Somebody was up early." },
  { heat: 0.5, text: "The waiver wire has claimed another victim, possibly the person who used it." },
  { heat: 0.6, text: "A decision was made. We are here to examine it." },
];

const CUT_OPENERS: Line[] = [
  { heat: 0, text: "A roster spot has been freed up." },
  { heat: 0.4, text: "Somebody has decided they have seen enough." },
  { heat: 0.7, text: "A player has been released into the wild, unloved and unclaimed." },
];

/** Lines about a bid that is large relative to the budget. */
const OVERPAY_LINES: Line[] = [
  { heat: 0.3, text: "That is a lot of budget for a bench spot." },
  { heat: 0.6, text: "That is the kind of bid you make and then do not mention in the group chat." },
  { heat: 0.8, text: "Somewhere, an accountant felt a disturbance." },
];

/** Lines about a bid of nothing that won anyway. */
const FREEBIE_LINES: Line[] = [
  { heat: 0.2, text: "Free, which is exactly the right price if this does not work out." },
  { heat: 0.5, text: "Nobody else wanted him, which is either an edge or a warning." },
];

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function playerLabel(p: WaiverPlayer): string {
  const bits = [p.position, p.nflTeam].filter((b): b is string => Boolean(b));
  const tail = bits.length > 0 ? ` (${bits.join(", ")})` : "";
  const injury = p.injuryStatus ? ` [${p.injuryStatus}]` : "";
  return `${p.name}${tail}${injury}`;
}

/**
 * How large a share of the budget is worth saying out loud.
 *
 * Below this the share is not information, it is arithmetic. A twelve-line
 * digest where half the lines carry "1% of a season's budget" and half do not
 * looks broken, and neither half tells a reader anything they could act on.
 */
const NOTABLE_BUDGET_SHARE_PCT = 5;

/** The bid, as a phrase that can sit inside a longer sentence. */
function bidPhrase(faabSpent: number | null, faabBudget: number | null): string | null {
  if (faabSpent === null) return null;
  if (faabSpent === 0) return "for nothing";
  // A share that rounds to nothing is noise dressed as information: "for 2
  // FAAB, 0% of a season's budget" says the same thing twice, the second time
  // wrongly. Only quoted once it is worth quoting.
  const pctOfBudget = faabBudget && faabBudget > 0 ? (faabSpent / faabBudget) * 100 : null;
  const share =
    pctOfBudget !== null && pctOfBudget >= NOTABLE_BUDGET_SHARE_PCT
      ? `, ${pctOfBudget.toFixed(0)}% of a season's budget`
      : "";
  return `for ${faabSpent} FAAB${share}`;
}

/** The best player in a list, by market value. Null when nobody is priced. */
function bestByValue(players: WaiverPlayer[]): WaiverPlayer | null {
  return players.reduce<WaiverPlayer | null>(
    (best, p) => (p.value !== null && (!best || (best.value ?? -1) < p.value) ? p : best),
    null,
  );
}

/* -------------------------------------------------------------------------- */
/* The single review                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What the arriving player is actually worth, as one flowing sentence.
 *
 * The projection and the market read used to be two sentences on two lines,
 * which made a two-fact paragraph look like a bullet list with the bullets
 * taken off. They belong in one breath: the projection is what he does on
 * Sunday, the market is what everybody else thinks of him, and the interesting
 * claims are the ones where those two disagree.
 */
function playerVerdict(voice: Voice, p: WaiverPlayer): string {
  const market = (() => {
    if (p.value === null) return null;
    const rank = p.positionRank ? `, the ${ordinal(p.positionRank)} ${p.position} by value` : "";
    if (p.change30dPct === null || Math.abs(p.change30dPct) < 3) {
      return `the market has him at ${Math.round(
        p.value,
      )}${rank} and has not changed its mind in a month`;
    }
    return `the market has him at ${Math.round(p.value)}${rank}, ${
      p.change30dPct > 0 ? "up" : "down"
    } ${Math.abs(p.change30dPct).toFixed(0)}% over thirty days`;
  })();

  if (p.projectedPoints === null) {
    const base = `Nobody publishes a weekly projection for ${p.name}, which is itself a review`;
    return market ? `${base}, though ${market}.` : `${base}.`;
  }

  const pts = p.projectedPoints;
  const proj = `${p.name} projects at ${pts.toFixed(1)} points a week under this league's scoring`;
  const tail = market ? `, and ${market}` : "";

  if (pts < 4) {
    const jab =
      voice.pick([
        { heat: 0.4, text: "That is a roster spot with a name attached." },
        { heat: 0.7, text: "You could start a traffic cone and lose by less." },
        { heat: 0.9, text: "This is not a fantasy football decision, it is a cry for help." },
      ]) ?? "";
    return `${proj}${tail}.${jab ? ` ${jab}` : ""}`;
  }
  if (pts < 9) return `${proj}, which is bye-week cover and not much more${tail}.`;
  if (pts < 14) {
    return `${proj}, which is a real flex play rather than a lottery ticket${tail}.`;
  }
  return `${proj}${tail}. Whoever let him reach the wire should be asked about it publicly.`;
}

/** The drop, folded into prose rather than stacked on its own line. */
function dropClause(voice: Voice, input: WaiverWriteupInput): string | null {
  if (input.dropped.length === 0) return null;
  const names = listOf(input.dropped.map(playerLabel));
  const worstOut = bestByValue(input.dropped);
  const bestIn = bestByValue(input.added);

  if (worstOut?.value != null && bestIn?.value != null && worstOut.value > bestIn.value) {
    const jab =
      voice.pick([
        { heat: 0.4, text: "That is a downgrade on paper." },
        {
          heat: 0.7,
          text: "Cutting the better player to make room for the worse one is a bold genre of move.",
        },
        {
          heat: 0.9,
          text: "This is the fantasy equivalent of selling the car to buy a bus ticket.",
        },
      ]) ?? "";
    return `Out went ${names}, and that is the awkward part: ${worstOut.name} is priced at ${Math.round(
      worstOut.value,
    )} against ${bestIn.name}'s ${Math.round(bestIn.value)}.${jab ? ` ${jab}` : ""}`;
  }
  return `Out went ${names}.`;
}

/** Where this leaves them, and whether it addressed the actual problem. */
function standingClause(voice: Voice, input: WaiverWriteupInput): string | null {
  if (input.pulseRank === null) return null;
  const phrase = describeBand(voice, bandFromRank(input.pulseRank, input.league.totalRosters));
  const standing = `${input.team.name} sit ${ordinal(input.pulseRank)} of ${
    input.league.totalRosters
  }, which is to say ${phrase}`;

  if (!input.weakestPosition) return `${standing}.`;
  const addedPositions = new Set(input.added.map((p) => p.position.toUpperCase()));
  if (addedPositions.has(input.weakestPosition.toUpperCase())) {
    return `${standing}, and their thinnest starting spot was ${input.weakestPosition}, so at least this was aimed at the right hole.`;
  }
  return `${standing}, and their thinnest starting spot is still ${input.weakestPosition}, which this does nothing about.`;
}

function buildFields(input: WaiverWriteupInput): WriteupField[] {
  if (!input.showNumbers) return [];
  const fields: WriteupField[] = [];

  const addedRows = input.added
    .map((p) => {
      const bits = [playerLabel(p)];
      if (p.projectedPoints !== null) bits.push(`${p.projectedPoints.toFixed(1)} proj/wk`);
      if (p.value !== null) bits.push(`${Math.round(p.value)} value`);
      return bits.join(" | ");
    })
    .join("\n");
  if (addedRows) fields.push({ name: "In", value: addedRows, inline: true, priority: 0 });

  const droppedRows = input.dropped
    .map((p) => {
      const bits = [playerLabel(p)];
      if (p.value !== null) bits.push(`${Math.round(p.value)} value`);
      return bits.join(" | ");
    })
    .join("\n");
  if (droppedRows) fields.push({ name: "Out", value: droppedRows, inline: true, priority: 1 });

  if (input.faabSpent !== null) {
    // Same gate as the prose: a share that rounds to nothing is not worth the
    // parentheses, and "1 (0% of budget)" reads as a bug.
    const pctOfBudget =
      input.faabBudget && input.faabBudget > 0
        ? (input.faabSpent / input.faabBudget) * 100
        : null;
    const share =
      pctOfBudget !== null && pctOfBudget >= NOTABLE_BUDGET_SHARE_PCT
        ? ` (${pctOfBudget.toFixed(0)}% of budget)`
        : "";
    fields.push({ name: "FAAB", value: `${input.faabSpent}${share}`, inline: true, priority: 2 });
  }

  return fields;
}

/** Build the single-move review. Null when nothing actually moved. */
export function buildWaiverWriteup(input: WaiverWriteupInput): Writeup | null {
  if (input.added.length === 0 && input.dropped.length === 0) return null;
  const voice = new Voice(input.seedKey, input.snark);
  const isCut = input.added.length === 0;

  /* ------------------------------------------------------------- the move */
  const opener = voice.pick(isCut ? CUT_OPENERS : ADD_OPENERS) ?? "A move on the wire.";
  const bid = bidPhrase(input.faabSpent, input.faabBudget);

  const headline = isCut
    ? `${opener} **${input.team.name}** have released ${listOf(input.dropped.map(playerLabel))}.`
    : `${opener} **${input.team.name}** have ${
        input.kind === "waiver" ? "won" : "picked up"
      } ${listOf(input.added.map(playerLabel))}${bid ? ` ${bid}` : ""}.`;

  /* -------------------------------------------------------- what they got */
  const verdicts = input.added.map((p) => playerVerdict(voice, p)).join(" ");

  /* ------------------------------------------------------------- the cost */
  const cost = (() => {
    if (input.faabSpent === null) {
      return isCut
        ? null
        : "No bid, no waiver, no cost: straight off the wire before anybody else looked.";
    }
    if (input.faabSpent === 0) {
      const jab = voice.pick(FREEBIE_LINES);
      return `Won for nothing.${jab ? ` ${jab}` : ""}`;
    }

    const sentences: string[] = [];
    if (input.faabMedian !== null && input.faabMedian > 0) {
      const ratio = input.faabSpent / input.faabMedian;
      if (ratio >= 3) {
        sentences.push(
          `The median winning bid in this league is ${input.faabMedian}, so that is more than three times the going rate.`,
        );
      } else if (ratio <= 0.34) {
        sentences.push(
          `The median winning bid here is ${input.faabMedian}, so this was a bargain hunt.`,
        );
      }
    }
    const heavy = input.faabBudget
      ? input.faabSpent / input.faabBudget >= 0.25
      : input.faabSpent >= 25;
    if (heavy) {
      const jab = voice.pick(OVERPAY_LINES);
      if (jab) sentences.push(jab);
    }
    return sentences.length > 0 ? sentences.join(" ") : null;
  })();

  /* -------------------------------------------------- the drop, the stakes */
  const closing = [dropClause(voice, input), standingClause(voice, input)]
    .filter((s): s is string => Boolean(s))
    .join(" ");

  const weekLabel = input.week ? `Week ${input.week}` : `${input.league.season}`;
  // Player first, then the team. A verb here would have to agree with a name
  // that might be a handle ("StanPurdy13"), a plural ("The Mongooses") or a
  // whole sentence, and no single conjugation is right for all three.
  const kindLabel = isCut ? "Cut" : input.kind === "waiver" ? "Waiver" : "Free agent";
  const title = (
    isCut
      ? `${kindLabel}: ${input.team.name} release ${input.dropped[0]?.name ?? "a player"} (${weekLabel})`
      : `${kindLabel}: ${input.added[0].name} to ${input.team.name} (${weekLabel})`
  ).slice(0, 256);

  return {
    header: input.league.header,
    type: "waiver",
    title,
    sections: [
      { key: "headline", text: headline, priority: 0 },
      { key: "verdict", text: verdicts, priority: 1 },
      { key: "cost", text: cost ?? "", priority: 2 },
      { key: "closing", text: closing, priority: 2 },
    ],
    fields: buildFields(input),
    // The league name lives in the header. Repeating it here said it twice on
    // a message with only four sentences in it.
    footer: null,
    // No poll. There is nothing to vote on: one manager acted alone, and asking
    // a channel to rate a bench add invites exactly one kind of reply.
    poll: null,
    url: input.url,
  };
}

/* -------------------------------------------------------------------------- */
/* The run digest                                                             */
/* -------------------------------------------------------------------------- */

export interface WaiverDigestInput {
  league: RelayLeague;
  /** Every move in the run, oldest first. NONE of them are dropped from the list. */
  moves: WaiverMove[];
  kind: "waiver" | "free_agent";
  week: number | null;
  faabBudget: number | null;
  faabMedian: number | null;
  snark: number;
  showNumbers: boolean;
  url: string | null;
  seedKey: string;
}

const BUSY_OPENERS: Line[] = [
  { heat: 0, text: "Busy morning on the wire." },
  { heat: 0.3, text: "Everybody woke up at once." },
  { heat: 0.5, text: "The wire has been picked clean, and then picked over again." },
  { heat: 0.7, text: "Somewhere between ambition and panic, this league went shopping." },
];

const BUSY_FA_OPENERS: Line[] = [
  { heat: 0, text: "A flurry of moves on the free agent list." },
  { heat: 0.4, text: "Several managers had the same idea within about ten minutes of each other." },
  { heat: 0.7, text: "The free agent pool is now noticeably shallower, and no better." },
];

/**
 * One line per move. The list a reader actually scans.
 *
 * A move with nobody coming in reads as a plain drop rather than as an arrival
 * with an empty subject: "cut loose, dropping Sam Hartman" was the sentence
 * before, and it named the same event twice while saying neither half properly.
 */
function digestLine(
  move: WaiverMove,
  faabBudget: number | null,
  /** False when the intro has already said every move came from one manager. */
  nameTeam: boolean,
): string {
  const who = nameTeam ? `**${move.team.name}** ` : "";
  if (move.added.length === 0) {
    return `- ${who}${nameTeam ? "drop" : "Dropped"} ${listOf(move.dropped.map(playerLabel))}.`;
  }
  const bid = bidPhrase(move.faabSpent, faabBudget);
  const inPart = `${who}${nameTeam ? "get" : "Got"} ${listOf(move.added.map(playerLabel))}${
    bid ? ` ${bid}` : ""
  }`;
  const outPart =
    move.dropped.length > 0 ? `, dropping ${listOf(move.dropped.map((p) => p.name))}` : "";
  return `- ${inPart}${outPart}.`;
}

/**
 * Build the digest for a busy run.
 *
 * NOTHING IS EVER DROPPED FROM THE LIST. The digest exists because eleven
 * separate messages is a wall; a digest that then said "and three more" would
 * have all of the wall's uselessness and none of its completeness. If the list
 * genuinely cannot fit Discord's limits the renderer refuses the whole message
 * and the ledger records why, which is the honest failure.
 */
export function buildWaiverDigest(input: WaiverDigestInput): Writeup | null {
  if (input.moves.length === 0) return null;
  const voice = new Voice(input.seedKey, input.snark);
  const isWaiver = input.kind === "waiver";

  const count = input.moves.length;
  const teams = new Set(input.moves.map((m) => m.team.sleeperRosterId)).size;

  /* --------------------------------------------------------------- intro */
  const opener =
    voice.pick(isWaiver ? BUSY_OPENERS : BUSY_FA_OPENERS) ?? "Busy morning on the wire.";
  const week = input.week ? ` in week ${input.week}` : "";
  const noun = isWaiver ? "claims" : "moves";
  // One manager doing all of it is the funniest fact available and it was being
  // reported as "across 1 team", which reads like a rounding error.
  const spread =
    teams === 1
      ? `every one of them from ${input.moves[0].team.name}`
      : `across ${teams} teams`;
  const intro = `${opener} ${count} ${noun} went through${week}, ${spread}. Too many to write up one at a time, so here is the whole board.`;

  /* ---------------------------------------------------------------- list */
  const list = input.moves.map((m) => digestLine(m, input.faabBudget, teams > 1)).join("\n");

  /* ------------------------------------------------------- the standouts */
  const notes: string[] = [];

  const bids = input.moves
    .filter((m) => m.faabSpent !== null && m.faabSpent > 0)
    .sort((a, b) => (b.faabSpent ?? 0) - (a.faabSpent ?? 0));
  const topBid = bids[0];
  if (topBid && topBid.faabSpent !== null) {
    const share =
      input.faabBudget && input.faabBudget > 0
        ? `, ${((topBid.faabSpent / input.faabBudget) * 100).toFixed(0)}% of a season's budget`
        : "";
    const runnerUp = bids[1]?.faabSpent ?? 0;
    const gap = runnerUp > 0 ? topBid.faabSpent / runnerUp : Number.POSITIVE_INFINITY;
    const jab =
      gap >= 3
        ? voice.pick([
            { heat: 0.4, text: "Nobody else came close, which tells you something." },
            {
              heat: 0.7,
              text: "Nobody else got within a third of it, so either somebody knows something or somebody panicked.",
            },
          ])
        : null;
    notes.push(
      `The biggest bid of the run was ${topBid.faabSpent}${share}, from ${
        topBid.team.name
      } for ${topBid.added[0]?.name ?? "a player"}.${jab ? ` ${jab}` : ""}`,
    );
  }

  // The best player ADDED, by projection, because that is the move most likely
  // to change somebody's lineup on Sunday.
  const bestAdd = input.moves
    .flatMap((m) => m.added.map((p) => ({ move: m, player: p })))
    .filter((x) => x.player.projectedPoints !== null)
    .sort((a, b) => (b.player.projectedPoints ?? 0) - (a.player.projectedPoints ?? 0))[0];
  if (bestAdd && (bestAdd.player.projectedPoints ?? 0) >= 9) {
    notes.push(
      `The one that might actually matter is ${bestAdd.player.name} to ${
        bestAdd.move.team.name
      }, at ${(bestAdd.player.projectedPoints ?? 0).toFixed(1)} points a week.`,
    );
  }

  // The best player DROPPED. Where somebody cuts a real asset that is the story
  // of the morning, and it is the easiest thing to miss in a long list.
  const bestDrop = input.moves
    .flatMap((m) => m.dropped.map((p) => ({ move: m, player: p })))
    .filter((x) => x.player.value !== null)
    .sort((a, b) => (b.player.value ?? 0) - (a.player.value ?? 0))[0];
  const bestAddValue = input.moves
    .flatMap((m) => m.added)
    .reduce((max, p) => Math.max(max, p.value ?? 0), 0);
  if (bestDrop && (bestDrop.player.value ?? 0) > bestAddValue) {
    const jab = voice.pick([
      { heat: 0.4, text: "Somebody should probably have claimed him." },
      {
        heat: 0.7,
        text: "He is the most valuable thing that moved today, and he moved to nowhere.",
      },
    ]);
    notes.push(
      `The most valuable player involved was let go rather than won: ${
        bestDrop.player.name
      }, priced at ${Math.round(bestDrop.player.value ?? 0)}, cut by ${bestDrop.move.team.name}.${
        jab ? ` ${jab}` : ""
      }`,
    );
  }

  const standouts = notes.join(" ");

  /* -------------------------------------------------------------- fields */
  const fields: WriteupField[] = [];
  if (input.showNumbers && bids.length > 0) {
    const total = bids.reduce((sum, m) => sum + (m.faabSpent ?? 0), 0);
    const rows = [`Spent this run: ${total} across ${bids.length} winning bids`];
    if (input.faabMedian !== null) rows.push(`League median bid: ${input.faabMedian}`);
    fields.push({ name: "FAAB", value: rows.join("\n"), priority: 0 });
  }

  const weekLabel = input.week ? `Week ${input.week}` : `${input.league.season}`;
  const title = `${isWaiver ? "Waivers" : "Free agents"}: ${count} moves (${weekLabel})`.slice(
    0,
    256,
  );

  return {
    header: input.league.header,
    type: "waiver",
    title,
    sections: [
      { key: "intro", text: intro, priority: 0 },
      // The list is ESSENTIAL (priority 0). It is the message; a digest that
      // dropped it to fit would be an intro and a punchline about nothing.
      { key: "list", text: list, priority: 0 },
      { key: "standouts", text: standouts, priority: 2 },
    ],
    fields,
    footer: null,
    poll: null,
    url: input.url,
  };
}
