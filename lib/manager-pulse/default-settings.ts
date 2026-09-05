/**
 * Manager Pulse model defaults.
 *
 * ABSOLUTE RULE: no limit, cap, cooldown, window, threshold, or sample floor in
 * this feature may be a hardcoded constant anywhere else in lib/manager-pulse/,
 * in an admin page, or in a route handler. Every one of them lives in this
 * object, is stored in manager_pulse_settings (a single id='global' row,
 * service-role only), and is reachable from a field in the /admin/manager-pulse
 * form. This object is the CODE FALLBACK for that row: it exists so a missing
 * or corrupt settings row cannot break the engine, not so a number can quietly
 * live in two places. If a value here and a value in a page ever disagree, the
 * page is wrong.
 *
 * Bump `modelVersion` whenever a change alters what the report means, so a
 * stale cached report or tendency row is identifiable and rescores rather than
 * serving a mix of old and new behaviour.
 */

export type ManagerPulseCaptureSettings = {
  /** Seasons the report covers by default. */
  seasonWindowDefault: number;
  /** The most a reader may ask for. */
  seasonWindowMax: number;
  seasonWindowMin: number;
  /** League-seasons one run may queue. */
  maxLeaguesPerRun: number;
  /** Guard against a handle that sits in an unreasonable number of leagues. */
  maxLeaguesPerSeason: number;
  /** Per user, between runs. */
  runCooldownSeconds: number;
  /** How long a computed report serves. */
  reportTtlHours: number;
  /** How long a tendency row serves. */
  tendencyTtlHours: number;
  /** The footprint sync's own freshness window. */
  captureTtlMinutes: number;
  /**
   * How long a run that is still open may be RESUMED by a later render
   * instead of a new one being claimed.
   *
   * A capture takes minutes and the page re-renders while it drains, so those
   * renders have to rejoin the run in flight rather than ask for another one
   * the cooldown will refuse. But a run whose worker died mid-drain stays open
   * forever, and resuming that one would park the reader on a progress bar
   * that can never finish. Past this age the run is left where it is (an
   * admin can still see it at /admin/manager-pulse/runs) and a fresh one is
   * claimed. Comfortably longer than the worker's own ten-minute reclaim of a
   * stalled job, so a run that is merely slow is still resumed.
   */
  resumeMaxAgeMinutes: number;
  jobMaxAttempts: number;
  /** Whether to count best ball leagues at all. */
  includeBestBall: boolean;
  /**
   * Let an admin skip the cooldown and the lookup rate limit.
   *
   * A switch rather than a hardcoded exemption, because "admins are exempt" is
   * a policy decision and this feature keeps every policy decision in this row.
   * It is ON by default so the person who has to test the tool can actually
   * test it; turn it off to feel exactly what a reader feels.
   *
   * It bypasses THROTTLING ONLY. It grants no extra data, widens no cap on how
   * many leagues a run may queue, and changes nothing about what a report says.
   */
  adminBypassThrottle: boolean;
};

export type ManagerPulseLookupSettings = {
  /** Rate limit on resolving a handle. */
  handleLookupPerMinute: number;
  handleLookupPerDay: number;
};

export type ManagerPulseSampleSettings = {
  /** Below this trade count, no average margin is shown. */
  minTradesForMargin: number;
  minTradesForPositionLean: number;
  minTradesForAgeLean: number;
  /** Times they paid up before we call it a habit. */
  minOverpaySample: number;
  minDraftsForReach: number;
  /** Seasons a player was available to them, before an absence counts as an avoid. */
  minAvoidSeasons: number;
  /** How commonly a player must be rostered league-wide before his absence from one manager's history is an avoid candidate rather than a replacement-level nobody. */
  minAvoidRosterRate: number;
  minSeasonsForTendency: number;
  /** Below this, win rate shows as a raw count instead of a rate. */
  minLeagueSeasonsForRate: number;
};

export type ManagerPulseDraftSettings = {
  /** Rounds early before a pick counts as a reach. */
  reachRoundsThreshold: number;
  /** What counts as an early pick for affinity weighting. */
  earlyRoundCutoff: number;
  // There is no configured poll gap here on purpose. The real interval is
  // MEASURED per observation and stored on the row (draft_pick_observations,
  // read in lib/manager-pulse/drafting.ts computePerPickClock), so a
  // configured value would only be a second, disagreeing answer sitting next
  // to the real one.
};

