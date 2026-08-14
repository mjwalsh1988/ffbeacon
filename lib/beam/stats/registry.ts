/**
 * Every statistic BEAM can look up, and every way a person might name it.
 *
 * This is a CLOSED registry, and that is the security property the whole stat
 * path rests on. A phrase in a question maps to a stat id; the stat id maps to a
 * column name that is written here in this file. There is no path from user text
 * to a column identifier, so no amount of creative typing can reach a column,
 * table, or ordering we did not choose.
 *
 * SHAPE. Each stat is either:
 *   - `sum`: add the column across the weeks in the season (yards, TDs, targets)
 *   - `ratio`: divide one summed column by another (yards per carry, catch rate)
 *   - `derived`: a small expression over several sums (total yards, games)
 * Aggregation happens over weekly rows because player_stats is weekly; there is
 * no season-total table to read instead.
 *
 * POSITIONS. Every stat declares which positions it makes sense for. Asking for
 * a defense's targets returns "we do not track that for a defense", not zero. A
 * zero would be a lie in the shape of an answer.
 *
 * RELATIONSHIP TO THE BREAKDOWN. app/tools/beacon-breakdown/stats-data.ts has a
 * similar list for the comparison table. It is not shared: that one is built for
 * a two-column UI and carries `better` and `weekly` flags this has no use for,
 * while this one carries phrasings and position gating that one has no use for.
 * The COLUMN NAMES are the shared contract, and both read the same table.
 */

export const BEAM_STAT_IDS = [
  // Fantasy
  "fantasy_points",
  "fantasy_points_per_game",
  // Passing
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_att",
  "pass_cmp",
  "pass_cmp_pct",
  "pass_ypa",
  "pass_sack",
  "pass_rz_att",
  // Rushing
  "rush_yd",
  "rush_td",
  "rush_att",
  "rush_ypc",
  "rush_rz_att",
  "rush_lng",
  // Receiving
  "rec",
  "rec_yd",
  "rec_td",
  "rec_tgt",
  "rec_catch_pct",
  "rec_ypr",
  "rec_ypt",
  "rec_air_yd",
  "rec_drop",
  // Combined
  "total_td",
  "total_yd",
  "scrimmage_yd",
  // Availability and usage
  "games_played",
  "games_started",
  "snap_pct",
  "fum_lost",
  // Kicking
  "fgm",
  "fga",
  "fg_pct",
  "xpm",
  // Team defense
  "def_sack",
  "def_td",
  "pts_allow",
] as const;

export type BeamStatId = (typeof BEAM_STAT_IDS)[number];

export function isBeamStatId(value: unknown): value is BeamStatId {
  return typeof value === "string" && (BEAM_STAT_IDS as readonly string[]).includes(value);
}

/** The six fantasy positions, in the order they read naturally in copy. */
export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export const ALL_FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

export type StatFormat = "count" | "decimal1" | "percent" | "yards";

export type StatAggregation =
  /** Sum one column over the season. */
  | { kind: "sum"; column: StatColumn }
  /** Sum two columns and divide. Null when the denominator sums to zero. */
  | { kind: "ratio"; numerator: StatColumn; denominator: StatColumn; scale?: number }
  /** Sum several columns and combine them. */
  | { kind: "combine"; columns: StatColumn[]; combine: (values: number[]) => number }
  /** Average a column over the weeks the player actually appeared. */
  | { kind: "avgPerGame"; column: StatColumn }
  /** Max of a column across the season (longest run, and friends). */
  | { kind: "max"; column: StatColumn }
  /** Fantasy points in the reader's scoring. The column is chosen per request. */
  | { kind: "fantasy"; perGame: boolean }
  /** Weeks the player was credited with a game. */
  | { kind: "games" };

/**
 * Columns this module is allowed to read from player_stats. Naming a column that
 * is not in this union is a compile error, which is the point.
 */
