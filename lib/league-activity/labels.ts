/**
 * Sleeper's field names, in English.
 *
 * A settings card that reads "waiver_type changed from 2 to 0" is a diff, not a
 * sentence, and the number on either side means nothing to anybody who has not
 * read Sleeper's API. This file turns both halves into words: the key becomes a
 * label, and the value becomes whatever that key's value actually means.
 *
 * WHY A WHITELIST AND NOT A BLACKLIST. Sleeper's league `settings` object
 * carries bookkeeping counters that move on their own, `leg` and
 * `last_scored_leg` among them, and a blacklist would have to be updated every
 * time Sleeper adds one. A key that is not listed here is simply not reported,
 * so the worst case of a new Sleeper field is a missed event rather than a
 * weekly card announcing that an internal counter went up by one.
 *
 * Pure and dependency-free, so both the detector and the renderer can use it.
 */

/* -------------------------------------------------------------------------- */
/* League settings                                                            */
/* -------------------------------------------------------------------------- */

type ValueFormatter = (value: number) => string;

interface SettingSpec {
  label: string;
  format?: ValueFormatter;
}

const onOff: ValueFormatter = (v) => (v ? "On" : "Off");
const offOn: ValueFormatter = (v) => (v ? "Off" : "On");
const weeks: ValueFormatter = (v) => (v === 0 ? "None" : `Week ${v}`);
const dollars: ValueFormatter = (v) => `$${v}`;
const count: ValueFormatter = (v) => String(v);

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/**
 * The settings worth telling a league about.
 *
 * Every one of these changes how the league plays. Anything that only changes
 * how Sleeper's own screens look is deliberately absent.
 */
const LEAGUE_SETTINGS: Record<string, SettingSpec> = {
  type: {
    label: "League type",
    format: (v) => (v === 2 ? "Dynasty" : v === 1 ? "Keeper" : "Redraft"),
  },
  best_ball: { label: "Best ball", format: onOff },
  num_teams: { label: "Teams", format: count },
  playoff_teams: { label: "Playoff teams", format: count },
  playoff_week_start: { label: "Playoffs start", format: weeks },
  playoff_type: {
    label: "Playoff seeding",
    format: (v) => (v === 1 ? "Reseed each round" : "Fixed bracket"),
  },
  playoff_round_type: {
    label: "Playoff round length",
    format: (v) =>
      v === 2 ? "Two weeks per round" : v === 1 ? "Two weeks, final only" : "One week per round",
  },
  playoff_seed_type: {
    label: "Playoff bye order",
    format: (v) => (v === 1 ? "Bye to the lowest seeds" : "Bye to the top seeds"),
  },
  league_average_match: { label: "Weekly game against the league average", format: onOff },
  start_week: { label: "First scoring week", format: (v) => `Week ${v}` },
  divisions: { label: "Divisions", format: count },
  waiver_type: {
    label: "Waiver system",
    format: (v) =>
      v === 2 ? "FAAB bidding" : v === 1 ? "Reverse standings" : "Rolling waiver order",
  },
  waiver_budget: { label: "FAAB budget", format: dollars },
  waiver_clear_days: { label: "Waiver clear time", format: (v) => `${v} day${v === 1 ? "" : "s"}` },
  waiver_day_of_week: {
    label: "Waiver day",
    format: (v) => WEEKDAYS[v] ?? String(v),
  },
  daily_waivers: { label: "Daily waivers", format: onOff },
  daily_waivers_hour: { label: "Daily waiver hour", format: (v) => `${v}:00` },
  waiver_bid_min: { label: "Minimum FAAB bid", format: dollars },
  trade_deadline: { label: "Trade deadline", format: weeks },
  trade_review_days: {
    label: "Trade review window",
    format: (v) => (v === 0 ? "Instant" : `${v} day${v === 1 ? "" : "s"}`),
  },
  disable_trades: { label: "Trading", format: offOn },
  pick_trading: { label: "Draft pick trading", format: onOff },
  veto_votes_needed: { label: "Votes needed to veto", format: count },
  veto_auto_poll: { label: "Automatic veto poll", format: onOff },
  veto_show_votes: { label: "Veto votes visible", format: onOff },
  taxi_slots: { label: "Taxi squad slots", format: count },
  taxi_years: { label: "Taxi squad eligibility", format: (v) => `${v} year${v === 1 ? "" : "s"}` },
  taxi_deadline: { label: "Taxi lock", format: weeks },
  taxi_allow_vets: { label: "Veterans allowed on taxi", format: onOff },
  reserve_slots: { label: "IR slots", format: count },
  reserve_allow_out: { label: "IR accepts Out", format: onOff },
  reserve_allow_doubtful: { label: "IR accepts Doubtful", format: onOff },
  reserve_allow_na: { label: "IR accepts Not Active", format: onOff },
  reserve_allow_sus: { label: "IR accepts Suspended", format: onOff },
  reserve_allow_cov: { label: "IR accepts COVID", format: onOff },
  max_keepers: { label: "Keepers allowed", format: count },
  draft_rounds: { label: "Draft rounds", format: count },
  bench_lock: { label: "Bench locks at kickoff", format: onOff },
  offseason_adds: { label: "Offseason adds", format: onOff },
  capacity_override: { label: "Roster capacity override", format: onOff },
  commissioner_direct_invite: { label: "Commissioner direct invite", format: onOff },
};

