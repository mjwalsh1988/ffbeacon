/**
 * Where a team sits on the compete-or-rebuild axis, as one word.
 *
 * Two numbers already exist for every synced team and they answer different
 * questions. Power Pulse says how many games a roster should win from here.
 * The trade-value rank says how much it owns. A team can be high on one and low
 * on the other, and that gap is the whole story:
 *
 *   - Contender: inside the band that should take most of this league's playoff
 *     spots. It wins now, whatever it owns.
 *   - Loaded: still in the playoff picture, but holding a lot more value than
 *     its projected wins reflect. The roster is ahead of the results.
 *   - Bubble: in the pack, with nothing pulling it either way.
 *   - Rebuilder (Longshot in a one-year league): below the playoff picture
 *     entirely, with the season no longer the thing to play for.
 *
 * WHY THE BANDS ARE TIED TO THE PLAYOFF FIELD
 *   They used to be fixed percentiles: the top 35 percent contended and the
 *   bottom 35 percent rebuilt, whatever the league did with its own season. In a
 *   12-team league that made "Contender" mean the top four and nobody else,
 *   which told three teams projected to make a seven-team bracket that they were
 *   not contending. The cut now follows `settings.playoff_teams`: contenders are
 *   most of the playoff field, the bubble runs two places past the cut line, and
 *   everyone below that is rebuilding. A league that takes half its teams gets a
 *   narrow contender band and one that takes nearly everybody gets a wide one,
 *   which is what those two leagues actually mean by "in it".
 *
 * WHY A TEAM IN THE PICTURE IS NEVER A REBUILDER
 *   The value-divergence rule used to hand back "Rebuilder" for any team under
 *   the contender line whose assets outran its wins. It asked nothing about
 *   whether the team was losing. A roster projected to take the fourth seed in a
 *   seven-team bracket came back labelled Rebuilder because its value rank sat
 *   two places above its Pulse rank, and "Rebuilder" in plain English means a
 *   team that is not trying to win this year. Divergence now produces its own
 *   band, and it can only fire while the team is still in the picture.
 *
 * WORDS VERSUS KEYS
 *   `TeamStatusKey` is the logic. It never changes with the league, so sorting,
 *   filtering, and the trade engine all key off it. `variant` only changes the
 *   words: a redraft manager cannot rebuild, because there is nothing to hold
 *   the assets for, so the bottom band reads Longshot there. Keeper leagues take
 *   the dynasty wording, since a keeper roster does carry forward.
 *
 * Pure. No database, no React. The batched read that feeds the league list
 * lives in lib/league-team-status-data.ts.
 */

import { DEFAULT_PLAYOFF_TEAMS } from "@/lib/power-pulse/playoff-defaults";

export type TeamStatusKey = "competitor" | "loaded" | "middle" | "rebuilder";

/**
 * Which vocabulary a league gets. "dynasty" covers keeper leagues too, and is
 * the default everywhere the caller has no league in hand.
 */
export type TeamStatusVariant = "dynasty" | "redraft";

export type TeamStatus = {
  key: TeamStatusKey;
  /** Which vocabulary produced the words below. */
  variant: TeamStatusVariant;
  /** Full label. Used everywhere there is room. */
  label: string;
  /** Short label for tight columns and chips. */
  short: string;
  /**
   * The label in a form that survives an indefinite article, for prose like
   * "they read as a ___". Same word as `label` except for the two bands where
   * "a Bubble" is not a sentence and "a Bubble team" is.
   */
  phrase: string;
  /** One sentence saying why this team landed here. Feeds aria-label and title. */
  reason: string;
};

/**
 * How much of the playoff field counts as contending. Two thirds, rounded, so a
 * seven-team bracket makes the top five contenders and a six-team bracket makes
 * the top four. The teams below that line but inside the bracket are the ones a
 * single bad month removes, which is what "Bubble" is for.
 */
const CONTENDER_SHARE_OF_FIELD = 2 / 3;

/**
 * How far past the playoff cut line the bubble runs. Two places, because a team
 * two out with most of a season left is a run away from the bracket, and the
 * band below this one carries a word ("Rebuilder") that should mean the season
 * is genuinely gone.
 */
