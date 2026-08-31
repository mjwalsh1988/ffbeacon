/**
 * The two marks that sit beside a player's name on a roster.
 *
 * Rosters render in two places that share no code: the League Pulse team card
 * (components/team-card.tsx, priced from `player_value_trends` for the league's
 * derived format and the reader's chosen source) and the On The Clock draft
 * room (app/tools/on-the-clock/rosters-rankings.tsx, priced from the FF Beacon
 * board). The two surfaces must not disagree about which player is a standout
 * and which is the first one to cut, so the rules and every sentence of the
 * explanatory copy live here and are imported by both.
 *
 * Pure. No I/O, no clock, no React. Each caller resolves value, age, experience
 * and starter status in its own way and hands over plain data.
 *
 * THE TWO MARKS ARE MUTUALLY EXCLUSIVE, AND THAT IS LOAD-BEARING.
 * `dropCandidateIds` refuses to flag anyone who is top of their position, so a
 * row never carries both icons. The UI relies on it: with one badge per row the
 * pointer target can be widened past the icon without two adjacent targets
 * fighting over the same pixels.
 */

/**
 * How deep "top of the position" runs. Fourteen is the starter line: a
 * twelve-team league starts twelve of a position at minimum, and a flex or a
 * superflex slot pushes the real number a little past that. Anyone inside it
 * is somebody's starter every week.
 */
export const TOP_POSITION_RANK = 14;

/** How many cut candidates a roster is allowed to surface. */
export const DROP_CANDIDATE_COUNT = 3;

/**
 * The roster has to be deep enough for "the three worst" to mean anything.
 * Calling three of a four-player roster the weak ones is arithmetic, not a
 * read, and mid-draft it would fire on the third pick of the night.
 */
export const MIN_ELIGIBLE_FOR_DROPS = 6;

/**
 * Dynasty only: nobody this age or younger is ever named a cut. A cheap
 * 23-year-old is the asset a dynasty roster is built to hold, and value alone
 * cannot tell that player apart from a 31-year-old backup carrying the same
 * number.
 */
export const DYNASTY_STASH_MAX_AGE = 23;

/** Dynasty only: first- and second-year players are protected the same way. */
export const DYNASTY_STASH_MAX_EXPERIENCE = 1;

/** What either rule needs to know about one player on a roster. */
export type BadgeCandidate = {
  /** Stable within the roster. Whatever the surface already keys rows on. */
  id: string;
  /**
   * Current value in the surface's own currency. Null when the source has no
   * row for this player, which is NOT the same as worthless: a missing value is
   * missing data, so those players are never named.
   */
  value: number | null;
  /** In the lineup this week. Never named a cut. */
  isStarter: boolean;
  /** Whole years, or null when the birth date is unknown. */
  age: number | null;
  /** Seasons played, or null when unknown. */
  yearsExperience: number | null;
  /** Rank at the player's own position, or null when unranked. */
  positionRank: number | null;
};

/** Inside the top of the position, and therefore starter-grade. */
export function isTopAtPosition(
  positionRank: number | null | undefined,
): boolean {
  return (
    typeof positionRank === "number" &&
    positionRank > 0 &&
    positionRank <= TOP_POSITION_RANK
  );
}

/**
 * A dynasty roster's reason for holding a low-value player: they are young
 * enough that the value is a starting point rather than a verdict. Experience
 * is checked first because it is exact where a birth date can be missing.
 */
export function isDynastyStash(player: BadgeCandidate): boolean {
  if (
    player.yearsExperience != null &&
    player.yearsExperience <= DYNASTY_STASH_MAX_EXPERIENCE
  ) {
    return true;
  }
  return player.age != null && player.age <= DYNASTY_STASH_MAX_AGE;
}

/**
 * Up to three ids: the players on this roster worth cutting first.
 *
 * REDRAFT and DYNASTY genuinely differ, and the difference is age. A redraft
 * roster exists for one season, so the least valuable player is the least
 * useful player and nothing else needs saying. A dynasty roster is holding some
 * of its cheapest players ON PURPOSE, so youth is set aside before the sort and
 * the copy says that out loud.
 *
 * Both start from the same eligible pool: a real value, not in the lineup, and
 * not top of the position. The depth gate is applied to that pool BEFORE the
 * dynasty protection, so a young roster returns fewer than three names rather
 * than none at all.
 */
export function dropCandidateIds(
  players: BadgeCandidate[],
  options: { isDynasty: boolean },
): Set<string> {
  const eligible = players.filter(
    (p) =>
      p.value != null &&
      p.value > 0 &&
      !p.isStarter &&
      !isTopAtPosition(p.positionRank),
  );
  if (eligible.length < MIN_ELIGIBLE_FOR_DROPS) return new Set();

  const pool = options.isDynasty
    ? eligible.filter((p) => !isDynastyStash(p))
    : eligible;

  const ranked = [...pool].sort(
    (a, b) => (a.value ?? 0) - (b.value ?? 0) || a.id.localeCompare(b.id),
  );
  return new Set(ranked.slice(0, DROP_CANDIDATE_COUNT).map((p) => p.id));
}

/**
 * The whole sentence a screen reader hears on the star, and the whole sentence
 * the visual bubble prints. One string for both, so the two can never drift.
 * It carries the player's name because the badge is a control of its own: a
 * reader who lands on it by keyboard has not necessarily just read the row.
 */
export function topBadgeLabel(params: {
  name: string;
  position: string;
  positionRank: number;
}): string {
  return `${params.name} ranks ${params.position}${params.positionRank} in this format, inside the top ${TOP_POSITION_RANK} at the position. That is starting-caliber in a twelve-team league.`;
}

/** The same, for the cut mark. The dynasty rule is stated, not implied. */
export function dropBadgeLabel(params: {
  name: string;
  isDynasty: boolean;
  /** True on a surface that knows a starting lineup, false in a draft room. */
  excludesStarters: boolean;
}): string {
  const where = params.excludesStarters
    ? "on this roster outside the starting lineup"
    : "on this roster";
  const base = `${params.name} is one of the ${DROP_CANDIDATE_COUNT} lowest-valued players ${where}. If you need a roster spot, start here.`;
  if (!params.isDynasty) return base;
  return `${base} Anyone ${DYNASTY_STASH_MAX_AGE} or under, and anyone inside their first two seasons, is left out of this: a dynasty roster holds cheap young players on purpose.`;
}
