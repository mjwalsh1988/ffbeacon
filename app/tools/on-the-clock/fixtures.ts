/**
 * Mock data for the On The Clock UI shell (Phase 4).
 *
 * NOTHING here calls Sleeper or Supabase. These fixtures stand in for the shaped
 * payloads the Phase 3 routes return (ShapedDraftCache, LeagueCard) plus a ranked
 * board and placeholder recommendations, so the whole UI can be built and audited
 * before live wiring (Phase 5). The shapes intentionally mirror
 * lib/on-the-clock/types.ts so Phase 5 can swap fixtures for fetched data with
 * minimal change.
 *
 * Snake-draft math used by the board: 8 teams, 5 rounds. Round 1 picks 1..8 map to
 * slots 1..8; even rounds reverse (round 2 picks 9..16 map to slots 8..1), and so
 * on. 11 picks have been made, so pick 12 (round 2, slot 5) is on the clock.
 */

import type { LeagueCard, ShapedDraftCache, ShapedPick } from "@/lib/on-the-clock/types";
// The board types now live in lib so the server loader and the client share one
// definition. Re-exported here so existing imports from "./fixtures" still resolve.
export type {
  DraftPosition,
  RankedPlayer,
  RecommendationCardData,
} from "@/lib/on-the-clock/board-types";
import type {
  DraftPosition,
  RankedPlayer,
  RecommendationCardData,
} from "@/lib/on-the-clock/board-types";

export const MOCK_TEAMS = 8;
export const MOCK_ROUNDS = 5;
export const MOCK_PICKS_MADE = 11;

/** The connected user, for My Draft + "Your pick" markers. */
export const MOCK_CONNECTED_USER = {
  userId: "u3",
  displayName: "You",
  rosterId: 3,
  draftSlot: 3,
};

export const MOCK_LEAGUES: LeagueCard[] = [
  {
    leagueId: "1111111111",
    draftId: "2222222222",
    season: "2026",
    name: "Beacon Dynasty SF",
    totalRosters: 8,
    avatar: null,
    draftStatus: "drafting",
    formatSlug: "dynasty-ppr-sflex",
    formatLabel: "Dynasty Superflex",
    formatDerivedLabel: "Dynasty PPR Superflex",
    formatIsClosest: false,
  },
  {
    leagueId: "3333333333",
    draftId: "4444444444",
    season: "2026",
    name: "Friends & Family Redraft",
    totalRosters: 12,
    avatar: null,
    draftStatus: "drafting",
    formatSlug: "redraft-ppr-std",
    formatLabel: "Redraft PPR",
    formatDerivedLabel: "Redraft PPR",
    formatIsClosest: false,
  },
  {
    leagueId: "5555555555",
    draftId: "6666666666",
    season: "2026",
    name: "The Rookie Mock",
    totalRosters: 10,
    avatar: null,
    draftStatus: "pre_draft",
    formatSlug: "dynasty-ppr-sflex",
    formatLabel: "Dynasty Superflex",
    formatDerivedLabel: "Dynasty PPR Superflex",
    formatIsClosest: false,
  },
];

// Players already drafted, in pick order (pick_no 1..11). Names are illustrative.
const DRAFTED: Array<{ name: string; pos: DraftPosition; team: string }> = [
  { name: "Bijan Robinson", pos: "RB", team: "ATL" },
  { name: "Ja'Marr Chase", pos: "WR", team: "CIN" },
  { name: "Jahmyr Gibbs", pos: "RB", team: "DET" },
  { name: "CeeDee Lamb", pos: "WR", team: "DAL" },
  { name: "Justin Jefferson", pos: "WR", team: "MIN" },
  { name: "Amon-Ra St. Brown", pos: "WR", team: "DET" },
  { name: "Saquon Barkley", pos: "RB", team: "PHI" },
  { name: "Puka Nacua", pos: "WR", team: "LAR" },
  { name: "Malik Nabers", pos: "WR", team: "NYG" },
  { name: "Nico Collins", pos: "WR", team: "HOU" },
  { name: "Brock Bowers", pos: "TE", team: "LV" },
];

