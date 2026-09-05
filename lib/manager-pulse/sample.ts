/**
 * The guest-view fixture for Manager Pulse (docs/manager-pulse-plan.md 7.3).
 *
 * A signed-out visitor to /tools/manager-pulse sees a sign-in prompt where the
 * search box would be, and the full report below it, rendered from this
 * fixture instead of a real capture. It exists to show the shape of the
 * product before anyone types a Sleeper handle.
 *
 * ABSOLUTE RULE: NOTHING HERE MAY BE MISTAKEN FOR A REAL PERSON.
 *   The handle is `SampleManager`, which cannot be read as a real Sleeper
 *   handle. Every player name is an obvious placeholder ("Sample Player A"),
 *   never a real NFL player. Every league name is an obvious placeholder
 *   ("Example Dynasty League"). A screenshot of any one table in this fixture,
 *   on its own, with no surrounding page chrome, must still read as fake.
 *
 * ABSOLUTE RULE: THE SHAPE IS HONEST, THE NUMBERS ARE NOT BELIEVABLE.
 *   Win rate sits near 0.5, margins sit at a few percent, sample sizes are in
 *   the range a real multi-season handle would show. That is so the layout
 *   this fixture drives is exercised the same way a real report would
 *   exercise it. But the numbers are round in a way a careful reader notices
 *   (a win rate of exactly 0.500, a grade of exactly 75) rather than the messy
 *   decimals a real computation produces.
 *
 * ABSOLUTE RULE: ABSENCE IS SHOWN, NOT HIDDEN.
 *   A sample that only shows the happy path lies about the product. This
 *   fixture carries several null figures (data a real report sometimes cannot
 *   produce: no keeper usage in a non-keeper league, no live per-pick timing
 *   yet, no FAAB share in a league that runs none, no finish yet for a league
 *   still in season) and one empty list (avoids, for a manager with no
 *   pattern of passing on anyone), so a guest sees how the report renders
 *   absence before they ever hit it for real. It also carries a `PerTypeStat`
 *   with one side populated and the other null (trading.avgValueMargin has a
 *   dynasty reading and no redraft reading), because dynasty and redraft
 *   trade margins are never pooled (types.ts rule 2) and a guest should see
 *   that split rendered honestly rather than papered over with a zero.
 *
 * ABSOLUTE RULE: THIS FILE HAS EXACTLY ONE REAL IMPORTER PLUS ITS OWN TEST.
 *   components/manager-pulse/sample-report.tsx is the only production code
 *   that may import SAMPLE_MANAGER_REPORT. ./sample-isolation.test.ts is the
 *   guard: it scans lib/manager-pulse, components/manager-pulse and
 *   app/tools/manager-pulse for any other file that imports this module and
 *   fails the build if one exists. This is the line that stops an invented
 *   number from ever reaching a page about a real person.
 */

import type {
  ManagerReport,
  PlayerExposure,
  RepeatDraftEntry,
  TradePartnerEntry,
  OverpayEntry,
  ManagerLeagueRow,
  NarrativeSentence,
} from "./types";

const FAVOURITES: PlayerExposure[] = [
  {
    playerId: "sample-player-a",
    name: "Sample Player A",
    position: "RB",
    exposureScore: 0.82,
    leagueSeasonsRostered: 7,
    leagueWideRosterRate: 0.34,
  },
  {
    playerId: "sample-player-b",
    name: "Sample Player B",
    position: "WR",
    exposureScore: 0.71,
    leagueSeasonsRostered: 6,
    leagueWideRosterRate: 0.41,
  },
  {
    playerId: "sample-player-c",
    name: "Sample Player C",
    position: "QB",
    exposureScore: 0.55,
    leagueSeasonsRostered: 4,
    leagueWideRosterRate: 0.22,
  },
];

const REPEAT_DRAFTS: RepeatDraftEntry[] = [
  { playerId: "sample-player-d", name: "Sample Player D", timesDrafted: 3 },
  { playerId: "sample-player-e", name: "Example Back E", timesDrafted: 2 },
];

const TRADE_PARTNERS: TradePartnerEntry[] = [
  { sleeperUserId: "sample-partner-user-1", handle: "SamplePartnerOne", tradeCount: 3 },
  { sleeperUserId: "sample-partner-user-2", handle: "SamplePartnerTwo", tradeCount: 2 },
];

const OVERPAYS: OverpayEntry[] = [
  {
    subject: "sample-player-a",
    subjectLabel: "Example Receiver A",
    playerId: "sample-player-a",
    kind: "player",
    position: "WR",
    // PERCENT units, matching Signal Check's own margin: -18.4 means they came
    // out eighteen point four percent behind market on these trades.
    avgMarginPct: -18.4,
    sampleSize: 4,
  },
  {
    subject: "RB",
    subjectLabel: "Running back",
    playerId: null,
    kind: "position",
    position: "RB",
    avgMarginPct: -7.2,
    sampleSize: 4,
  },
];

const BARGAINS: OverpayEntry[] = [
  {
    subject: "sample-player-c",
    subjectLabel: "Example Tight End C",
    playerId: "sample-player-c",
    kind: "player",
    position: "TE",
    avgMarginPct: 12.6,
    sampleSize: 3,
  },
];