export type StatColumn =
  | "pass_yd"
  | "pass_td"
  | "pass_int"
  | "pass_att"
  | "pass_cmp"
  | "pass_sack"
  | "pass_rz_att"
  | "rush_yd"
  | "rush_td"
  | "rush_att"
  | "rush_rz_att"
  | "rush_lng"
  | "rec"
  | "rec_yd"
  | "rec_td"
  | "rec_tgt"
  | "rec_air_yd"
  | "rec_drop"
  | "target_share"
  | "snap_pct"
  | "fum_lost"
  | "gp"
  | "gs"
  | "fgm"
  | "fga"
  | "xpm"
  | "sack"
  | "interceptions"
  | "def_td"
  | "pts_allow";

export type BeamStat = {
  id: BeamStatId;
  /** Sentence-case label used in answers and clarifications. */
  label: string;
  /** Plural noun for "12 touchdowns". Null when the label already reads plural. */
  nounPlural: string | null;
  /** Singular noun for "1 touchdown". */
  nounSingular: string | null;
  /** Group heading, used to build a stat-line answer and the clarify prompts. */
  group: "Fantasy" | "Passing" | "Rushing" | "Receiving" | "Combined" | "Usage" | "Kicking" | "Defense";
  positions: readonly string[];
  /**
   * The positions to prefer when this stat has to help decide WHICH player was
   * meant. Narrower than `positions` on purpose.
   *
   * `positions` answers "can this stat exist for him", and passing yards can
   * exist for a receiver on a trick play, so it is generous. This answers "who
   * was probably being asked about", and someone who says "how many yards did
   * brock throw for" means the quarterback. It is a hint, never a filter: the
   * resolver ignores it when no candidate matches, so a genuine question about a
   * receiver's passing yards still resolves.
   */
  resolutionPositions?: readonly string[];
  aggregation: StatAggregation;
  format: StatFormat;
  /**
   * True when the smaller number is the better one: interceptions thrown,
   * fumbles lost, drops, points allowed.
   *
   * Lives on the registry because two separate places need it and they must
   * agree. A comparison picks the winner from this, and the sentence picks
   * between "had more" and "had fewer" from this. When those were two
   * hand-maintained lists they disagreed about points allowed, and the answer
   * named the right team with the wrong verb.
   */
  lowerIsBetter?: boolean;
  /**
   * How a person might name it, normalized (lower-case, no punctuation). Matched
   * longest-first, so "passing yards" wins over "yards".
   */
  phrasings: readonly string[];
  /**
   * Verbs that imply this stat when paired with a bare unit word. "threw for"
   * plus "yards" means passing yards even though neither says so alone.
   */
  verbs?: readonly string[];
  /**
   * The bare unit word this stat competes for. Used with `verbs`: a question
   * containing a verb here and the bare unit resolves to this stat.
   */
  bareUnit?: "yards" | "touchdowns" | "attempts" | "catches" | "points";
};

const sum = (column: StatColumn): StatAggregation => ({ kind: "sum", column });