export type ManagerPulseDisplaySettings = {
  favouritesShown: number;
  avoidsShown: number;
  tradesShown: number;
  leagueRowsShown: number;
  narrativeSentencesMax: number;
  /**
   * Repeat-draft rows kept in the report.
   *
   * Uncapped, this list was the longest thing on the page by a wide margin: a
   * manager who drafts thirty leagues a year has hundreds of players taken
   * twice, and every one of them shipped inside the cached report document as
   * well as onto the screen. Capped like every other list here.
   */
  repeatDraftsShown: number;
  /**
   * Draft-pick rounds charted individually before the tail is combined.
   *
   * Sleeper's round numbers run as deep as a league's draft does, and some go
   * past thirty. Charting each of them gave the pick-flow card twenty-two rows,
   * eighteen of which were a single pick, which is a long tail wearing a
   * chart's clothes. Everything past this is summed into one "and later" row,
   * so nothing is dropped and the shape stays readable.
   */
  pickRoundsShown: number;
};

export type ManagerPulseTendencySettings = {
  /** How far a tendency may move an acceptance band, in band steps. */
  bandStepMax: number;
  /** Sample size ceilings for the three confidence bands. */
  confidenceLowMax: number;
  confidenceMediumMax: number;
  /** The global kill switch for Trade Ideas reading tendencies at all. */
  enabledForTradeIdeas: boolean;
};

/**
 * Thresholds that decide how a manager's week-to-week behaviour is described.
 *
 * These were local constants inside roster-ops.ts until it was pointed out that
 * they are exactly what this settings row exists for: a threshold that decides
 * whether we call somebody "front-loaded" or "faded" is a product judgement
 * about language, not an implementation detail, and it must be adjustable
 * without a deploy like every other floor in this feature.
 */
export type ManagerPulseBehaviourSettings = {
  /** Below this many moves in a lens, no shape is claimed at all. */
  moveShapeMinMoves: number;
  /** Share of moves in the first half of the season above which it is front-loaded. */
  moveShapeFrontLoaded: number;
  /** Share below which it is faded. Between the two it is steady. */
  moveShapeFaded: number;
  /** Consecutive quiet final weeks before a season can count toward abandonment. */
  abandonmentQuietWeeks: number;
};

/**
 * Where the line falls between one word and another.
 *
 * These decide vocabulary, not arithmetic. Nothing here changes a figure; they
 * decide whether three trades a season reads as "trades a lot", and whether a
 * two percent margin is worth calling "pays up" or is just noise. That makes
 * them the most editable numbers in the feature, not the least: they are the
 * point where a measurement becomes a sentence about a person.
 *
 * They were local constants in narrative.ts until the agent that wrote it
 * flagged, correctly, that it had no way to reach the settings row from there.
 */
export type ManagerPulseWordingSettings = {
  /** Trades per season at or above which they "trade a lot". */
  tradesOftenPerSeason: number;
  /** Trades per season at or below which they "barely trade". */
  tradesRarePerSeason: number;
  /** Below this absolute margin share, pays-up versus gets-value is noise. */
  marginDeadzone: number;
  /**
   * At or above this absolute margin share, a trade reads as a clear win or a
   * clear loss rather than a slight one. Sits between `marginDeadzone` and 1,
   * and is the upper boundary of the verdict distribution's middle buckets.
   */
  verdictClearMargin: number;
  /** Below this absolute age lean, buys-young versus buys-production is noise. */
  ageLeanDeadzone: number;
  /** Lineup efficiency at or above which the lineup is called good. */
  lineupGood: number;
  /** Lineup efficiency at or below which points are being left on the bench. */
  lineupPoor: number;
  /** Rounds ahead of market before a reach is worth naming as a pattern. */
  draftEarlyRounds: number;
  /** Points-against rank (0 worst, 1 best) below which the schedule was unkind. */
  unluckyPointsAgainstMax: number;
  /** Points-for band that reads as middle of the table rather than good or bad. */
  unluckyPointsForMin: number;
  unluckyPointsForMax: number;
};

export type ManagerPulseSettings = {
  capture: ManagerPulseCaptureSettings;
  lookup: ManagerPulseLookupSettings;
  samples: ManagerPulseSampleSettings;
  draft: ManagerPulseDraftSettings;
  display: ManagerPulseDisplaySettings;
  tendency: ManagerPulseTendencySettings;
  behaviour: ManagerPulseBehaviourSettings;
  wording: ManagerPulseWordingSettings;
  modelVersion: string;
};