const LEAGUES: ManagerLeagueRow[] = [
  {
    leagueId: "sample-league-1",
    sleeperLeagueId: "900000000000000001",
    season: 2026,
    leagueName: "Example Dynasty League",
    category: "dynasty",
    lens: "dynasty",
    teamCount: 12,
    record: { wins: 8, losses: 5, ties: 0 },
    finish: 3,
    champion: false,
    runnerUp: false,
    madePlayoffs: true,
    hasLeaguePulseLink: true,
  },
  {
    leagueId: null,
    sleeperLeagueId: "900000000000000002",
    season: 2025,
    leagueName: "Example Dynasty League",
    category: "dynasty",
    lens: "dynasty",
    teamCount: 12,
    record: { wins: 9, losses: 4, ties: 0 },
    finish: 1,
    champion: true,
    runnerUp: false,
    madePlayoffs: true,
    hasLeaguePulseLink: false,
  },
  {
    // Season still open: no finish to report yet. Shown as null, not as a
    // placeholder rank, so a guest sees an in-progress league render honestly.
    leagueId: "sample-league-3",
    sleeperLeagueId: "900000000000000003",
    season: 2026,
    leagueName: "Example Redraft League",
    category: "redraft",
    lens: "redraft",
    teamCount: 10,
    record: { wins: 4, losses: 4, ties: 0 },
    finish: null,
    champion: false,
    runnerUp: false,
    madePlayoffs: false,
    hasLeaguePulseLink: true,
  },
  {
    leagueId: "sample-league-4",
    sleeperLeagueId: "900000000000000004",
    season: 2024,
    leagueName: "Example Best Ball League",
    category: "best-ball-redraft",
    lens: "redraft",
    teamCount: 12,
    record: { wins: 6, losses: 7, ties: 0 },
    finish: 8,
    champion: false,
    runnerUp: false,
    madePlayoffs: false,
    hasLeaguePulseLink: false,
  },
];

const NARRATIVE_SENTENCES: NarrativeSentence[] = [
  {
    templateId: "sample.results.win-rate",
    text: "SampleManager wins about half their matchups across 9 league-seasons.",
    sampleSize: 9,
  },
  {
    templateId: "sample.trading.dynasty-margin",
    text: "In dynasty trades, SampleManager gives up a little more value than they get, about 4 percent on average.",
    sampleSize: 10,
  },
  {
    templateId: "sample.drafting.reach",
    text: "SampleManager tends to draft a shade earlier than market ADP.",
    sampleSize: 5,
  },
  {
    templateId: "sample.roster-ops.efficiency",
    text: "SampleManager starts about 87 percent of the points their roster could have produced.",
    sampleSize: 7,
  },
];

/**
 * A complete, realistic-shaped fixture for the guest report.
 *
 * See the file header for the rules this exists to satisfy. Do not import
 * this outside components/manager-pulse/sample-report.tsx; see
 * ./sample-isolation.test.ts.
 */