export const BEAM_STATS: readonly BeamStat[] = [
  /* ---------------- Fantasy ---------------- */
  {
    id: "fantasy_points",
    label: "Fantasy points",
    nounPlural: "fantasy points",
    nounSingular: "fantasy point",
    group: "Fantasy",
    positions: ALL_FANTASY_POSITIONS,
    aggregation: { kind: "fantasy", perGame: false },
    format: "decimal1",
    phrasings: [
      "fantasy points",
      "fantasy point",
      "fantasy pts",
      "ff points",
      "points scored",
      "total fantasy points",
      "ppr points",
      "half ppr points",
      "standard points",
      "fantasy production",
      // On a fantasy site, a bare "points" means fantasy points. The longer
      // "points allowed" phrase still wins for a defense, because the matcher
      // takes the longest phrase first.
      "points",
      "pts",
    ],
    bareUnit: "points",
  },
  {
    id: "fantasy_points_per_game",
    label: "Fantasy points per game",
    nounPlural: "fantasy points per game",
    nounSingular: "fantasy point per game",
    group: "Fantasy",
    positions: ALL_FANTASY_POSITIONS,
    aggregation: { kind: "fantasy", perGame: true },
    format: "decimal1",
    phrasings: [
      "fantasy points per game",
      "points per game",
      "ppg",
      "fantasy ppg",
      "fantasy points a game",
      "points a game",
    ],
  },

  /* ---------------- Passing ---------------- */
  {
    id: "pass_yd",
    label: "Passing yards",
    nounPlural: "passing yards",
    nounSingular: "passing yard",
    group: "Passing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["QB"],
    aggregation: sum("pass_yd"),
    format: "yards",
    phrasings: [
      "passing yards",
      "passing yard",
      "pass yards",
      "pass yard",
      "passing yds",
      "pass yds",
      "yards passing",
      "yds passing",
      "throwing yards",
      "air yards passing",
      "py",
    ],
    // The bare forms matter as much as the "for" ones. "How many interceptions
    // did Purdy throw in 2025" has no "for" in it, and an unclaimed "throw"
    // does not merely fail to steer: it joins the token run next to the name and
    // the resolver is handed "brock purdy throw".
    verbs: [
      "threw for",
      "throw for",
      "thrown for",
      "throws for",
      "tossed for",
      "toss for",
      "passed for",
      "pass for",
      "threw",
      "throw",
      "throws",
      "thrown",
    ],
    bareUnit: "yards",
  },
  {
    id: "pass_td",
    label: "Passing touchdowns",
    nounPlural: "passing touchdowns",
    nounSingular: "passing touchdown",
    group: "Passing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["QB"],
    aggregation: sum("pass_td"),
    format: "count",
    phrasings: [
      "passing touchdowns",
      "passing touchdown",
      "passing tds",
      "passing td",
      "pass tds",
      "pass td",
      "touchdown passes",
      "touchdown pass",
      "td passes",
      "tds passing",
      "throwing touchdowns",
    ],
    verbs: [
      "threw for",
      "throw for",
      "thrown for",
      "throws for",
      "passed for",
      "pass for",
      "threw",
      "throw",
      "throws",
      "thrown",
    ],
    bareUnit: "touchdowns",
  },
  {
    id: "pass_int",
    label: "Interceptions thrown",
    nounPlural: "interceptions",
    nounSingular: "interception",
    group: "Passing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["QB"],
    aggregation: sum("pass_int"),
    format: "count",
    lowerIsBetter: true,
    phrasings: [
      "interceptions thrown",
      "interception thrown",
      "interceptions",
      "interception",
      "ints",
      "int",
      "picks",
      // The singular "pick" is deliberately absent. Nobody asks "how many pick
      // did he throw", but plenty of people ask "who should I pick", and the
      // stat vocabulary is claimed before question heads are, so keeping it here
      // turned every draft question into a question about interceptions.
      "picks thrown",
      "turnovers through the air",
    ],
  },
  {
    id: "pass_att",
    label: "Pass attempts",
    nounPlural: "pass attempts",
    nounSingular: "pass attempt",
    group: "Passing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["QB"],
    aggregation: sum("pass_att"),
    format: "count",
    phrasings: [
      "pass attempts",
      "pass attempt",
      "passing attempts",
      "passing attempt",
      "passes attempted",
      "throws",
      "dropbacks",
      "pass att",
    ],
  },
  {
    id: "pass_cmp",
    label: "Completions",
    nounPlural: "completions",
    nounSingular: "completion",
    group: "Passing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["QB"],
    aggregation: sum("pass_cmp"),
    format: "count",
    phrasings: ["completions", "completion", "passes completed", "completed passes", "cmp"],
  },
  {
    id: "pass_cmp_pct",
    label: "Completion percentage",
    nounPlural: null,
    nounSingular: null,
    group: "Passing",
    positions: ["QB"],
    aggregation: { kind: "ratio", numerator: "pass_cmp", denominator: "pass_att", scale: 100 },
    format: "percent",
    phrasings: [
      "completion percentage",
      "completion pct",
      "completion rate",
      "completion percent",
      "comp pct",
      "cmp pct",
    ],
  },
  {
    id: "pass_ypa",
    label: "Yards per attempt",
    nounPlural: null,
    nounSingular: null,
    group: "Passing",
    positions: ["QB"],
    aggregation: { kind: "ratio", numerator: "pass_yd", denominator: "pass_att" },
    format: "decimal1",
    phrasings: [
      "yards per attempt",
      "yards per pass attempt",
      "yards an attempt",
      "ypa",
      "yds per attempt",
    ],
  },
  {
    id: "pass_sack",
    label: "Times sacked",
    nounPlural: "sacks taken",
    nounSingular: "sack taken",
    group: "Passing",
    positions: ["QB"],
    aggregation: sum("pass_sack"),
    format: "count",
    lowerIsBetter: true,
    phrasings: ["times sacked", "sacks taken", "sacked", "sacks against him", "times he was sacked"],
  },
  {
    id: "pass_rz_att",
    label: "Red zone pass attempts",
    nounPlural: "red zone pass attempts",
    nounSingular: "red zone pass attempt",
    group: "Passing",
    positions: ["QB"],
    aggregation: sum("pass_rz_att"),
    format: "count",
    phrasings: [
      "red zone pass attempts",
      "red zone passes",
      "redzone pass attempts",
      "red zone throws",
    ],
  },

  /* ---------------- Rushing ---------------- */
  {
    id: "rush_yd",
    label: "Rushing yards",
    nounPlural: "rushing yards",
    nounSingular: "rushing yard",
    group: "Rushing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["RB", "QB", "WR"],
    aggregation: sum("rush_yd"),
    format: "yards",
    phrasings: [
      "rushing yards",
      "rushing yard",
      "rush yards",
      "rush yard",
      "rushing yds",
      "rush yds",
      "yards rushing",
      "yds rushing",
      "ground yards",
      "yards on the ground",
    ],
    // "run" and "runs" are deliberately absent from the bare forms: the lens
    // phrase "long run" is claimed two passes later, and a verb that ate "run"
    // would leave "long" behind as a one-word player name.
    verbs: ["rushed for", "rush for", "ran for", "run for", "runs for", "ran", "rushed"],
    bareUnit: "yards",
  },
  {
    id: "rush_td",
    label: "Rushing touchdowns",
    nounPlural: "rushing touchdowns",
    nounSingular: "rushing touchdown",
    group: "Rushing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["RB", "QB", "WR"],
    aggregation: sum("rush_td"),
    format: "count",
    phrasings: [
      "rushing touchdowns",
      "rushing touchdown",
      "rushing tds",
      "rushing td",
      "rush tds",
      "rush td",
      "tds rushing",
      "ground touchdowns",
    ],
    // "run" and "runs" are deliberately absent from the bare forms: the lens
    // phrase "long run" is claimed two passes later, and a verb that ate "run"
    // would leave "long" behind as a one-word player name.
    verbs: ["rushed for", "rush for", "ran for", "run for", "runs for", "ran", "rushed"],
    bareUnit: "touchdowns",
  },
  {
    id: "rush_att",
    label: "Carries",
    nounPlural: "carries",
    nounSingular: "carry",
    group: "Rushing",
    positions: ["QB", "RB", "WR", "TE"],
    resolutionPositions: ["RB", "QB"],
    aggregation: sum("rush_att"),
    format: "count",
    phrasings: [
      "carries",
      "carry",
      "rushing attempts",
      "rushing attempt",
      "rush attempts",
      "rush attempt",
      "rushes",
      "totes",
      "touches on the ground",
    ],
  },
  {
    id: "rush_ypc",
    label: "Yards per carry",
    nounPlural: null,
    nounSingular: null,
    group: "Rushing",
    positions: ["QB", "RB", "WR", "TE"],
    aggregation: { kind: "ratio", numerator: "rush_yd", denominator: "rush_att" },
    format: "decimal1",
    phrasings: [
      "yards per carry",
      "yards a carry",
      "ypc",
      "yards per rush",
      "yards per rushing attempt",
    ],
  },
  {
    id: "rush_rz_att",
    label: "Red zone carries",
    nounPlural: "red zone carries",
    nounSingular: "red zone carry",
    group: "Rushing",
    positions: ["QB", "RB", "WR", "TE"],
    aggregation: sum("rush_rz_att"),
    format: "count",
    phrasings: ["red zone carries", "redzone carries", "red zone rushes", "red zone attempts"],
  },
  {
    id: "rush_lng",
    label: "Longest run",
    nounPlural: null,
    nounSingular: null,
    group: "Rushing",
    positions: ["QB", "RB", "WR", "TE"],
    aggregation: { kind: "max", column: "rush_lng" },
    format: "yards",
    phrasings: ["longest run", "longest rush", "long run", "biggest run"],
  },

  /* ---------------- Receiving ---------------- */
  {
    id: "rec",
    label: "Receptions",
    nounPlural: "receptions",
    nounSingular: "reception",
    group: "Receiving",
    positions: ["RB", "WR", "TE", "QB"],
    resolutionPositions: ["WR", "TE", "RB"],
    aggregation: sum("rec"),
    format: "count",
    phrasings: [
      "receptions",
      "reception",
      "catches",
      "catch",
      "balls caught",
      "passes caught",
      "recs",
    ],
    verbs: ["caught", "catch", "catches", "hauled in"],
    bareUnit: "catches",
  },
  {
    id: "rec_yd",
    label: "Receiving yards",
    nounPlural: "receiving yards",
    nounSingular: "receiving yard",
    group: "Receiving",
    positions: ["RB", "WR", "TE", "QB"],
    resolutionPositions: ["WR", "TE", "RB"],
    aggregation: sum("rec_yd"),
    format: "yards",
    phrasings: [
      "receiving yards",
      "receiving yard",
      "rec yards",
      "rec yard",
      "receiving yds",
      "rec yds",
      "yards receiving",
      "yds receiving",
      "catch yards",
    ],
    verbs: ["caught", "catch", "catches", "hauled in", "receiving"],
    bareUnit: "yards",
  },
  {
    id: "rec_td",
    label: "Receiving touchdowns",
    nounPlural: "receiving touchdowns",
    nounSingular: "receiving touchdown",
    group: "Receiving",
    positions: ["RB", "WR", "TE", "QB"],
    resolutionPositions: ["WR", "TE", "RB"],
    aggregation: sum("rec_td"),
    format: "count",
    phrasings: [
      "receiving touchdowns",
      "receiving touchdown",
      "receiving tds",
      "receiving td",
      "rec tds",
      "rec td",
      "touchdown catches",
      "touchdown receptions",
      "tds receiving",
    ],
    verbs: ["caught", "catch", "catches", "hauled in"],
    bareUnit: "touchdowns",
  },
  {
    id: "rec_tgt",
    label: "Targets",
    nounPlural: "targets",
    nounSingular: "target",
    group: "Receiving",
    positions: ["RB", "WR", "TE", "QB"],
    resolutionPositions: ["WR", "TE", "RB"],
    aggregation: sum("rec_tgt"),
    format: "count",
    phrasings: ["targets", "target", "times targeted", "looks", "tgts", "balls thrown his way"],
    // "See" is the verb people use for targets, and this capability advertises
    // "How many targets did CeeDee Lamb see?" as an example. Unclaimed, "see"
    // joined the name span and the resolver was handed "ceedee lamb see".
    verbs: ["see", "sees", "saw", "seen"],
  },
  {
    id: "rec_catch_pct",
    label: "Catch rate",
    nounPlural: null,
    nounSingular: null,
    group: "Receiving",
    positions: ["RB", "WR", "TE"],
    aggregation: { kind: "ratio", numerator: "rec", denominator: "rec_tgt", scale: 100 },
    format: "percent",
    phrasings: ["catch rate", "catch percentage", "catch pct", "catch percent", "reception rate"],
  },
  {
    id: "rec_ypr",
    label: "Yards per catch",
    nounPlural: null,
    nounSingular: null,
    group: "Receiving",
    positions: ["RB", "WR", "TE"],
    aggregation: { kind: "ratio", numerator: "rec_yd", denominator: "rec" },
    format: "decimal1",
    phrasings: ["yards per catch", "yards per reception", "yards a catch", "ypr", "ypc receiving"],
  },
  {
    id: "rec_ypt",
    label: "Yards per target",
    nounPlural: null,
    nounSingular: null,
    group: "Receiving",
    positions: ["RB", "WR", "TE"],
    aggregation: { kind: "ratio", numerator: "rec_yd", denominator: "rec_tgt" },
    format: "decimal1",
    phrasings: ["yards per target", "yards a target", "ypt"],
  },
  {
    id: "rec_air_yd",
    label: "Air yards",
    nounPlural: "air yards",
    nounSingular: "air yard",
    group: "Receiving",
    positions: ["RB", "WR", "TE"],
    aggregation: sum("rec_air_yd"),
    format: "yards",
    phrasings: ["air yards", "air yard", "intended air yards"],
  },
  {
    id: "rec_drop",
    label: "Drops",
    nounPlural: "drops",
    nounSingular: "drop",
    group: "Receiving",
    positions: ["RB", "WR", "TE"],
    aggregation: sum("rec_drop"),
    format: "count",
    lowerIsBetter: true,
    phrasings: ["drops", "drop", "dropped passes", "passes dropped"],
  },

  /* ---------------- Combined ---------------- */
  {
    id: "total_td",
    label: "Total touchdowns",
    nounPlural: "touchdowns",
    nounSingular: "touchdown",
    group: "Combined",
    positions: ["QB", "RB", "WR", "TE"],
    aggregation: {
      kind: "combine",
      columns: ["pass_td", "rush_td", "rec_td"],
      combine: (v) => v[0] + v[1] + v[2],
    },
    format: "count",
    phrasings: [
      "total touchdowns",
      "total tds",
      "touchdowns",
      "touchdown",
      "tds",
      "td",
      "scores",
      "trips to the end zone",
      "all purpose touchdowns",
    ],
    // "how many touchdowns did Gibbs SCORE last year" has no stat phrase beyond
    // the bare unit; without these verbs the trailing "score" is unclaimed and
    // gets swallowed into the player name span, which then resolves to nobody.
    verbs: ["score", "scored", "scores", "put up", "found the end zone", "rack up", "racked up"],
    bareUnit: "touchdowns",
  },
  {
    id: "total_yd",
    label: "Total yards",
    nounPlural: "total yards",
    nounSingular: "total yard",
    group: "Combined",
    positions: ["QB", "RB", "WR", "TE"],
    aggregation: {
      kind: "combine",
      columns: ["pass_yd", "rush_yd", "rec_yd"],
      combine: (v) => v[0] + v[1] + v[2],
    },
    format: "yards",
    phrasings: ["total yards", "all purpose yards", "combined yards", "yards", "yds", "yardage"],
  },
  {
    id: "scrimmage_yd",
    label: "Yards from scrimmage",
    nounPlural: "yards from scrimmage",
    nounSingular: "yard from scrimmage",
    group: "Combined",
    positions: ["RB", "WR", "TE"],
    aggregation: {
      kind: "combine",
      columns: ["rush_yd", "rec_yd"],
      combine: (v) => v[0] + v[1],
    },
    format: "yards",
    phrasings: [
      "yards from scrimmage",
      "scrimmage yards",
      "yards from the line of scrimmage",
    ],
  },

  /* ---------------- Usage ---------------- */
  {
    id: "games_played",
    label: "Games played",
    nounPlural: "games",
    nounSingular: "game",
    group: "Usage",
    positions: ALL_FANTASY_POSITIONS,
    aggregation: { kind: "games" },
    format: "count",
    phrasings: ["games played", "games", "game", "appearances", "how many games"],
  },
  {
    id: "games_started",
    label: "Games started",
    nounPlural: "starts",
    nounSingular: "start",
    group: "Usage",
    positions: ALL_FANTASY_POSITIONS,
    aggregation: sum("gs"),
    format: "count",
    phrasings: ["games started", "starts", "times he started"],
  },
  {
    id: "snap_pct",
    label: "Snap share",
    nounPlural: null,
    nounSingular: null,
    group: "Usage",
    positions: SKILL_POSITIONS,
    aggregation: { kind: "avgPerGame", column: "snap_pct" },
    format: "percent",
    phrasings: ["snap share", "snap percentage", "snap pct", "snap count percentage", "snaps played"],
  },
  {
    id: "fum_lost",
    label: "Fumbles lost",
    nounPlural: "fumbles lost",
    nounSingular: "fumble lost",
    group: "Usage",
    positions: SKILL_POSITIONS,
    aggregation: sum("fum_lost"),
    format: "count",
    lowerIsBetter: true,
    phrasings: ["fumbles lost", "fumbles", "fumble", "lost fumbles", "coughed it up"],
  },

  /* ---------------- Kicking ---------------- */
  {
    id: "fgm",
    label: "Field goals made",
    nounPlural: "field goals",
    nounSingular: "field goal",
    group: "Kicking",
    positions: ["K"],
    aggregation: sum("fgm"),
    format: "count",
    phrasings: ["field goals made", "field goals", "field goal", "fgs made", "fgm", "made field goals"],
  },
  {
    id: "fga",
    label: "Field goals attempted",
    nounPlural: "field goal attempts",
    nounSingular: "field goal attempt",
    group: "Kicking",
    positions: ["K"],
    aggregation: sum("fga"),
    format: "count",
    phrasings: ["field goals attempted", "field goal attempts", "fga", "kicks attempted"],
  },
  {
    id: "fg_pct",
    label: "Field goal percentage",
    nounPlural: null,
    nounSingular: null,
    group: "Kicking",
    positions: ["K"],
    aggregation: { kind: "ratio", numerator: "fgm", denominator: "fga", scale: 100 },
    format: "percent",
    phrasings: ["field goal percentage", "field goal pct", "fg pct", "kicking accuracy"],
  },
  {
    id: "xpm",
    label: "Extra points made",
    nounPlural: "extra points",
    nounSingular: "extra point",
    group: "Kicking",
    positions: ["K"],
    aggregation: sum("xpm"),
    format: "count",
    phrasings: ["extra points made", "extra points", "extra point", "pats", "xpm"],
  },

  /* ---------------- Team defense ---------------- */
  {
    id: "def_sack",
    label: "Sacks",
    nounPlural: "sacks",
    nounSingular: "sack",
    group: "Defense",
    positions: ["DEF"],
    aggregation: sum("sack"),
    format: "decimal1",
    phrasings: ["sacks", "sack", "quarterback sacks", "qb sacks"],
  },
  {
    id: "def_td",
    label: "Defensive touchdowns",
    nounPlural: "defensive touchdowns",
    nounSingular: "defensive touchdown",
    group: "Defense",
    positions: ["DEF"],
    aggregation: sum("def_td"),
    format: "count",
    phrasings: ["defensive touchdowns", "defensive tds", "def tds", "scoop and scores"],
  },
  {
    id: "pts_allow",
    label: "Points allowed",
    nounPlural: "points allowed",
    nounSingular: "point allowed",
    group: "Defense",
    positions: ["DEF"],
    aggregation: sum("pts_allow"),
    format: "count",
    lowerIsBetter: true,
    phrasings: ["points allowed", "points given up", "points against"],
    // "How many points did the Broncos allow" splits the phrase across the
    // sentence, so the bare "points" plus this verb is what recovers it.
    verbs: ["allow", "allowed", "gave up", "give up", "given up"],
    bareUnit: "points",
  },
];