/** Snake pick_no -> draft_slot for an 8-team board. */
function slotForPick(pickNo: number): number {
  const round = Math.ceil(pickNo / MOCK_TEAMS);
  const indexInRound = ((pickNo - 1) % MOCK_TEAMS) + 1; // 1..8
  // Even rounds reverse.
  return round % 2 === 0 ? MOCK_TEAMS - indexInRound + 1 : indexInRound;
}

const MOCK_PICK_ROWS: ShapedPick[] = DRAFTED.map((p, i) => {
  const pickNo = i + 1;
  const draftSlot = slotForPick(pickNo);
  const round = Math.ceil(pickNo / MOCK_TEAMS);
  const [firstName, ...rest] = p.name.split(" ");
  return {
    pickNo,
    round,
    draftSlot,
    rosterId: draftSlot, // 1:1 slot->roster in this mock
    pickedBy: `u${draftSlot}`,
    sleeperPlayerId: String(1000 + i),
    playerId: `player-${i}`,
    isKeeper: false,
    firstName: firstName ?? null,
    lastName: rest.join(" ") || null,
    position: p.pos,
    team: p.team,
  };
});

export const MOCK_DRAFT_CACHE: ShapedDraftCache = {
  draft: {
    sleeperDraftId: "2222222222",
    sleeperLeagueId: "1111111111",
    season: "2026",
    draftStatus: "drafting",
    draftType: "snake",
    pickCount: MOCK_PICKS_MADE,
    slotToRosterId: Object.fromEntries(
      Array.from({ length: MOCK_TEAMS }, (_, i) => [String(i + 1), i + 1]),
    ),
    settings: { teams: MOCK_TEAMS, rounds: MOCK_ROUNDS },
    lastSyncedAt: null, // filled with a relative label by the client mock
  },
  users: Array.from({ length: MOCK_TEAMS }, (_, i) => ({
    userId: `u${i + 1}`,
    displayName: i + 1 === MOCK_CONNECTED_USER.draftSlot ? "You" : `Team ${i + 1}`,
    username: null,
    teamName: null,
    avatar: null,
  })),
  rosters: Array.from({ length: MOCK_TEAMS }, (_, i) => ({
    rosterId: i + 1,
    ownerId: `u${i + 1}`,
    coOwners: [],
    players: [],
  })),
  picks: MOCK_PICK_ROWS,
  tradedPicks: [],
};

/**
 * Mock-only spotlight enrichment, keyed by player name. Fixture data only: a few
 * top names carry experience/age/recent finishes/a scouting note so the premium
 * player spotlight has something to show. Players without an entry simply render
 * the spotlight without those sections.
 */
const ENRICH: Record<
  string,
  { yearsExperience?: number; age?: number; recentFinishes?: string[]; shortNote?: string }
> = {
  "Garrett Wilson": {
    yearsExperience: 4,
    age: 25,
    recentFinishes: ["WR6", "WR14", "WR8"],
    shortNote: "Volume-proof target hog with a new QB upgrade.",
  },
  "Breece Hall": {
    yearsExperience: 4,
    age: 24,
    recentFinishes: ["RB9", "RB5", "RB21"],
    shortNote: "Three-down back; your roster is thin at RB.",
  },
  "Marvin Harrison Jr.": {
    yearsExperience: 2,
    age: 23,
    recentFinishes: ["WR22", "WR31"],
    shortNote: "Ascending alpha entering a full second year.",
  },
  "Jonathan Taylor": {
    yearsExperience: 6,
    age: 26,
    recentFinishes: ["RB4", "RB18", "RB2"],
    shortNote: "Bellcow workload when healthy.",
  },
  "De'Von Achane": {
    yearsExperience: 3,
    age: 23,
    recentFinishes: ["RB7", "RB12"],
    shortNote: "Big-play speed and a rising target share.",
  },
  "Josh Allen": {
    yearsExperience: 8,
    age: 29,
    recentFinishes: ["QB2", "QB1", "QB3"],
    shortNote: "Weekly QB1 ceiling, superflex difference-maker.",
  },
  "Trey McBride": {
    yearsExperience: 4,
    age: 25,
    recentFinishes: ["TE3", "TE2"],
    shortNote: "Target monster at a scarce position.",
  },
};

