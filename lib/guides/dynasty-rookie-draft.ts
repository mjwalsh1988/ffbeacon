/**
 * The dynasty rookie draft guide: lesson list, FAQ, the published study figures
 * and the small pure rules its interactive boxes run.
 *
 * Kept outside the page module because a Next.js page may only export its own
 * reserved names, because the client boxes and the server figures both read
 * these, and because the test reads all of it. Nothing here imports a server
 * module, so a client component can import this file.
 *
 * PUBLISHED FIGURES. Two outside studies are quoted on the page, and both live
 * here so a figure and the sentence beside it cannot disagree:
 *   - ROOKIE_PICK_HIT_RATES: Dynasty Nerds (Mychal Warno, March 2025), rookie
 *     drafts 2018 to 2023. The dynasty strategy guide draws the same array.
 *   - DRAFT_CAPITAL: Footballguys, "Draft Capital Matters" (Jason Wood, July
 *     2026), NFL drafts 2016 to 2025, ROOKIE-SEASON finishes by NFL draft round.
 * Nothing is rounded into a different claim. The percentages are the studies'
 * own, including the buckets that run backwards on a small sample.
 */

export const ROOKIE_GUIDE_SLUG = "dynasty-rookie-draft";

export const ROOKIE_GUIDE_LESSONS: { id: string; title: string }[] = [
  { id: "how-heading", title: "How a rookie draft works" },
  { id: "when-heading", title: "When rookie drafts happen" },
  { id: "odds-heading", title: "The odds on every pick" },
  { id: "worth-heading", title: "What a pick is worth" },
  { id: "clock-heading", title: "The yearly price curve" },
  { id: "capital-heading", title: "Reading the NFL draft" },
  { id: "spot-heading", title: "Opportunity and upside" },
  { id: "board-heading", title: "How the class really goes" },
  { id: "trade-heading", title: "Offseason trades" },
  { id: "after-heading", title: "After the draft" },
];

/* ---------- Dynasty Nerds: rookie pick hit rates by slot ---------- */

/**
 * Dynasty Nerds, Mychal Warno, March 17, 2025, rookie drafts 2018 to 2023. A
 * "hit" is a Tier 1 season or multiple Tier 2 or better seasons; "hit or mid"
 * adds a Tier 2 season with a Tier 3, or multiple Tier 3 seasons.
 */
export type PickHitRate = { key: string; slot: string; hit: number; hitOrMid: number };

export const ROOKIE_PICK_HIT_RATES: PickHitRate[] = [
  { key: "101", slot: "1.01", hit: 83.33, hitOrMid: 100 },
  { key: "102", slot: "1.02 to 1.04", hit: 70.83, hitOrMid: 83.33 },
  { key: "105", slot: "1.05 to 1.08", hit: 37.5, hitOrMid: 41.67 },
  { key: "109", slot: "1.09 to 1.12", hit: 45.83, hitOrMid: 62.5 },
  { key: "201", slot: "2.01 to 2.06", hit: 22.22, hitOrMid: 30.56 },
  { key: "207", slot: "2.07 to 2.12", hit: 19.44, hitOrMid: 33.33 },
  { key: "300", slot: "Round 3", hit: 8.33, hitOrMid: 13.89 },
];

/** "About N of every 10" for a percentage: 83 is 8, 37.5 is 4, 8 is 1. */
export function outOfTen(pct: number): number {
  return Math.min(10, Math.max(0, Math.round(pct / 10)));
}

/* ---------- Footballguys: rookie-season finishes by NFL draft round ---------- */

export type CapitalPosition = "QB" | "RB" | "WR" | "TE";

export type CapitalRound = {
  round: number;
  /** Players drafted in that round, 2016 to 2025. */
  players: number;
  /** Percent who cleared the position's wider bar as rookies. */
  wide: number;
  /** Percent who finished in the top 12 at the position as rookies. */
  top12: number;
};

export type CapitalStudy = {
  position: CapitalPosition;
  /** The wider bar the study reports for the position, as a rank. */
  wideRank: number;
  players: number;
  rounds: CapitalRound[];
  href: string;
};