const BY_ID = new Map<BeamStatId, BeamStat>(BEAM_STATS.map((s) => [s.id, s]));

export function getStat(id: BeamStatId): BeamStat {
  const stat = BY_ID.get(id);
  if (!stat) throw new Error(`Unknown BEAM stat id: ${id}`);
  return stat;
}

export function statSupportsPosition(stat: BeamStat, position: string | null): boolean {
  if (!position) return true;
  return stat.positions.includes(position.toUpperCase());
}

/**
 * Some words mean different statistics depending on who was asked about.
 *
 * "Interceptions" is the clearest case: for a quarterback it is a turnover he
 * threw, and for a team defense it is a takeaway they earned. Same word,
 * opposite meaning, and the phrase matcher can only hold one owner per phrase.
 *
 * Rather than mangle the vocabulary to keep the phrases unique (which would mean
 * refusing to answer "how many interceptions did the Ravens have"), the phrase
 * resolves to the skill-position reading and this function swaps it once the
 * player is known. Nothing else in the pipeline needs to know the ambiguity
 * exists.
 */
const POSITION_SWAPS: ReadonlyArray<{
  from: BeamStatId;
  position: string;
  to: BeamStatId;
}> = [
  // pass_int has no DEF counterpart we hold data for: player_stats.interceptions
  // is 0 on every team-defense row, so def_int was removed rather than ship a
  // stat that always answers zero.
  { from: "total_td", position: "DEF", to: "def_td" },
];

