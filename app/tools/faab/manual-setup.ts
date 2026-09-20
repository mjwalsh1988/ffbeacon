/**
 * The manual calculator's setup: what the reader tells us when there is no
 * league to read.
 *
 * Every option here maps onto something the model already understands. League
 * type and superflex pick the market cell, the bid style scales the win
 * curve, the competition control sets how many rivals are in the room, and
 * the chopped controls carry the one thing a guillotine league cannot infer
 * without a roster: how much danger the reader is in this week.
 *
 * Pure, and free of React, so the page can seed it from the URL on the server
 * and the form can hold it in state in the browser.
 */

import type { BidStyle, NeedLevel } from "@/lib/faab/types";

export type ManualLeagueType = "redraft" | "dynasty" | "chopped";
export type ManualDanger = "bottomTwo" | "nearCut" | "midPack" | "safe";
/**
 * "auto" is the "Let us guess" option: the model reads it off the upgrade.
 *
 * Three explicit answers rather than four, because a reader can tell the
 * difference between nobody, a couple of teams and half the room, and cannot
 * tell the difference between three bidders and four. The three-bidder cell
 * is still reached, by "Let us guess".
 */
export type ManualCompetition = "auto" | "1" | "2" | "4p";
export type ChoppedPlatformKey =
  | "sleeper"
  | "yahoo"
  | "espn"
  | "ffpc"
  | "fantasy-life"
  | "other";

export const LEAGUE_TYPE_LABEL: Record<ManualLeagueType, string> = {
  redraft: "Redraft",
  dynasty: "Dynasty or keeper",
  chopped: "Chopped or guillotine",
};

export const STYLE_LABEL: Record<BidStyle, string> = {
  tight: "Tight",
  typical: "Typical",
  wild: "Wild",
};

export const COMPETITION_LABEL: Record<ManualCompetition, string> = {
  auto: "Let us guess",
  "1": "Just me",
  "2": "One or two",
  "4p": "Half the league",
};

export const DANGER_LABEL: Record<ManualDanger, string> = {
  bottomTwo: "Bottom two",
  nearCut: "Near the cut",
  midPack: "Middle of the pack",
  safe: "Safe",
};

/**
 * What each platform's rules do to a bid.
 *
 * `minBid` is the smallest claim the platform accepts, which decides whether
 * a free claim can win. `releaseCutoffWeek` is the last week a chopped roster
 * is released back onto waivers; past it the pool stops refilling.
 */
export const CHOPPED_PLATFORMS: Array<{
  key: ChoppedPlatformKey;
  label: string;
  minBid: number;
  releaseCutoffWeek: number | null;
}> = [
  { key: "sleeper", label: "Sleeper Chopped", minBid: 0, releaseCutoffWeek: null },
  { key: "yahoo", label: "Yahoo Death League", minBid: 0, releaseCutoffWeek: null },
  { key: "espn", label: "ESPN Knockout", minBid: 0, releaseCutoffWeek: null },
  { key: "ffpc", label: "FFPC Chop Classic", minBid: 1, releaseCutoffWeek: 14 },
  {
    key: "fantasy-life",
    label: "Fantasy Life Guillotine",
    minBid: 0,
    releaseCutoffWeek: 14,
  },
  { key: "other", label: "Other", minBid: 0, releaseCutoffWeek: null },
];

export function choppedPlatform(key: ChoppedPlatformKey) {
  return CHOPPED_PLATFORMS.find((p) => p.key === key) ?? CHOPPED_PLATFORMS[0];
}

/** Everything the manual calculator knows about the reader's league. */
export type ManualSetupState = {
  leagueType: ManualLeagueType;
  superflex: boolean;
  teams: number;
  starters: number;
  /** What the reader has left to spend. */
  remainingBudget: number;
  /** The league's full starting allowance. Every price is a share of this. */
  leagueBudget: number;
  style: BidStyle;
  competition: ManualCompetition;
  need: NeedLevel;
  /** Chopped leagues only, ignored elsewhere. */
  startCount: number;
  aliveCount: number;
  danger: ManualDanger;
  platform: ChoppedPlatformKey;
};

/** The parts of the setup a link is allowed to fill in. */
export type ManualSeed = {
  leagueType: ManualLeagueType | null;
  startCount: number | null;
  aliveCount: number | null;
  danger: ManualDanger | null;
};

export const EMPTY_MANUAL_SEED: ManualSeed = {
  leagueType: null,
  startCount: null,
  aliveCount: null,
  danger: null,
};

const DANGER_FROM_PARAM: Record<string, ManualDanger> = {
  bottom: "bottomTwo",
  "bottom-two": "bottomTwo",
  near: "nearCut",
  "near-cut": "nearCut",
  mid: "midPack",
  "mid-pack": "midPack",
  safe: "safe",
};

function readCount(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^[0-9]{1,2}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 2 && value <= 32 ? value : null;
}

/**
 * Seed the setup from a link, strictly.
 *
 * The chopped guide links straight in with the reader's own league shape, so
 * the form opens on their situation rather than on a default they have to
 * retype. Anything unexpected is ignored rather than guessed at, and a
 * teams-alive figure above the starting field is dropped: it describes no
 * league that exists.
 */
export function parseManualSeed(params: {
  kind?: string | string[];
  start?: string | string[];
  alive?: string | string[];
  danger?: string | string[];
}): ManualSeed {
  const kindRaw = typeof params.kind === "string" ? params.kind : null;
  const leagueType: ManualLeagueType | null =
    kindRaw === "chopped" || kindRaw === "redraft" || kindRaw === "dynasty"
      ? kindRaw
      : null;

  const startCount = readCount(params.start);
  const aliveRaw = readCount(params.alive);
  const aliveCount =
    aliveRaw !== null && startCount !== null && aliveRaw > startCount ? null : aliveRaw;

  const dangerRaw = typeof params.danger === "string" ? params.danger : null;
  const danger = dangerRaw ? (DANGER_FROM_PARAM[dangerRaw] ?? null) : null;

  return { leagueType, startCount, aliveCount, danger };
}

/**
 * How many teams the model should assume are chasing him.
 *
 * "Let us guess" reads it off how big an upgrade he is: nobody fights over a
 * bench body, and everybody fights over a starter. A chopped league with half
 * the field still alive crowds a room faster, because several rosters hit
 * waivers at once and everyone left is trying to survive the same week.
 */
export function biddersFor(
  competition: ManualCompetition,
  upgradeStrength: number,
  chopped: { aliveFraction: number } | null,
): "1" | "2" | "3" | "4p" {
  if (competition !== "auto") return competition;
  if (chopped && upgradeStrength >= 0.4 && chopped.aliveFraction >= 0.5) return "4p";
  if (upgradeStrength >= 0.6) return "4p";
  if (upgradeStrength >= 0.3) return "3";
  if (upgradeStrength >= 0.1) return "2";
  return "1";
}