export const DRAFT_CAPITAL: Record<CapitalPosition, CapitalStudy> = {
  QB: {
    position: "QB",
    wideRank: 24,
    players: 118,
    href: "https://www.footballguys.com/article/2026-draft-capital-matters-quarterbacks",
    rounds: [
      { round: 1, players: 35, wide: 45.7, top12: 14.3 },
      { round: 2, players: 7, wide: 14.3, top12: 0 },
      { round: 3, players: 14, wide: 0, top12: 0 },
      { round: 4, players: 14, wide: 7.1, top12: 7.1 },
      { round: 5, players: 14, wide: 0, top12: 0 },
      { round: 6, players: 19, wide: 5.3, top12: 0 },
      { round: 7, players: 15, wide: 0, top12: 0 },
    ],
  },
  RB: {
    position: "RB",
    wideRank: 24,
    players: 224,
    href: "https://www.footballguys.com/article/2026-draft-capital-matters-rookie-running-backs",
    rounds: [
      { round: 1, players: 14, wide: 71.4, top12: 50 },
      { round: 2, players: 22, wide: 40.9, top12: 4.5 },
      { round: 3, players: 28, wide: 14.3, top12: 7.1 },
      { round: 4, players: 46, wide: 2.2, top12: 0 },
      { round: 5, players: 35, wide: 2.9, top12: 2.9 },
      { round: 6, players: 42, wide: 0, top12: 0 },
      { round: 7, players: 37, wide: 0, top12: 0 },
    ],
  },
  WR: {
    position: "WR",
    wideRank: 36,
    players: 323,
    href: "https://www.footballguys.com/article/2026-draft-capital-matters-rookie-wide-receivers",
    rounds: [
      { round: 1, players: 43, wide: 46.5, top12: 11.6 },
      { round: 2, players: 50, wide: 22, top12: 2 },
      { round: 3, players: 46, wide: 4.3, top12: 0 },
      { round: 4, players: 43, wide: 2.3, top12: 0 },
      { round: 5, players: 40, wide: 7.5, top12: 2.5 },
      { round: 6, players: 53, wide: 0, top12: 0 },
      { round: 7, players: 48, wide: 0, top12: 0 },
    ],
  },
  TE: {
    position: "TE",
    wideRank: 24,
    players: 141,
    href: "https://www.footballguys.com/article/2026-draft-capital-matters-rookie-tight-ends",
    rounds: [
      { round: 1, players: 11, wide: 81.8, top12: 54.5 },
      { round: 2, players: 19, wide: 21.1, top12: 5.3 },
      { round: 3, players: 24, wide: 8.3, top12: 4.2 },
      { round: 4, players: 30, wide: 6.7, top12: 0 },
      { round: 5, players: 23, wide: 8.7, top12: 0 },
      { round: 6, players: 16, wide: 0, top12: 0 },
      { round: 7, players: 18, wide: 0, top12: 0 },
    ],
  },
};

export const CAPITAL_POSITIONS: CapitalPosition[] = ["QB", "RB", "WR", "TE"];

/* ---------- Lesson 1: which picks are yours ---------- */

export type DraftOrder = "linear" | "snake";

export type OwnPick = {
  round: number;
  /** Position inside the round, 1-based. */
  pickInRound: number;
  /** Overall pick number, 1-based. */
  overall: number;
  /** "2.08": the round, a dot, the two-digit pick inside it. */
  label: string;
};

/**
 * The picks a team holds before any trade. In a linear draft every round runs
 * in the same order, so the team picks in the same place each time. In a snake
 * draft the even rounds run backwards.
 */
export function ownPicks(teams: number, slot: number, rounds: number, order: DraftOrder): OwnPick[] {
  const t = Math.max(2, Math.floor(teams));
  const s = Math.min(Math.max(1, Math.floor(slot)), t);
  const out: OwnPick[] = [];
  for (let round = 1; round <= Math.max(1, Math.floor(rounds)); round++) {
    const pickInRound = order === "snake" && round % 2 === 0 ? t - s + 1 : s;
    out.push({
      round,
      pickInRound,
      overall: (round - 1) * t + pickInRound,
      label: `${round}.${String(pickInRound).padStart(2, "0")}`,
    });
  }
  return out;
}

/* ---------- Lesson 7: sorting a rookie by security and opportunity ---------- */

export type CapitalDay = "day1" | "day2" | "day3";
export type DepthPath = "open" | "shared" | "blocked";

export type RookieSort = { title: string; move: string; body: string };

