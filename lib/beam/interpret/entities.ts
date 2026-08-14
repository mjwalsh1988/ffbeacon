/**
 * Pull structured slots out of a normalized question.
 *
 * The strategy is subtractive, and it works because BEAM's vocabulary is closed:
 * run every known vocabulary over the token stream, and whatever nobody claims
 * is a player name. There is no name list to match against at this stage and no
 * need for one; resolving the leftover span to an actual player is the
 * resolver's job, and it is the only part that touches the database.
 *
 * The one piece of real inference here is the verb rule. "how many yards did
 * purdy throw for" contains no stat phrase at all: "yards" alone is ambiguous
 * and "throw for" alone names no unit. Together they mean passing yards. That
 * pairing is why the stat lexicon carries verbs and bare units, and it is what
 * makes the five example phrasings in the plan all land on the same intent.
 */

import {
  BARE_UNITS,
  COMPARATOR_MATCHER,
  CONCEPT_MATCHER,
  FILLER_MATCHER,
  HEAD_MATCHER,
  LENS_MATCHER,
  POSITION_MATCHER,
  SEASON_MATCHER,
  STAT_MATCHER,
  TEAM_MATCHER,
  VERB_MATCHER,
  parseExplicitSeason,
  type ConceptTag,
  type LensToken,
  type SeasonToken,
} from "./lexicon";
import { getStat, type BeamStat, type BeamStatId } from "@/lib/beam/stats/registry";
import { normalizeText } from "./normalize";
import { scanWeekRange, type WeekRange } from "./weeks";
import { scanSeasonSpan, type SeasonSpan } from "./season-span";
import { scanTopN, type TopN } from "./top-n";

export type NameSpan = {
  text: string;
  start: number;
  end: number;
};

export type ExtractedEntities = {
  /** The normalized question the extraction ran against. */
  normalized: string;
  tokens: string[];
  /** Stats named outright or implied by a verb plus a unit. */
  statIds: BeamStatId[];
  /**
   * Set when the question used a bare unit ("yards") that no verb disambiguated.
   * The scorer turns this into a clarification rather than a guess.
   */
  ambiguousUnit: NonNullable<BeamStat["bareUnit"]> | null;
  /**
   * Where that bare unit word sat. A stat clarification rewrites the question
   * with the chosen stat in this exact position, so answering "rushing yards"
   * re-asks the whole original question rather than starting a new one.
   */
  ambiguousUnitSpan: NameSpan | null;
  seasons: SeasonToken[];
  /** "between weeks 2 and 8". Null when the question was about a whole season. */
  weeks: WeekRange | null;
  /** "over the last 3 years", "since 2023". Null when one season or none. */
  seasonSpan: SeasonSpan | null;
  /** "top 10", "best 25". Null when the question was not a leaderboard. */
  topN: TopN | null;
  lens: LensToken | null;
  positions: string[];
  teams: string[];
  heads: string[];
  /** Words naming the KIND of question: "worth", "rank", "better", "old". */
  concepts: ConceptTag[];
  /** True when the question named two sides explicitly ("vs", "or"). */
  hasComparator: boolean;
  /** Unclaimed spans, in order. Candidate player names. */
  nameSpans: NameSpan[];
  /** Content tokens nothing accounted for. Drives the scorer's penalty. */
  leftoverTokens: string[];
};

/**
 * Spans of one to four adjacent unclaimed tokens.
 *
 * Four is the ceiling because it covers every real name shape we hold, including
 * "amon ra st brown", while staying short enough that a rambling unmatched
 * clause does not become one enormous "name".
 */
const MAX_NAME_TOKENS = 4;