export const DEFAULT_MANAGER_PULSE_SETTINGS: ManagerPulseSettings = {
  capture: {
    seasonWindowDefault: 4,
    seasonWindowMax: 6,
    seasonWindowMin: 1,
    maxLeaguesPerRun: 60,
    maxLeaguesPerSeason: 40,
    runCooldownSeconds: 3600,
    reportTtlHours: 24,
    tendencyTtlHours: 72,
    captureTtlMinutes: 60,
    resumeMaxAgeMinutes: 20,
    jobMaxAttempts: 3,
    includeBestBall: true,
    adminBypassThrottle: true,
  },
  lookup: {
    handleLookupPerMinute: 10,
    handleLookupPerDay: 200,
  },
  samples: {
    minTradesForMargin: 4,
    minTradesForPositionLean: 6,
    minTradesForAgeLean: 6,
    minOverpaySample: 3,
    minDraftsForReach: 2,
    minAvoidSeasons: 3,
    minAvoidRosterRate: 0.5,
    minSeasonsForTendency: 1,
    minLeagueSeasonsForRate: 3,
  },
  draft: {
    reachRoundsThreshold: 0.75,
    earlyRoundCutoff: 3,
  },
  display: {
    favouritesShown: 12,
    avoidsShown: 8,
    tradesShown: 20,
    leagueRowsShown: 50,
    narrativeSentencesMax: 6,
    repeatDraftsShown: 15,
    pickRoundsShown: 6,
  },
  tendency: {
    bandStepMax: 1,
    confidenceLowMax: 5,
    confidenceMediumMax: 15,
    enabledForTradeIdeas: true,
  },
  behaviour: {
    moveShapeMinMoves: 6,
    moveShapeFrontLoaded: 0.65,
    moveShapeFaded: 0.35,
    abandonmentQuietWeeks: 4,
  },
  wording: {
    tradesOftenPerSeason: 3,
    tradesRarePerSeason: 0.5,
    marginDeadzone: 0.02,
    verdictClearMargin: 0.15,
    ageLeanDeadzone: 0.05,
    lineupGood: 0.93,
    lineupPoor: 0.85,
    draftEarlyRounds: 0.3,
    unluckyPointsAgainstMax: 0.15,
    unluckyPointsForMin: 0.35,
    unluckyPointsForMax: 0.65,
  },
  // mp-2: the verdict distribution became six fixed buckets rather than a
  // count of Signal Check's verdict sentences, the repeat-draft list is
  // capped, and the draft pace is a median rather than a mean. A report stored
  // under mp-1 holds a verdictDistribution keyed on sentences, which the new
  // card cannot read, so every one of them has to rescore rather than be
  // rendered as an empty distribution.
  // mp-4: the pick flow's round list is capped at display.pickRoundsShown with
  // the tail combined, so an mp-3 payload holds rows the chart now labels
  // differently.
  // mp-3: trading gained a pick flow (direction and round, not one count) and
  // a bargains list beside the overpays, and the overpay rows now carry which
  // grouping and which position produced them. A report stored under mp-2 has
  // none of those fields, so it has to rescore rather than render half a card.
  modelVersion: "mp-4",
};

/**
 * The numeric bounds for every setting, in one place. The zod schema in
 * validate.ts and the /admin/manager-pulse form both read this object rather
 * than restating the numbers, so server validation and the form's min/max
 * input attributes cannot drift apart. Booleans and modelVersion have no
 * numeric bound and are validated by their own type/regex in validate.ts.
 */