const SORT: Record<CapitalDay, Record<DepthPath, RookieSort>> = {
  day1: {
    open: {
      title: "Day-one starter",
      move: "Pay for him",
      body: "A first-round NFL pick with a clear role is the safest rookie there is, and the room knows it. He costs a top rookie pick. If you hold one, this is what it is for.",
    },
    shared: {
      title: "Starter on a short wait",
      move: "Draft him at his price",
      body: "The team spent a first-round pick, so the snaps are coming even if he splits them in September. A slow first month is when another manager loses patience. That is the time to ask about him.",
    },
    blocked: {
      title: "Stash with security",
      move: "Buy the slow start",
      body: "A first-round pick behind a veteran will get his turn, because the team paid for it. His price usually dips while he waits. Rebuilders should want this player more than contenders do.",
    },
  },
  day2: {
    open: {
      title: "Opportunity play",
      move: "Draft him, watch the leash",
      body: "A second- or third-round pick with an open job can produce right away, but the team has less invested in him than in a first-rounder. If he starts hot, you hold a player whose price may never be higher.",
    },
    shared: {
      title: "Priced like a coin flip",
      move: "Take him at value, not above it",
      body: "Day-two capital and a shared role is the middle of every rookie draft. Do not reach. Let him come to you in the second round, where the price matches the odds.",
    },
    blocked: {
      title: "Patience pick",
      move: "Taxi squad",
      body: "He needs a year and maybe an injury ahead of him. That is what a taxi squad is for. The second-year jump is real for receivers and tight ends, so give him the full two seasons before you cut him.",
    },
  },
  day3: {
    open: {
      title: "Rental",
      move: "Sell the hot start",
      body: "A late-round pick with an open depth chart is the landing-spot trap. The job is real until the team drafts or signs his replacement, and teams replace day-three players easily. Enjoy the points and sell if a hot month makes him expensive.",
    },
    shared: {
      title: "Lottery ticket",
      move: "Late rounds only",
      body: "Low capital and no clear role. Players like this hit rarely. Spend a third- or fourth-round rookie pick, never more, and keep the roster spot flexible.",
    },
    blocked: {
      title: "Lottery ticket",
      move: "Late rounds or the waiver wire",
      body: "Low capital and a starter in front of him. Most of these players are on waivers within a year. If you like the talent, a last-round pick or a free taxi spot is the right price.",
    },
  },
};

export function sortRookie(capital: CapitalDay, path: DepthPath): RookieSort {
  return SORT[capital][path];
}

/* ---------- Lesson 9: on the clock ---------- */

export type Lane = "contend" | "middle" | "rebuild";
export type SlotBand = "top4" | "mid1" | "late1" | "later";
export type TierShape = "clear" | "flat";

export type ClockCall = { call: string; body: string };

/** The odds sentence for a slot band, from the Dynasty Nerds figures above. */
export function slotOdds(band: SlotBand): string {
  const pct = (key: string) => Math.round(ROOKIE_PICK_HIT_RATES.find((h) => h.key === key)?.hit ?? 0);
  if (band === "top4") return `Picks 1.01 to 1.04 hit ${pct("102")} to ${pct("101")} percent of the time in the Dynasty Nerds study.`;
  if (band === "mid1") return `Picks 1.05 to 1.08 hit ${pct("105")} percent of the time in the Dynasty Nerds study.`;
  if (band === "late1") return `Picks 1.09 to 1.12 hit ${pct("109")} percent of the time in the Dynasty Nerds study.`;
  return `Round two hit about ${pct("201")} percent of the time in the Dynasty Nerds study, and round three ${pct("300")} percent.`;
}

export function clockCall(lane: Lane, band: SlotBand, tier: TierShape): ClockCall {
  if (band === "top4") {
    return lane === "contend"
      ? {
          call: "Make the pick, or sell it for a proven starter",
          body: "A top-four pick is the one rookie pick that usually becomes a player. Keep it unless someone offers a starter who is still in his prime. Do not sell it for depth.",
        }
      : {
          call: "Make the pick",
          body: "This is the pick a rebuild exists to earn. Take the best player on your board and ignore your depth chart. You can trade for a position later; you cannot trade for these odds.",
        };
  }
  if (tier === "clear") {
    return {
      call: "Make the pick",
      body: "When one player on your board stands clearly above the next few, the slot is worth more to you than to the room. Take him and do not get clever.",
    };
  }
  if (band === "later") {
    return lane === "contend"
      ? {
          call: "Package picks for a player who helps now",
          body: "Two picks in this range rarely add up to one starter. Offer them together for a veteran who fills a lineup spot this season.",
        }
      : {
          call: "Take the upside swing",
          body: "With no clear tier, draft the player with the best NFL draft capital left, or the one whose role could grow in year two. A safe backup is the wrong use of a late pick.",
        };
  }
  if (lane === "contend") {
    return {
      call: "Sell the pick for a veteran",
      body: "The players left look alike to you, and rookie picks are at their most expensive while a draft is live. A contender gets more from a starter today than from a coin flip in two years.",
    };
  }
  return {
    call: "Trade back",
    body: "If the next four or five players are the same to you, move down a few spots and collect an extra pick for it. You still get one of them, and the extra pick is a free second try.",
  };
}