const BUBBLE_OVERHANG = 2;

/**
 * How far a team's value percentile has to sit above its Power Pulse percentile
 * before the gap itself is the story. 0.15 of a twelve-team league is a little
 * under two full places, so a team ranked 6th by Pulse needs to be roughly 4th
 * or better by value to read as Loaded rather than as a plain Bubble team.
 */
const DIVERGENCE_GAP = 0.15;

/**
 * The playoff field to assume when Sleeper has not told us.
 *
 * Sleeper writes `playoff_teams: 0`, or omits it, on a league whose bracket has
 * not been set up. Six is Sleeper's own default and it is a FLAT six, not a
 * share of the league.
 *
 * THE NUMBER MUST MATCH the simulation behind the playoff odds and the visible
 * cut line on the Projected standings table, which is why it is imported rather
 * than written down again here. lib/power-pulse/playoff-defaults.ts says what
 * went wrong the one time these disagreed.
 */

type Words = { label: string; short: string; phrase: string };

const LABELS: Record<TeamStatusVariant, Record<TeamStatusKey, Words>> = {
  dynasty: {
    competitor: { label: "Contender", short: "Contend", phrase: "Contender" },
    loaded: { label: "Loaded", short: "Loaded", phrase: "Loaded team" },
    middle: { label: "Bubble", short: "Bubble", phrase: "Bubble team" },
    rebuilder: { label: "Rebuilder", short: "Rebuild", phrase: "Rebuilder" },
  },
  redraft: {
    competitor: { label: "Contender", short: "Contend", phrase: "Contender" },
    // The one band whose word carries across unchanged. Owning more than the
    // projection shows is the same fact in both formats. What a manager can do
    // about it differs, and that is the figure's job rather than the tag's.
    loaded: { label: "Loaded", short: "Loaded", phrase: "Loaded team" },
    middle: { label: "Bubble", short: "Bubble", phrase: "Bubble team" },
    // Nothing carries over, so there is no rebuild to be in the middle of. What
    // is left is a team that needs the season to break its way.
    rebuilder: { label: "Longshot", short: "Longshot", phrase: "Longshot" },
  },
};

/** The words one band gets in one kind of league. */
export function teamStatusWords(
  key: TeamStatusKey,
  variant: TeamStatusVariant = "dynasty",
): Words {
  return LABELS[variant][key];
}