export const MANAGER_PULSE_SETTING_BOUNDS = {
  capture: {
    seasonWindowDefault: { min: 1, max: 10 },
    seasonWindowMax: { min: 1, max: 10 },
    seasonWindowMin: { min: 1, max: 10 },
    maxLeaguesPerRun: { min: 1, max: 500 },
    maxLeaguesPerSeason: { min: 1, max: 200 },
    runCooldownSeconds: { min: 0, max: 86400 },
    reportTtlHours: { min: 1, max: 168 },
    tendencyTtlHours: { min: 1, max: 336 },
    captureTtlMinutes: { min: 1, max: 1440 },
    resumeMaxAgeMinutes: { min: 1, max: 240 },
    jobMaxAttempts: { min: 1, max: 10 },
  },
  lookup: {
    handleLookupPerMinute: { min: 1, max: 120 },
    handleLookupPerDay: { min: 1, max: 5000 },
  },
  samples: {
    minTradesForMargin: { min: 1, max: 100 },
    minTradesForPositionLean: { min: 1, max: 100 },
    minTradesForAgeLean: { min: 1, max: 100 },
    minOverpaySample: { min: 1, max: 50 },
    minDraftsForReach: { min: 1, max: 50 },
    minAvoidSeasons: { min: 1, max: 20 },
    minAvoidRosterRate: { min: 0, max: 1 },
    minSeasonsForTendency: { min: 1, max: 20 },
    minLeagueSeasonsForRate: { min: 1, max: 50 },
  },
  draft: {
    reachRoundsThreshold: { min: 0, max: 5 },
    earlyRoundCutoff: { min: 1, max: 10 },
  },
  display: {
    favouritesShown: { min: 1, max: 50 },
    avoidsShown: { min: 1, max: 50 },
    tradesShown: { min: 1, max: 100 },
    leagueRowsShown: { min: 1, max: 500 },
    narrativeSentencesMax: { min: 1, max: 20 },
    repeatDraftsShown: { min: 1, max: 200 },
    pickRoundsShown: { min: 1, max: 40 },
  },
  tendency: {
    bandStepMax: { min: 0, max: 5 },
    confidenceLowMax: { min: 1, max: 100 },
    confidenceMediumMax: { min: 1, max: 200 },
  },
  behaviour: {
    moveShapeMinMoves: { min: 1, max: 200 },
    moveShapeFrontLoaded: { min: 0.5, max: 1 },
    moveShapeFaded: { min: 0, max: 0.5 },
    abandonmentQuietWeeks: { min: 1, max: 18 },
  },
  wording: {
    tradesOftenPerSeason: { min: 0.1, max: 50 },
    tradesRarePerSeason: { min: 0, max: 10 },
    marginDeadzone: { min: 0, max: 0.5 },
    verdictClearMargin: { min: 0, max: 1 },
    ageLeanDeadzone: { min: 0, max: 1 },
    lineupGood: { min: 0.5, max: 1 },
    lineupPoor: { min: 0, max: 1 },
    draftEarlyRounds: { min: 0, max: 5 },
    unluckyPointsAgainstMax: { min: 0, max: 1 },
    unluckyPointsForMin: { min: 0, max: 1 },
    unluckyPointsForMax: { min: 0, max: 1 },
  },
  modelVersion: { minLength: 1, maxLength: 32 },
} as const;

/**
 * Merge one group object over its default, field by field. A field missing
 * from the stored group keeps its default. A field present but of the wrong
 * JavaScript type is ignored, so a corrupt admin save cannot hand the engine a
 * string where it expects a number. A key not present on the default (an
 * unknown key) is never copied over, since the loop only ever visits the
 * default's own keys.
 */
function mergeGroup<T extends Record<string, unknown>>(fallback: T, stored: unknown): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...fallback };
  }
  const s = stored as Record<string, unknown>;
  const out = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof T>) {
    const value = s[key as string];
    if (value === undefined) continue;
    if (typeof value === typeof fallback[key]) {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

/**
 * Deep-merge a stored settings row over the code defaults. A missing row, a
 * corrupt row, or a row that is not an object all degrade to the defaults
 * rather than throwing: the model is tuning, not correctness, and a lookup
 * must never fail because an admin has not saved settings yet.
 */
export function mergeManagerPulseSettings(stored: unknown): ManagerPulseSettings {
  const base = DEFAULT_MANAGER_PULSE_SETTINGS;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  const s = stored as Record<string, unknown>;

  const modelVersion =
    typeof s.modelVersion === "string" && s.modelVersion.trim().length > 0
      ? s.modelVersion
      : base.modelVersion;

  return {
    capture: mergeGroup(base.capture, s.capture),
    lookup: mergeGroup(base.lookup, s.lookup),
    samples: mergeGroup(base.samples, s.samples),
    draft: mergeGroup(base.draft, s.draft),
    display: mergeGroup(base.display, s.display),
    tendency: mergeGroup(base.tendency, s.tendency),
    behaviour: mergeGroup(base.behaviour, s.behaviour),
    wording: mergeGroup(base.wording, s.wording),
    modelVersion,
  };
}