/** True when a change to this key is worth a card. */
export function isReportableSetting(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEAGUE_SETTINGS, key);
}

export function settingLabel(key: string): string {
  return LEAGUE_SETTINGS[key]?.label ?? prettifyKey(key);
}

export function settingValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  const spec = LEAGUE_SETTINGS[key];
  const n = typeof value === "number" ? value : Number(value);
  if (spec?.format && Number.isFinite(n)) return spec.format(n);
  return String(value);
}

/* -------------------------------------------------------------------------- */
/* Scoring settings                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Scoring keys, in English.
 *
 * Sleeper publishes well over a hundred of these and a league only ever changes
 * a handful, so the map covers what leagues actually touch and `prettifyKey`
 * handles the tail. Unlike league settings there is no whitelist gate here: a
 * scoring change is always news, whatever the key, because it changes what
 * every player on every roster is worth.
 */
const SCORING_LABELS: Record<string, string> = {
  pass_yd: "Passing yards",
  pass_td: "Passing touchdown",
  pass_int: "Interception thrown",
  pass_2pt: "Passing two point conversion",
  pass_cmp: "Completion",
  pass_inc: "Incompletion",
  pass_att: "Pass attempt",
  pass_sack: "Sack taken",
  pass_cmp_40p: "Completion of 40 or more yards",
  pass_td_40p: "Passing touchdown of 40 or more yards",
  rush_yd: "Rushing yards",
  rush_td: "Rushing touchdown",
  rush_2pt: "Rushing two point conversion",
  rush_att: "Carry",
  rush_40p: "Rush of 40 or more yards",
  rush_td_40p: "Rushing touchdown of 40 or more yards",
  rec: "Reception",
  rec_yd: "Receiving yards",
  rec_td: "Receiving touchdown",
  rec_2pt: "Receiving two point conversion",
  rec_40p: "Reception of 40 or more yards",
  rec_td_40p: "Receiving touchdown of 40 or more yards",
  bonus_rec_te: "Bonus per tight end reception",
  bonus_rec_wr: "Bonus per receiver reception",
  bonus_rec_rb: "Bonus per running back reception",
  bonus_rush_yd_100: "Bonus for 100 rushing yards",
  bonus_rush_yd_200: "Bonus for 200 rushing yards",
  bonus_rec_yd_100: "Bonus for 100 receiving yards",
  bonus_rec_yd_200: "Bonus for 200 receiving yards",
  bonus_pass_yd_300: "Bonus for 300 passing yards",
  bonus_pass_yd_400: "Bonus for 400 passing yards",
  fum: "Fumble",
  fum_lost: "Fumble lost",
  fum_rec: "Fumble recovered",
  fum_rec_td: "Fumble recovery touchdown",
  fgm: "Field goal made",
  fgmiss: "Field goal missed",
  fgm_0_19: "Field goal, 0 to 19 yards",
  fgm_20_29: "Field goal, 20 to 29 yards",
  fgm_30_39: "Field goal, 30 to 39 yards",
  fgm_40_49: "Field goal, 40 to 49 yards",
  fgm_50p: "Field goal, 50 yards or more",
  xpm: "Extra point made",
  xpmiss: "Extra point missed",
  def_td: "Defensive touchdown",
  def_st_td: "Special teams touchdown",
  def_st_ff: "Special teams forced fumble",
  def_st_fum_rec: "Special teams fumble recovery",
  sack: "Sack",
  int: "Interception",
  ff: "Forced fumble",
  safe: "Safety",
  blk_kick: "Blocked kick",
  pts_allow_0: "Shutout",
  pts_allow_1_6: "1 to 6 points allowed",
  pts_allow_7_13: "7 to 13 points allowed",
  pts_allow_14_20: "14 to 20 points allowed",
  pts_allow_21_27: "21 to 27 points allowed",
  pts_allow_28_34: "28 to 34 points allowed",
  pts_allow_35p: "35 or more points allowed",
  yds_allow_0_100: "Under 100 yards allowed",
  yds_allow_100_199: "100 to 199 yards allowed",
  yds_allow_200_299: "200 to 299 yards allowed",
  yds_allow_300_349: "300 to 349 yards allowed",
  yds_allow_350_399: "350 to 399 yards allowed",
  yds_allow_400_449: "400 to 449 yards allowed",
  yds_allow_450_499: "450 to 499 yards allowed",
  yds_allow_500_549: "500 to 549 yards allowed",
  yds_allow_550p: "550 or more yards allowed",
  idp_tkl: "Tackle",
  idp_tkl_solo: "Solo tackle",
  idp_tkl_ast: "Assisted tackle",
  idp_sack: "Defensive sack",
  idp_int: "Defensive interception",
  idp_ff: "Defensive forced fumble",
  idp_fum_rec: "Defensive fumble recovery",
  idp_def_td: "Individual defensive touchdown",
  idp_pass_def: "Pass defended",
  idp_tkl_loss: "Tackle for loss",
  idp_safe: "Defensive safety",
  idp_blk_kick: "Defensive blocked kick",
};