export const SAMPLE_MANAGER_REPORT: ManagerReport = {
  identity: {
    sleeperUserId: "sample-manager-user-id",
    handle: "SampleManager",
    avatarUrl: null,
    seasonsCovered: 4,
    leagueSeasonsFound: 9,
    splits: {
      dynasty: 4,
      redraft: 3,
      bestBallDynasty: 1,
      bestBallRedraft: 1,
    },
    firstSeasonSeen: 2023,
  },

  results: {
    sampleSize: { all: 9, dynasty: 5, redraft: 4 },
    record: {
      all: { wins: 47, losses: 46, ties: 1 },
      dynasty: { wins: 26, losses: 24, ties: 0 },
      redraft: { wins: 21, losses: 22, ties: 1 },
    },
    winRate: { all: 0.5, dynasty: 0.52, redraft: 0.48 },
    championships: { all: 2, dynasty: 2, redraft: 0 },
    runnerUps: { all: 1, dynasty: 1, redraft: 0 },
    playoffRate: { all: 0.56, dynasty: 0.6, redraft: 0.5 },
    lastPlaceFinishes: { all: 1, dynasty: 0, redraft: 1 },
    avgFinishPercentile: { all: 0.58, dynasty: 0.62, redraft: 0.53 },
    pointsForRank: { all: 0.55, dynasty: 0.6, redraft: 0.5 },
    // Redraft side null on purpose: too few finished redraft league-seasons
    // for a points-against rank to mean anything yet.
    pointsAgainstRank: { all: 0.5, dynasty: 0.5, redraft: null },
  },

  drafting: {
    reachIndexRounds: { all: 0.1, dynasty: 0.15, redraft: 0.05 },
    reachIndexSampleSize: { all: 9, dynasty: 5, redraft: 4 },
    firstRoundsShape: {
      all: { RB: 0.4, WR: 0.35, QB: 0.15, TE: 0.1 },
      dynasty: { RB: 0.45, WR: 0.3, QB: 0.15, TE: 0.1 },
      redraft: { RB: 0.35, WR: 0.4, QB: 0.15, TE: 0.1 },
    },
    firstRoundsSampleSize: { all: 9, dynasty: 5, redraft: 4 },
    rookieVeteranLean: 0.2,
    rookieVeteranLeanSampleSize: 5,
    // Null on purpose: none of this manager's leagues carry keepers.
    keeperUsageRate: null,
    keeperUsageSampleSize: 0,
    avgDraftGrade: { all: 75, dynasty: 78, redraft: 71 },
    avgDraftGradeSampleSize: { all: 9, dynasty: 5, redraft: 4 },
    draftPace: { secondsPerPick: 46, clockShareUsed: 0.38, draftsObserved: 9 },
    // Null on purpose: per-pick timing only exists once a draft has been
    // observed live, and this sample manager has none yet.
    perPickClock: null,
    autopick: { rate: 0.08, draftsObserved: 9 },
  },

  affinity: {
    favourites: FAVOURITES,
    favouritesSampleSize: 9,
    // Empty on purpose: an avoids list needs a player who had real
    // opportunity and was still passed over, and this sample manager has no
    // such pattern.
    avoids: [],
    avoidsSampleSize: 0,
    repeatDrafts: REPEAT_DRAFTS,
    repeatDraftsSampleSize: 5,
  },

  trading: {
    tradeCount: { all: 14, dynasty: 10, redraft: 4 },
    tradesPerSeason: { all: 1.6, dynasty: 2.5, redraft: 1.3 },
    // Redraft side null on purpose: PerTypeStat never pools dynasty and
    // redraft margins, and this fixture also shows the case where only one
    // side has enough trades to read at all.
    // PERCENT units, matching Signal Check's own margin: -4.2 means four
    // point two percent under market.
    avgValueMargin: { dynasty: -4.2, redraft: null },
    avgValueMarginSampleSize: { dynasty: 10, redraft: null },
    verdictDistribution: {
      dynasty: { clear_win: 2, slight_win: 2, even: 4, slight_loss: 1, ungraded: 1 },
      redraft: null,
    },
    // Net league value, which is what the real figure sums, so the sample
    // exercises the same compact formatting a real report does.
    positionAppetite: {
      dynasty: { RB: 4200, WR: -1850, QB: 640, TE: -310 },
      redraft: null,
    },
    ageLean: 0.15,
    ageLeanSampleSize: 10,
    picksTraded: { dynasty: 6, redraft: 0 },
    pickFlow: {
      dynasty: {
        acquired: 4,
        sent: 2,
        roundsKnown: 6,
        byRound: [
          { round: 1, acquired: 1, sent: 0 },
          { round: 2, acquired: 2, sent: 1 },
          { round: 3, acquired: 1, sent: 1 },
        ],
        laterFromRound: null,
      },
      redraft: null,
    },
    mostTradedWith: { dynasty: TRADE_PARTNERS, redraft: [] },
    overpays: { dynasty: OVERPAYS, redraft: [] },
    bargains: { dynasty: BARGAINS, redraft: [] },
    tradesWithUnpricedPicks: { dynasty: 2, redraft: 0 },
  },

  rosterOps: {
    movesPerWeek: { all: 1.2, dynasty: 1.4, redraft: 0.9 },
    moveShape: { all: "steady", dynasty: "steady", redraft: "front-loaded" },
    waiverClaimsPerSeason: { all: 18, dynasty: 20, redraft: 15 },
    // Redraft side null on purpose: that league runs no FAAB, so a bid share
    // has nothing to measure.
    avgFaabBidShare: { all: 0.12, dynasty: 0.1, redraft: null },
    waiverPointsProduced: { all: 96.4, dynasty: 110.2, redraft: 70.5 },
    lineupEfficiency: { all: 0.87, dynasty: 0.88, redraft: 0.85 },
    lineupEfficiencySampleSize: { all: 7, dynasty: 4, redraft: 3 },
    bestLineupRecord: {
      all: { wins: 52, losses: 41, ties: 1 },
      dynasty: { wins: 29, losses: 21, ties: 0 },
      redraft: { wins: 23, losses: 20, ties: 1 },
    },
    winsLeftOnBench: { all: 5, dynasty: 3, redraft: 2 },
    abandonmentCount: { all: 0, dynasty: 0, redraft: 0 },
  },

  narrative: {
    sentences: NARRATIVE_SENTENCES,
  },

  leagues: LEAGUES,
  defaultLens: "dynasty",
  window: { seasonFrom: 2023, seasonTo: 2026 },
  counts: { leagueSeasons: 9, dynasty: 5, redraft: 4 },
  // Fixed, not `new Date().toISOString()`: a sample report is a static
  // picture and must render identically on every request.
  generatedAt: "2026-09-01T12:00:00.000Z",
  modelVersion: "sample-fixture",
  limits: {
    // 9 league-seasons found, 4 shown above: the fixture also exercises the
    // "found more than we display" case a heavy real handle would hit.
    leagueSeasonsSkipped: 5,
    leagueSeasonsWithoutLedger: 2,
    seasonsWithoutDraftObservations: 3,
  },
};