export function statForPosition(statId: BeamStatId, position: string | null): BeamStatId {
  if (!position) return statId;
  const pos = position.toUpperCase();
  const swap = POSITION_SWAPS.find((s) => s.from === statId && s.position === pos);
  return swap ? swap.to : statId;
}

/**
 * The stats worth showing in a whole-season line for a position, in reading
 * order. Mirrors what the player profile shows per position so a BEAM stat line
 * and the profile's stats tab never disagree about what matters for a receiver.
 */
export function statLineFor(position: string | null): BeamStat[] {
  const pos = (position ?? "").toUpperCase();
  const ids: BeamStatId[] =
    pos === "QB"
      ? ["games_played", "pass_yd", "pass_td", "pass_int", "pass_cmp_pct", "rush_yd", "rush_td", "fantasy_points", "fantasy_points_per_game"]
      : pos === "RB"
        ? ["games_played", "rush_att", "rush_yd", "rush_td", "rush_ypc", "rec", "rec_yd", "rec_td", "fantasy_points", "fantasy_points_per_game"]
        : pos === "WR" || pos === "TE"
          ? ["games_played", "rec_tgt", "rec", "rec_yd", "rec_td", "rec_ypr", "fantasy_points", "fantasy_points_per_game"]
          : pos === "K"
            ? ["games_played", "fgm", "fga", "fg_pct", "xpm", "fantasy_points"]
            : pos === "DEF"
              ? ["games_played", "def_sack", "def_td", "pts_allow", "fantasy_points"]
              : ["games_played", "total_yd", "total_td", "fantasy_points"];
  return ids.map(getStat);
}