export function extractEntities(rawNormalized: string): ExtractedEntities {
  const normalized = normalizeText(rawNormalized);
  const tokens = normalized.length > 0 ? normalized.split(" ") : [];
  const claimed: boolean[] = new Array(tokens.length).fill(false);

  // 1. Named stats. Longest-first, so "yards per carry" beats "yards".
  const statMatches = STAT_MATCHER.matchAll(tokens, claimed);

  // 2. Verbs, on what is left. "threw for", "ran for", "caught".
  const verbMatches = VERB_MATCHER.matchAll(tokens, claimed);

  // 3. Week ranges, BEFORE seasons. The season scan reads a bare "15" as the
  //    2015 season, so "between weeks 15 and 17" has to claim its numbers first
  //    or the question turns into one about two seasons nobody mentioned.
  const weeks = scanWeekRange(tokens, claimed);

  // 4. Leaderboard counts, before seasons for the same reason as weeks: "top
  //    25" would otherwise be read as the 2025 season.
  const topN = scanTopN(tokens, claimed);

  // 5. Season spans, before single seasons: "last 3 years" contains "last
  //    year", and the lexicon would claim that and leave "3 years" behind as a
  //    candidate player name.
  const seasonSpan = scanSeasonSpan(tokens, claimed);

  // 6. Season words, then bare year tokens.
  const seasonMatches = SEASON_MATCHER.matchAll(tokens, claimed);
  const seasons: SeasonToken[] = seasonMatches.map((m) => m.value);
  for (let i = 0; i < tokens.length; i++) {
    if (claimed[i]) continue;
    const year = parseExplicitSeason(tokens[i]);
    if (year !== null) {
      seasons.push({ kind: "explicit", season: year });
      claimed[i] = true;
    }
  }

  // 7. Lens words. After seasons, because "this week" is a lens and "this year"
  //    is a season, and they share a leading token.
  const lensMatches = LENS_MATCHER.matchAll(tokens, claimed);

  // 8. Positions, then teams. Both are disambiguation hints for the resolver.
  const positionMatches = POSITION_MATCHER.matchAll(tokens, claimed);
  const teamMatches = TEAM_MATCHER.matchAll(tokens, claimed);

  // 9. Question heads, then comparators. Heads run before concepts so "how old
  //    is" is read as one head rather than as the concept word "old" with a
  //    broken head around it.
  const headMatches = HEAD_MATCHER.matchAll(tokens, claimed);
  const comparatorMatches = COMPARATOR_MATCHER.matchAll(tokens, claimed);

  // 10. Concept words. These have to be claimed, not merely noticed: an
  //    unclaimed "worth" next to "bijan robinson" would be absorbed into the
  //    name span and sent to the resolver as part of the name.
  const conceptMatches = CONCEPT_MATCHER.matchAll(tokens, claimed);

  // 11. Filler last, so it can never outrank a real vocabulary.
  FILLER_MATCHER.matchAll(tokens, claimed);

  /* ---- the verb rule ------------------------------------------------ */

  const statIds: BeamStatId[] = [];
  let ambiguousUnit: NonNullable<BeamStat["bareUnit"]> | null = null;
  let ambiguousUnitSpan: NameSpan | null = null;
  const verbImplied = verbMatches.flatMap((m) => m.value);

  for (const match of statMatches) {
    const stat = getStat(match.value);
    const unit = BARE_UNITS[match.text];

    if (!unit) {
      // A fully qualified phrase ("passing yards"). Nothing to infer.
      statIds.push(stat.id);
      continue;
    }

    // A bare unit. Look for a verb in the same question that names a stat with
    // this unit: "threw for" plus "yards" is passing yards.
    const steered = verbImplied
      .map(getStat)
      .find((candidate) => candidate.bareUnit === unit);

    if (steered) {
      statIds.push(steered.id);
      continue;
    }

    // No verb to steer it. Keep whatever the registry's default reading is
    // (total yards, total touchdowns) but record the ambiguity, so a question
    // about a running back's "yards" asks instead of picking.
    statIds.push(stat.id);
    ambiguousUnit = unit;
    ambiguousUnitSpan = { text: match.text, start: match.start, end: match.end };
  }

  // A verb with no unit word at all still names a stat: "how many did purdy
  // throw for" is thin, but "what did purdy throw for" is not worth guessing on.
  // Only fall back to the verb's first stat when no stat phrase matched at all.
  if (statIds.length === 0 && verbImplied.length > 0) {
    statIds.push(verbImplied[0]);
  }

  /* ---- leftover spans become candidate names ------------------------ */

  const nameSpans: NameSpan[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    // A run longer than the ceiling is truncated from the START, because in
    // English the words nearest the verb are the ones most likely to be the name.
    const slice = run.slice(-MAX_NAME_TOKENS);
    nameSpans.push({
      text: slice.map((i) => tokens[i]).join(" "),
      start: slice[0],
      end: slice[slice.length - 1] + 1,
    });
    run = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    if (claimed[i]) flush();
    else run.push(i);
  }
  flush();

  // Everything unclaimed is also a leftover token for the scorer, but a token
  // inside a name span is accounted for, so only spans we could not build from
  // count against a capability. In practice that is the empty set: every
  // unclaimed token joins a span. The distinction exists so the scorer's penalty
  // has a well-defined input if that ever stops being true.
  const spanned = new Set<number>();
  for (const span of nameSpans) {
    for (let i = span.start; i < span.end; i++) spanned.add(i);
  }
  const leftoverTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!claimed[i] && !spanned.has(i)) leftoverTokens.push(tokens[i]);
  }

  return {
    normalized,
    tokens,
    statIds: dedupe(statIds),
    ambiguousUnit,
    ambiguousUnitSpan,
    seasons,
    weeks,
    seasonSpan,
    topN,
    lens: lensMatches.length > 0 ? lensMatches[0].value : null,
    positions: dedupe(positionMatches.map((m) => m.value)),
    teams: dedupe(teamMatches.map((m) => m.value)),
    heads: dedupe(headMatches.map((m) => m.value)),
    concepts: dedupe(conceptMatches.map((m) => m.value)),
    hasComparator: comparatorMatches.length > 0,
    nameSpans,
    leftoverTokens,
  };
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