export function scoringLabel(key: string): string {
  return SCORING_LABELS[key] ?? prettifyKey(key);
}

/** Scoring values are points, and the sign matters. "-2" beats "2". */
export function scoringValue(value: unknown): string {
  if (value === null || value === undefined) return "Not scored";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  // Trim the trailing zeros Sleeper sends (0.5 stays 0.5, 4.0 becomes 4).
  const trimmed = Number(n.toFixed(3));
  return trimmed > 0 ? `+${trimmed}` : String(trimmed);
}

/* -------------------------------------------------------------------------- */
/* Roster slots                                                               */
/* -------------------------------------------------------------------------- */

const SLOT_LABELS: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  BN: "Bench",
  IR: "IR",
  TAXI: "Taxi",
  FLEX: "Flex",
  WRRB_FLEX: "W/R flex",
  REC_FLEX: "W/T flex",
  WRRB_WRT: "W/R/T flex",
  SUPER_FLEX: "Superflex",
  IDP_FLEX: "IDP flex",
  DL: "DL",
  LB: "LB",
  DB: "DB",
  DP: "Defensive player",
};

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot;
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

/** "waiver_clear_days" becomes "Waiver clear days". The safety net, not the plan. */
export function prettifyKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Sleeper's league `status`, as a phase a person would recognise. */
export function leagueStatusLabel(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "pre_draft":
      return "Waiting to draft";
    case "drafting":
      return "Drafting";
    case "in_season":
      return "In season";
    case "complete":
      return "Season complete";
    case "post_season":
      return "Postseason";
    default:
      return status ? prettifyKey(status) : "Unknown";
  }
}

/** Sleeper's draft `status`, same idea. */
export function draftStatusLabel(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "pre_draft":
      return "Scheduled";
    case "drafting":
      return "Underway";
    case "paused":
      return "Paused";
    case "complete":
      return "Complete";
    default:
      return status ? prettifyKey(status) : "Unknown";
  }
}

/** "2027 1st", or "2027 1st (1.04)" when the draft order is known. */
export function pickLabel(
  season: number | string,
  round: number,
  slotLabelText?: string | null,
): string {
  const suffix =
    round === 1 ? "1st" : round === 2 ? "2nd" : round === 3 ? "3rd" : `${round}th`;
  const base = `${season} ${suffix}`;
  return slotLabelText ? `${base} (${slotLabelText})` : base;
}