/**
 * The "yards" problem. A running back asked about "yards" with no qualifier
 * could mean three different numbers, so the interpreter offers a choice rather
 * than picking. Returns the plausible stats for a bare unit word at a position,
 * or a single-entry list when there is only one sensible reading.
 */
export function bareUnitCandidates(
  unit: NonNullable<BeamStat["bareUnit"]>,
  position: string | null,
): BeamStat[] {
  const pos = (position ?? "").toUpperCase();
  if (unit === "yards") {
    if (pos === "QB") return [getStat("pass_yd"), getStat("rush_yd")];
    if (pos === "RB") return [getStat("rush_yd"), getStat("rec_yd"), getStat("scrimmage_yd")];
    if (pos === "WR" || pos === "TE") return [getStat("rec_yd")];
    return [getStat("total_yd")];
  }
  if (unit === "touchdowns") {
    if (pos === "QB") return [getStat("pass_td"), getStat("rush_td"), getStat("total_td")];
    if (pos === "RB") return [getStat("rush_td"), getStat("rec_td"), getStat("total_td")];
    if (pos === "WR" || pos === "TE") return [getStat("rec_td")];
    return [getStat("total_td")];
  }
  if (unit === "points") {
    // Only one reading unless a verb already steered it to points allowed.
    return [getStat("fantasy_points")];
  }
  if (unit === "catches") return [getStat("rec")];
  if (unit === "attempts") {
    if (pos === "QB") return [getStat("pass_att"), getStat("rush_att")];
    return [getStat("rush_att")];
  }
  return [];
}