/** Remaining ranked board (undrafted), incl DST/K so the room shows them. */
export const MOCK_AVAILABLE: RankedPlayer[] = [
  { name: "Garrett Wilson", position: "WR", team: "NYJ", isRookie: false },
  { name: "Breece Hall", position: "RB", team: "NYJ", isRookie: false },
  { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", isRookie: false },
  { name: "Drake London", position: "WR", team: "ATL", isRookie: false },
  { name: "De'Von Achane", position: "RB", team: "MIA", isRookie: false },
  { name: "Jonathan Taylor", position: "RB", team: "IND", isRookie: false },
  { name: "Josh Allen", position: "QB", team: "BUF", isRookie: false },
  { name: "Trey McBride", position: "TE", team: "ARI", isRookie: false },
  { name: "Jayden Daniels", position: "QB", team: "WAS", isRookie: false },
  { name: "Ashton Jeanty", position: "RB", team: "LV", isRookie: true },
  { name: "Patrick Mahomes", position: "QB", team: "KC", isRookie: false },
  { name: "Davante Adams", position: "WR", team: "LAR", isRookie: false },
  { name: "Kyren Williams", position: "RB", team: "LAR", isRookie: false },
  { name: "DJ Moore", position: "WR", team: "CHI", isRookie: false },
  { name: "George Kittle", position: "TE", team: "SF", isRookie: false },
  { name: "Tee Higgins", position: "WR", team: "CIN", isRookie: false },
  { name: "James Cook", position: "RB", team: "BUF", isRookie: false },
  { name: "Caleb Williams", position: "QB", team: "CHI", isRookie: false },
  { name: "Travis Hunter", position: "WR", team: "JAX", isRookie: true },
  { name: "Sam LaPorta", position: "TE", team: "DET", isRookie: false },
  { name: "Harrison Butker", position: "K", team: "KC", isRookie: false },
  { name: "Brandon Aubrey", position: "K", team: "DAL", isRookie: false },
  { name: "Baltimore Ravens", position: "DEF", team: "BAL", isRookie: false },
  { name: "Buffalo Bills", position: "DEF", team: "BUF", isRookie: false },
].map((p, i): RankedPlayer => {
  // value/positionRank are illustrative, not engine output.
  return {
    playerId: `avail-${i}`,
    sleeperId: p.position === "DEF" ? p.team : String(2000 + i),
    name: p.name,
    position: p.position as DraftPosition,
    team: p.team,
    overallRank: i + 12,
    positionRank: 0, // set below
    tier: Math.floor(i / 6) + 1,
    value: Math.max(1, 9000 - i * 320),
    isRookie: p.isRookie,
    ...(ENRICH[p.name] ?? {}),
  };
});

// Assign position ranks in board order.
(() => {
  const counts: Record<string, number> = {};
  for (const p of MOCK_AVAILABLE) {
    counts[p.position] = (counts[p.position] ?? 0) + 1;
    p.positionRank = counts[p.position];
  }
})();

export const MOCK_RECOMMENDATIONS: { best: RecommendationCardData; need: RecommendationCardData } = {
  best: {
    kind: "best",
    player: MOCK_AVAILABLE[0], // Garrett Wilson (highest remaining value)
    reason: "Highest FF Beacon value still on the board.",
    decidingFactor: "value",
    filledSlot: null,
  },
  need: {
    kind: "need",
    player: MOCK_AVAILABLE[1], // Breece Hall
    reason:
      "Your roster is light at RB compared to this league's starting lineup, and this is the best-value RB still available.",
    decidingFactor: "need",
    filledSlot: "RB",
  },
};

/** Relative "last synced" label, mocked (Phase 5 derives from lastSyncedAt). */
export const MOCK_SYNC_STATUS = {
  lastSyncedLabel: "Last synced 18 seconds ago",
  cooldownRemaining: 0,
  onTheClockSlot: 5,
  onTheClockPickNo: 12,
};

// ---------------------------------------------------------------------------
// Trade Analyzer fixtures removed in Phase 6C. The draft-room Trade Analyzer now
// builds its catalog from the live FF Beacon board via lib/on-the-clock/
// trade-analyzer.ts (buildTradeCatalog) and totals/verdicts via analyzeTradeSides.
// ---------------------------------------------------------------------------