/* ---------- FAQ ---------- */

export type FaqItem = { question: string; answer: string };

/** The live facts the FAQ quotes. Every field is optional: a failed read leaves the sentence out. */
export type RookieFaqFacts = {
  season: number;
  drafts: number;
  linearPct: number;
  commonRounds: number;
  commonRoundsPct: number;
  busiestMonth: string;
  busiestMonthPct: number;
  byEndOfMayPct: number;
} | null;

export function buildRookieFaq(facts: RookieFaqFacts): FaqItem[] {
  const top = Math.round(ROOKIE_PICK_HIT_RATES[0].hit);
  const next = Math.round(ROOKIE_PICK_HIT_RATES[1].hit);
  const round2 = Math.round(ROOKIE_PICK_HIT_RATES[4].hit);
  const late = Math.round(ROOKIE_PICK_HIT_RATES[6].hit);
  return [
    {
      question: "What is a dynasty rookie draft?",
      answer:
        "In a dynasty league you keep your whole roster from one year to the next, so the only new players each year are the NFL's rookie class. The rookie draft is the short draft, usually three to five rounds, where the league divides that class. Draft order normally runs from the worst team to the best.",
    },
    {
      question: "When do dynasty rookie drafts happen?",
      answer: facts
        ? `Most leagues draft in the weeks after the NFL draft, which is held in late April. Of the ${facts.drafts} rookie drafts FF Beacon synced from Sleeper in ${facts.season}, ${facts.busiestMonthPct} percent started in ${facts.busiestMonth} and ${facts.byEndOfMayPct} percent had started by the end of May. A smaller group waits until August, just before the season.`
        : "Most leagues draft in the weeks after the NFL draft, which is held in late April, so May is the busiest month. A smaller group waits until August, just before the season.",
    },
    {
      question: "Are rookie drafts linear or snake?",
      answer: facts
        ? `Almost always linear, meaning every round runs in the same order. Of the ${facts.drafts} rookie drafts FF Beacon synced from Sleeper in ${facts.season}, ${facts.linearPct} percent were linear. A startup draft is usually a snake; a rookie draft rewards the worst teams in every round on purpose.`
        : "Almost always linear, meaning every round runs in the same order. A startup draft is usually a snake; a rookie draft rewards the worst teams in every round on purpose.",
    },
    {
      question: "How many rounds is a dynasty rookie draft?",
      answer: facts
        ? `Three to five. In the ${facts.season} rookie drafts FF Beacon synced, ${facts.commonRounds} rounds was the most common length, at ${facts.commonRoundsPct} percent of drafts.`
        : "Usually three to five.",
    },
    {
      question: "How is rookie draft order decided?",
      answer:
        "The commissioner sets it. The common methods are the reverse of last season's standings for teams that missed the playoffs, with playoff teams ordered by how far they went. Some leagues order the non-playoff teams by the points their best possible lineup would have scored, and some run a lottery, both to discourage losing on purpose.",
    },
    {
      question: "How often does a rookie pick become a good player?",
      answer: `Less often than most managers think. In the Dynasty Nerds study of 2018 to 2023 rookie drafts, the 1.01 hit ${top} percent of the time and picks 1.02 to 1.04 hit ${next} percent. The rest of round one was close to a coin flip, round two hit about ${round2} percent, and round three ${late} percent.`,
    },
    {
      question: "When is the best time to trade rookie picks?",
      answer:
        "Sell them around the NFL draft and your rookie draft, when every manager has a name attached to every slot. Buy them at the start of the regular season. Footballguys' study of KeepTradeCut prices found picks generally lose value from June to August and gain it back from September, with first-round picks holding their price better than later ones.",
    },
    {
      question: "Should I draft for need or take the best player?",
      answer:
        "Take the best player. A rookie pick takes one to three years to pay off, and your depth chart will look different by then. Fix a position by trade, where you know what you are getting.",
    },
    {
      question: "Do rookie quarterbacks go earlier in superflex leagues?",
      answer:
        "Yes, by a lot. A superflex league lets every team start two quarterbacks, so the position is scarce and a first-round NFL quarterback moves into the top of the rookie draft. In a one-quarterback league the same player goes later, often by most of a round or more.",
    },
    {
      question: "Does FF Beacon have a tool for rookie drafts?",
      answer:
        "Yes. On The Clock connects to a live Sleeper rookie draft, shows who is left with their values, and suggests a pick each time you are up. The trade calculator prices rookie picks alongside players in your league's format.",
    },
  ];
}