/** Where the two cut lines fall in one league. */
export type TeamStatusBands = {
  /** Teams in the league. */
  teamCount: number;
  /** The playoff field the bands were drawn from. */
  playoffTeams: number;
  /**
   * True when `playoffTeams` is our assumption rather than the league's own
   * setting, so copy can decline to quote a number we made up.
   */
  playoffTeamsAssumed: boolean;
  /** Ranks 1 through this are Contenders. */
  contenderCeiling: number;
  /**
   * Ranks above the contender ceiling through this one are Bubble or Loaded.
   * Everything past it is a Rebuilder or Longshot.
   */
  bubbleCeiling: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Sleeper's `settings.playoff_teams`, as a real playoff field or nothing.
 *
 * TAKES THE RAW VALUE AND PARSES IT HERE, deliberately, rather than letting
 * callers hand over a `Number(...)` they already coerced. `leagues.metadata`
 * holds whatever Sleeper sent, verbatim, and a commissioner's league object is
 * external input we do not control. A bare `Number()` accepts far more than a
 * setting: `Number(true)` is 1, `Number([5])` is 5, `Number("0x10")` is 16, and
 * every one of those would come back through `playoffTeamsAssumed: false`, which
 * is the flag that licenses the reason string to quote the number to a reader as
 * their own league's setting. Attributing our coercion to a commissioner is a
 * small lie but it is still a lie, and it is on a sentence a screen reader
 * announces.
 *
 * So: a JSON number that is a positive safe integer, or the digit string
 * PostgREST returns when the same value is read through a `->>` path. Nothing
 * else. Everything rejected here falls through to the assumed field, which the
 * copy declines to quote.
 */
function parsePlayoffField(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * The two cut lines for one league, from its own playoff field.
 *
 * `playoffTeams` is Sleeper's `settings.playoff_teams` AS IT ARRIVES, untouched:
 * a JSON number from `leagues.metadata`, the string PostgREST returns from a
 * JSON path, null, zero, a number larger than the league, or something a
 * commissioner's payload had no business containing. All of it is handled here
 * rather than at five call sites, so no surface can apply a different rule.
 *
 * TWO INVARIANTS, AND THE SECOND IS CONDITIONAL ON PURPOSE.
 *
 * No Contender sits outside the playoff field, ever. `contenderCeiling` is
 * capped at `field`, so the top band cannot promise a bracket place the league
 * does not have.
 *
 * A Rebuilder exists only when somebody actually misses the bracket. In a
 * league where `playoff_teams` equals the roster count, EVERY team qualifies,
 * so the bottom band is empty by design and last place reads as Bubble. Forcing
 * last place to be a Rebuilder there produced a sentence that contradicted
 * itself inside one breath, both halves out of this same object: "6th of 6 by
 * Power Pulse in a league that takes 6 to the playoffs, below every team still
 * within range of this league's 6-team playoff field." Three live 6-team
 * leagues are shaped exactly that way.
 *
 * The Bubble band keeps at least one rank wherever the league is big enough to
 * spare one, which is every league above four teams.
 */
export function teamStatusBands({
  teamCount,
  playoffTeams,
}: {
  teamCount: number;
  /** Raw. See parsePlayoffField above for why this is not pre-coerced. */
  playoffTeams?: unknown;
}): TeamStatusBands {
  // Guarded here as well as in classifyTeamStatus, because this is exported and
  // a direct caller with a non-finite count would otherwise get Infinity in
  // `teamCount` and print "of Infinity" to a reader.
  const rawTeams = Number(teamCount);
  const teams = Number.isFinite(rawTeams) ? Math.max(2, Math.floor(rawTeams)) : 2;
  const parsed = parsePlayoffField(playoffTeams);
  const usable = parsed === null ? null : clamp(parsed, 1, teams);
  const field = usable ?? clamp(DEFAULT_PLAYOFF_TEAMS, 1, teams);

  // The lowest rank that can still read as "in it". Normally the second-to-last
  // team, so last place has somewhere to land. When the bracket takes the whole
  // league there is nobody to call a Rebuilder, so it runs to the last rank.
  const lowestInPicture = field >= teams ? teams : teams - 1;

  const contenderCeiling = Math.min(
    // Most of the field, and never more of it than exists.
    clamp(Math.round(field * CONTENDER_SHARE_OF_FIELD), 1, field),
    // Leave the Bubble band a rank of its own wherever there is one to spare.
    Math.max(1, lowestInPicture - 1),
  );

  const bubbleCeiling = clamp(
    field + BUBBLE_OVERHANG,
    Math.min(contenderCeiling + 1, lowestInPicture),
    lowestInPicture,
  );

  return {
    teamCount: teams,
    playoffTeams: field,
    playoffTeamsAssumed: usable === null,
    contenderCeiling,
    bubbleCeiling,
  };
}

/** 1 for the best rank in the league, 0 for the worst. */
function percentile(rank: number, teamCount: number): number {
  if (teamCount <= 1) return 0.5;
  return (teamCount - clamp(rank, 1, teamCount)) / (teamCount - 1);
}

export function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function build(
  key: TeamStatusKey,
  variant: TeamStatusVariant,
  reason: string,
): TeamStatus {
  return { key, variant, ...LABELS[variant][key], reason };
}

/**
 * Classify one team. Returns null when there is no Power Pulse rank to read,
 * which is the "not synced yet" case every surface renders differently.
 *
 * `valueRank` is optional on purpose: a league whose format no source covers
 * still gets a Contender / Bubble / Rebuilder call from Power Pulse alone. It is
 * the one input the Loaded band cannot do without, so a league with no value
 * rows never lands there.
 *
 * `playoffTeams` is Sleeper's own `settings.playoff_teams`, RAW and unparsed.
 * Pass the value straight off `leagues.metadata` or the PostgREST JSON path;
 * teamStatusBands does the parsing, so every surface applies one rule. Leave it
 * out only where the league's settings genuinely are not in hand; the fallback
 * is half the league, which is the most common real setting.
 *
 * `variant` only picks the wording. Every cut line below is the same in a
 * redraft league as in a dynasty one.
 */
export function classifyTeamStatus({
  pulseRank,
  valueRank,
  teamCount,
  playoffTeams,
  variant = "dynasty",
}: {
  pulseRank: number | null | undefined;
  valueRank: number | null | undefined;
  teamCount: number;
  /** Raw. See teamStatusBands. */
  playoffTeams?: unknown;
  variant?: TeamStatusVariant;
}): TeamStatus | null {
  if (pulseRank == null || !Number.isFinite(pulseRank)) return null;
  if (!Number.isFinite(teamCount) || teamCount < 2) return null;

  const bands = teamStatusBands({ teamCount, playoffTeams });
  const rank = clamp(pulseRank, 1, bands.teamCount);

  const pulsePct = percentile(rank, bands.teamCount);
  // Clamped for the same reason `rank` is. It is printed as an ordinal into a
  // sentence a screen reader announces, and an out-of-range rank would render
  // as "1e+308th by value".
  const valueRankInRange =
    valueRank != null && Number.isFinite(valueRank)
      ? clamp(Math.round(valueRank), 1, bands.teamCount)
      : null;
  const valuePct =
    valueRankInRange === null
      ? null
      : percentile(valueRankInRange, bands.teamCount);

  const place = `${ordinal(rank)} of ${bands.teamCount} by Power Pulse`;
  // Only quoted where it is the league's own setting. Quoting the fallback would
  // attribute our assumption to the league.
  const bracket = bands.playoffTeamsAssumed
    ? ""
    : ` in a league that takes ${bands.playoffTeams} to the playoffs`;
  // Deliberately the PLAYOFF FIELD rather than `bubbleCeiling`, which is two
  // places past it. A reader who knows their league takes seven and is told
  // they are below "the 9 teams still in the playoff picture" has been handed a
  // number that contradicts the one they know, with no explanation of the
  // overhang. "Within range" carries the overhang without naming it.
  const outOfRange = bands.playoffTeamsAssumed
    ? "below every team still within range of the playoffs"
    : `below every team still within range of this league's ${bands.playoffTeams}-team playoff field`;
  // Bubble was the one band whose spoken reason never accounted for its own cut
  // line. A reader hearing 5th described as "built to win now" and 6th as "in
  // the pack", in a league that takes 7, got no sentence anywhere explaining the
  // difference. A sighted reader can go and find the legend; on a screen reader
  // that means leaving the row.
  const inRange = bands.playoffTeamsAssumed
    ? "still within range of the playoffs"
    : `still within range of this league's ${bands.playoffTeams}-team playoff field`;
  const byValue =
    valueRankInRange === null ? null : `${ordinal(valueRankInRange)} by value`;

  if (rank <= bands.contenderCeiling) {
    return build(
      "competitor",
      variant,
      `${place}${bracket}, so this roster is built to win now.`,
    );
  }

  if (rank > bands.bubbleCeiling) {
    return build(
      "rebuilder",
      variant,
      byValue
        ? `${place} and ${byValue}, ${outOfRange}.`
        : `${place}, ${outOfRange}.`,
    );
  }

  // Still in the picture, and the roster is worth more than the wins show.
  if (valuePct !== null && byValue && valuePct - pulsePct >= DIVERGENCE_GAP) {
    return build(
      "loaded",
      variant,
      `${place} but ${byValue}, so this roster is worth more than its projected wins show.`,
    );
  }

  return build(
    "middle",
    variant,
    byValue
      ? `${place} and ${byValue}, in the pack on both counts and ${inRange}.`
      : `${place}, in the pack and ${inRange}.`,
  );
}
