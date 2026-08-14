/**
 * BEAM's closed vocabulary: every phrase that is NOT a player name.
 *
 * Six matchers, built once at module load and reused for every request. They run
 * in a fixed order against the same `claimed` array, so a token can only ever be
 * taken once and the more specific vocabulary always goes first:
 *
 *   1. stats      "passing yards" before "yards"
 *   2. verbs      "threw for", which turns a later bare "yards" into pass yards
 *   3. seasons    "2024", "last year"
 *   4. lenses     "for dynasty", "win now"
 *   5. positions  "quarterback", "wr"
 *   6. teams      "49ers", "kc"
 *   7. heads      "how many", "who is better"
 *   8. filler     "please", "can you tell me"
 *
 * Everything still unclaimed after those eight passes is a candidate player
 * name. That is the entire entity-extraction strategy, and it works because the
 * vocabulary is closed: we know every word that is not a name.
 *
 * TEAMS come from lib/nfl-teams.ts, which is already the canonical 32-franchise
 * list used by Signal favorites. Duplicating it here would guarantee the two
 * drift.
 */

import { NFL_TEAMS } from "@/lib/nfl-teams";
import {
  BEAM_STATS,
  type BeamStat,
  type BeamStatId,
} from "@/lib/beam/stats/registry";
import { normalizeText } from "./normalize";
import { PhraseMatcher, type PhraseEntry } from "./trie";

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

const statEntries: PhraseEntry<BeamStatId>[] = [];
for (const stat of BEAM_STATS) {
  for (const phrase of stat.phrasings) {
    statEntries.push({ phrase: normalizeText(phrase), value: stat.id });
  }
}
export const STAT_MATCHER = new PhraseMatcher<BeamStatId>(statEntries);

/**
 * Verb phrases that steer a bare unit word to a specific stat.
 *
 * The value is a LIST, because one verb legitimately implies several stats:
 * "threw for" covers both passing yards and passing touchdowns, and which one is
 * meant is decided by the unit word that follows ("yards" or "touchdowns"). A
 * single-value map here would silently answer every "how many touchdowns did he
 * throw for" with a yardage figure.
 */
const verbAccumulator = new Map<string, BeamStatId[]>();
for (const stat of BEAM_STATS) {
  for (const verb of stat.verbs ?? []) {
    const phrase = normalizeText(verb);
    const list = verbAccumulator.get(phrase) ?? [];
    list.push(stat.id);
    verbAccumulator.set(phrase, list);
  }
}
const verbEntries: PhraseEntry<BeamStatId[]>[] = [...verbAccumulator].map(
  ([phrase, value]) => ({ phrase, value }),
);
export const VERB_MATCHER = new PhraseMatcher<BeamStatId[]>(verbEntries);

/** Bare unit words, the ones that are ambiguous without a qualifier. */
export const BARE_UNITS: Record<string, NonNullable<BeamStat["bareUnit"]>> = {
  yards: "yards",
  yard: "yards",
  yds: "yards",
  yardage: "yards",
  touchdowns: "touchdowns",
  touchdown: "touchdowns",
  tds: "touchdowns",
  td: "touchdowns",
  scores: "touchdowns",
  catches: "catches",
  attempts: "attempts",
  points: "points",
  pts: "points",
};

/* ------------------------------------------------------------------ */
/* Seasons                                                             */
/* ------------------------------------------------------------------ */

/**
 * A season reference. Resolved against the clock later, because "last year"
 * cannot be turned into a number without knowing what year it is and whether the
 * current one has produced any games.
 */
export type SeasonToken =
  | { kind: "explicit"; season: number }
  | { kind: "relative"; offset: number }
  | { kind: "current" }
  | { kind: "career" }
  | { kind: "rookie" };

const seasonPhrases: PhraseEntry<SeasonToken>[] = [
  { phrase: "last year", value: { kind: "relative", offset: -1 } },
  { phrase: "last season", value: { kind: "relative", offset: -1 } },
  { phrase: "a year ago", value: { kind: "relative", offset: -1 } },
  { phrase: "the year before last", value: { kind: "relative", offset: -2 } },
  { phrase: "two years ago", value: { kind: "relative", offset: -2 } },
  { phrase: "two seasons ago", value: { kind: "relative", offset: -2 } },
  { phrase: "three years ago", value: { kind: "relative", offset: -3 } },
  { phrase: "this year", value: { kind: "current" } },
  { phrase: "this season", value: { kind: "current" } },
  { phrase: "current season", value: { kind: "current" } },
  { phrase: "career", value: { kind: "career" } },
  { phrase: "all time", value: { kind: "career" } },
  { phrase: "in his career", value: { kind: "career" } },
  { phrase: "rookie year", value: { kind: "rookie" } },
  { phrase: "rookie season", value: { kind: "rookie" } },
];
export const SEASON_MATCHER = new PhraseMatcher<SeasonToken>(seasonPhrases);

/**
 * A four-digit year, or a two-digit shorthand. Bounded to plausible NFL seasons
 * so a jersey number or a yardage figure is never mistaken for a year.
 */
export function parseExplicitSeason(token: string): number | null {
  if (/^(19|20)\d{2}$/.test(token)) {
    const n = Number(token);
    return n >= 1960 && n <= 2100 ? n : null;
  }
  // "24" as shorthand for 2024. Only two digits, and only in a range that could
  // be a recent season: "12" is far more likely to be a stat than a year.
  if (/^\d{2}$/.test(token)) {
    const n = Number(token);
    if (n >= 15 && n <= 49) return 2000 + n;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Lenses                                                              */
/* ------------------------------------------------------------------ */

/** Mirrors LENSES in lib/breakdown/types.ts. Not re-declared: mapped to it. */
export type LensToken = "dynasty" | "win-now" | "this-week";

const lensPhrases: PhraseEntry<LensToken>[] = [
  { phrase: "dynasty", value: "dynasty" },
  { phrase: "for dynasty", value: "dynasty" },
  { phrase: "in dynasty", value: "dynasty" },
  { phrase: "keeper", value: "dynasty" },
  { phrase: "long term", value: "dynasty" },
  { phrase: "longterm", value: "dynasty" },
  { phrase: "long run", value: "dynasty" },
  { phrase: "rebuilding", value: "dynasty" },
  { phrase: "rebuild", value: "dynasty" },
  { phrase: "for a rebuild", value: "dynasty" },
  { phrase: "for the future", value: "dynasty" },
  { phrase: "win now", value: "win-now" },
  { phrase: "winnow", value: "win-now" },
  { phrase: "competitive", value: "win-now" },
  { phrase: "contending", value: "win-now" },
  { phrase: "contender", value: "win-now" },
  { phrase: "rest of season", value: "win-now" },
  { phrase: "rest of the season", value: "win-now" },
  { phrase: "redraft", value: "win-now" },
  { phrase: "re draft", value: "win-now" },
  { phrase: "single season", value: "win-now" },
  { phrase: "one year league", value: "win-now" },
  { phrase: "startup", value: "dynasty" },
  { phrase: "start up", value: "dynasty" },
  { phrase: "this week", value: "this-week" },
  { phrase: "next week", value: "this-week" },
  { phrase: "who do i start", value: "this-week" },
  { phrase: "who should i start", value: "this-week" },
];
export const LENS_MATCHER = new PhraseMatcher<LensToken>(lensPhrases);

/* ------------------------------------------------------------------ */
/* Positions                                                           */
/* ------------------------------------------------------------------ */

const positionPhrases: PhraseEntry<string>[] = [
  { phrase: "qb", value: "QB" },
  { phrase: "quarterback", value: "QB" },
  { phrase: "quarterbacks", value: "QB" },
  { phrase: "rb", value: "RB" },
  { phrase: "running back", value: "RB" },
  { phrase: "running backs", value: "RB" },
  { phrase: "runningback", value: "RB" },
  { phrase: "halfback", value: "RB" },
  { phrase: "wr", value: "WR" },
  { phrase: "receiver", value: "WR" },
  { phrase: "receivers", value: "WR" },
  { phrase: "wide receiver", value: "WR" },
  { phrase: "wide receivers", value: "WR" },
  { phrase: "wideout", value: "WR" },
  { phrase: "te", value: "TE" },
  { phrase: "tight end", value: "TE" },
  { phrase: "tight ends", value: "TE" },
  { phrase: "k", value: "K" },
  { phrase: "kicker", value: "K" },
  { phrase: "kickers", value: "K" },
  { phrase: "def", value: "DEF" },
  { phrase: "dst", value: "DEF" },
  { phrase: "defense", value: "DEF" },
  { phrase: "defence", value: "DEF" },
  { phrase: "team defense", value: "DEF" },
];
export const POSITION_MATCHER = new PhraseMatcher<string>(positionPhrases);

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

const teamPhrases: PhraseEntry<string>[] = [];
for (const team of NFL_TEAMS) {
  teamPhrases.push({ phrase: normalizeText(team.code), value: team.code });
  teamPhrases.push({ phrase: normalizeText(team.name), value: team.code });
  // The nickname on its own, which is what people actually type. "New York
  // Giants" -> "giants". Two-word nicknames survive because the phrase matcher
  // is n-gram based.
  const parts = team.name.split(" ");
  const nickname = normalizeText(parts[parts.length - 1]);
  if (nickname.length > 2)
    teamPhrases.push({ phrase: nickname, value: team.code });
}
export const TEAM_MATCHER = new PhraseMatcher<string>(teamPhrases);

/* ------------------------------------------------------------------ */
/* Question heads and comparators                                      */
/* ------------------------------------------------------------------ */

const headPhrases: PhraseEntry<string>[] = [
  { phrase: "how many", value: "how many" },
  { phrase: "how much", value: "how many" },
  { phrase: "what were", value: "what were" },
  { phrase: "what was", value: "what were" },
  { phrase: "what is", value: "what is" },
  { phrase: "what are", value: "what is" },
  { phrase: "who is better", value: "who is better" },
  { phrase: "who is the better", value: "who is better" },
  { phrase: "which is better", value: "who is better" },
  { phrase: "who has the better", value: "who is better" },
  { phrase: "who has a better", value: "who is better" },
  { phrase: "who has the best", value: "who is better" },
  { phrase: "which player has the better", value: "who is better" },
  { phrase: "who would you rather", value: "who is better" },
  { phrase: "would you rather", value: "who is better" },
  // Draft-day phrasings. Longer than the bare "who should i" below, so they win
  // the longest-match probe and take the verb with them; left as "who should i"
  // alone, "draft" and "take" fell through unclaimed and each became a one-word
  // player name, which is what made a perfectly ordinary draft question fail.
  { phrase: "who should i draft", value: "who is better" },
  { phrase: "who do i draft", value: "who is better" },
  { phrase: "who would you draft", value: "who is better" },
  { phrase: "who should i take", value: "who is better" },
  { phrase: "who do i take", value: "who is better" },
  { phrase: "who would you take", value: "who is better" },
  { phrase: "who should i pick", value: "who is better" },
  { phrase: "who do i pick", value: "who is better" },
  { phrase: "which player should i draft", value: "who is better" },
  { phrase: "who should i", value: "who is better" },
  { phrase: "who had more", value: "who had more" },
  { phrase: "who has more", value: "who had more" },
  { phrase: "who had the most", value: "who had more" },
  { phrase: "where does", value: "where does" },
  { phrase: "where is", value: "where does" },
  { phrase: "how good is", value: "how good is" },
  { phrase: "how did", value: "how did" },
  // "how is he doing", and the phone spelling "hows he doing", ask for the
  // season line, the same as "how did he do". Without this the question has no
  // head at all and lands on whichever capability scores highest with none,
  // which was the value answer: a different question, confidently answered.
  { phrase: "how is", value: "how did" },
  { phrase: "how are", value: "how did" },
  { phrase: "what does", value: "what does" },
  { phrase: "what do", value: "what does" },
  { phrase: "how old is", value: "how old is" },
  { phrase: "who is", value: "who is" },
  { phrase: "tell me about", value: "who is" },
];
export const HEAD_MATCHER = new PhraseMatcher<string>(headPhrases);

/* ------------------------------------------------------------------ */
/* Concepts                                                            */
/* ------------------------------------------------------------------ */

/**
 * Words that name the KIND of question rather than its subject.
 *
 * "worth" does not name a player or a statistic, but it is the strongest signal
 * in "what is bijan robinson worth" that the answer is a value and not a
 * biography. Without these, the only difference between a value question, a rank
 * question, and a bio question is the question head, and readers frequently
 * write none.
 *
 * They also have to be CLAIMED here rather than left as leftovers, because an
 * unclaimed "worth" sitting next to "bijan robinson" would be swallowed into the
 * name span and sent to the resolver as part of the name.
 *
 * Deliberately narrow. "do", "did", and "season" are common enough that treating
 * them as concept words would fire on half of all questions; those are filler,
 * and the question head carries that job instead.
 */
export type ConceptTag =
  | "value"
  | "rank"
  | "compare-better"
  | "define"
  | "bio"
  | "line"
  | "project"
  /** What a player is projected to score from here. */
  | "projection"
  /** How often the projection has been beaten. */
  | "reliability"
  /** A ranked list rather than one player. */
  | "leaderboard"
  /** "What can I ask?" The question about the questions. */
  | "help"
  /** The draft guide's board, with no side named. */
  | "draft-board"
  /** The steals side of that board. */
  | "draft-steal"
  /** The fades side: who the room drafts too early. */
  | "draft-fade"
  /** The late-round swings. */
  | "draft-swing";

const conceptPhrases: PhraseEntry<ConceptTag>[] = [
  // "What can I ask?" The question about the questions, and the one a first-time
  // reader has. Several of these overlap words the filler list also holds ("can
  // you tell me", "do you know"), which is harmless: concepts are claimed before
  // filler, and the matcher takes the longest phrase at each position, so the
  // help reading wins the whole span rather than losing half of it.
  { phrase: "what can i ask", value: "help" },
  { phrase: "what can i ask you", value: "help" },
  { phrase: "what can i ask beam", value: "help" },
  { phrase: "what questions can i ask", value: "help" },
  { phrase: "what can you do", value: "help" },
  { phrase: "what can you answer", value: "help" },
  { phrase: "what can you tell me", value: "help" },
  { phrase: "what can beam do", value: "help" },
  { phrase: "what do you know", value: "help" },
  { phrase: "what should i ask", value: "help" },
  { phrase: "what are you good at", value: "help" },
  { phrase: "what type of questions", value: "help" },
  { phrase: "what types of questions", value: "help" },
  { phrase: "what kind of questions", value: "help" },
  { phrase: "what kinds of questions", value: "help" },
  { phrase: "what sort of questions", value: "help" },
  { phrase: "type of questions", value: "help" },
  { phrase: "types of questions", value: "help" },
  { phrase: "kind of questions", value: "help" },
  { phrase: "kinds of questions", value: "help" },
  { phrase: "sort of questions", value: "help" },
  { phrase: "what data do you have", value: "help" },
  { phrase: "what information do you have", value: "help" },
  { phrase: "how does this work", value: "help" },
  { phrase: "how do i use you", value: "help" },
  { phrase: "capabilities", value: "help" },
  { phrase: "help", value: "help" },
  // The draft guide's board. Both sides of it are named here rather than being
  // inferred later, because "steals" and "fades" are opposite answers and
  // guessing between them would be the worst kind of confident.
  { phrase: "draft steals", value: "draft-steal" },
  { phrase: "draft steal", value: "draft-steal" },
  { phrase: "beacon steals", value: "draft-steal" },
  { phrase: "late round steals", value: "draft-steal" },
  { phrase: "steals", value: "draft-steal" },
  { phrase: "steal", value: "draft-steal" },
  { phrase: "value picks", value: "draft-steal" },
  { phrase: "value pick", value: "draft-steal" },
  { phrase: "draft sleepers", value: "draft-steal" },
  { phrase: "sleepers", value: "draft-steal" },
  { phrase: "undervalued", value: "draft-steal" },
  { phrase: "bargains", value: "draft-steal" },
  { phrase: "draft fades", value: "draft-fade" },
  { phrase: "draft fade", value: "draft-fade" },
  { phrase: "fades", value: "draft-fade" },
  { phrase: "fade", value: "draft-fade" },
  { phrase: "draft avoids", value: "draft-fade" },
  { phrase: "players to avoid", value: "draft-fade" },
  { phrase: "who to avoid", value: "draft-fade" },
  { phrase: "avoids", value: "draft-fade" },
  { phrase: "avoid", value: "draft-fade" },
  { phrase: "overvalued", value: "draft-fade" },
  { phrase: "overpriced", value: "draft-fade" },
  { phrase: "draft busts", value: "draft-fade" },
  { phrase: "busts", value: "draft-fade" },
  { phrase: "bust", value: "draft-fade" },
  { phrase: "late round swings", value: "draft-swing" },
  { phrase: "draft swings", value: "draft-swing" },
  { phrase: "swings", value: "draft-swing" },
  { phrase: "lottery tickets", value: "draft-swing" },
  { phrase: "dart throws", value: "draft-swing" },
  // No side named. The board leads with steals, so these do too.
  { phrase: "draft board", value: "draft-board" },
  { phrase: "draft guide", value: "draft-board" },
  { phrase: "draft day", value: "draft-board" },
  { phrase: "worth", value: "value" },
  { phrase: "value", value: "value" },
  { phrase: "valued", value: "value" },
  { phrase: "trade value", value: "value" },
  { phrase: "market value", value: "value" },
  // A ranked LIST. Distinct from "rank", which asks where one named player
  // sits: these questions name no player at all.
  { phrase: "overall players", value: "leaderboard" },
  { phrase: "players overall", value: "leaderboard" },
  { phrase: "leaderboard", value: "leaderboard" },
  { phrase: "leaders", value: "leaderboard" },
  { phrase: "rankings board", value: "leaderboard" },
  { phrase: "rank", value: "rank" },
  { phrase: "ranks", value: "rank" },
  { phrase: "ranked", value: "rank" },
  { phrase: "ranking", value: "rank" },
  { phrase: "rankings", value: "rank" },
  { phrase: "better", value: "compare-better" },
  { phrase: "best", value: "compare-better" },
  { phrase: "prefer", value: "compare-better" },
  { phrase: "rather", value: "compare-better" },
  { phrase: "more valuable", value: "compare-better" },
  // Picking between two players IS the comparison question, however it is
  // phrased. "drafted" stays a bio word below ("where was he drafted"), and the
  // matcher is token-based, so these never claim it.
  { phrase: "draft", value: "compare-better" },
  { phrase: "drafting", value: "compare-better" },
  { phrase: "mean", value: "define" },
  { phrase: "means", value: "define" },
  { phrase: "meaning", value: "define" },
  { phrase: "definition", value: "define" },
  { phrase: "define", value: "define" },
  { phrase: "stand for", value: "define" },
  { phrase: "stands for", value: "define" },
  { phrase: "old", value: "bio" },
  { phrase: "age", value: "bio" },
  { phrase: "college", value: "bio" },
  { phrase: "height", value: "bio" },
  { phrase: "weight", value: "bio" },
  { phrase: "drafted", value: "bio" },
  { phrase: "injury", value: "bio" },
  { phrase: "injured", value: "bio" },
  { phrase: "hurt", value: "bio" },
  { phrase: "experience", value: "bio" },
  // Stretching a stretch of weeks over a whole season. "pace" is the word most
  // people reach for and "project" is the word they type into a search box.
  // How often the projection has been too low. Matched before the projection
  // words below, because "projection beat rate" is a question about accuracy,
  // not about a forecast, and the longer phrase has to win.
  { phrase: "projection beat rate", value: "reliability" },
  { phrase: "projection beat rates", value: "reliability" },
  { phrase: "beat rate", value: "reliability" },
  { phrase: "beat rates", value: "reliability" },
  { phrase: "hit rate", value: "reliability" },
  { phrase: "beats his projection", value: "reliability" },
  { phrase: "beat his projection", value: "reliability" },
  { phrase: "beats his projections", value: "reliability" },
  { phrase: "beats their projections", value: "reliability" },
  { phrase: "outperforms his projection", value: "reliability" },
  { phrase: "projection accuracy", value: "reliability" },
  { phrase: "reliability", value: "reliability" },
  { phrase: "reliable", value: "reliability" },
  { phrase: "consistency", value: "reliability" },
  { phrase: "consistent", value: "reliability" },
  { phrase: "boom rate", value: "reliability" },
  // What he is projected to score from here.
  { phrase: "projection", value: "projection" },
  { phrase: "projections", value: "projection" },
  { phrase: "projected", value: "projection" },
  { phrase: "projected points", value: "projection" },
  { phrase: "projected for", value: "projection" },
  { phrase: "rest of season projection", value: "projection" },
  { phrase: "ros projection", value: "projection" },
  { phrase: "outlook", value: "projection" },
  { phrase: "forecast", value: "projection" },
  // Stretching a stretch of weeks over a whole season.
  { phrase: "project", value: "project" },
  { phrase: "projects", value: "project" },
  { phrase: "extrapolate", value: "project" },
  { phrase: "extrapolated", value: "project" },
  { phrase: "pace", value: "project" },
  { phrase: "on pace", value: "project" },
  { phrase: "pace for", value: "project" },
  { phrase: "full season pace", value: "project" },
  { phrase: "over a full season", value: "project" },
  { phrase: "across a full season", value: "project" },
  { phrase: "per 17 games", value: "project" },
  { phrase: "numbers", value: "line" },
  { phrase: "stat line", value: "line" },
  { phrase: "statline", value: "line" },
  { phrase: "perform", value: "line" },
  { phrase: "performed", value: "line" },
];
export const CONCEPT_MATCHER = new PhraseMatcher<ConceptTag>(conceptPhrases);

/* ------------------------------------------------------------------ */
/* Out of scope                                                        */
/* ------------------------------------------------------------------ */

/**
 * Phrases that mean "about MY league", which BEAM cannot see.
 *
 * These are not failures of interpretation, they are questions about data BEAM
 * has no access to, and the two deserve different copy. "We could not find a
 * player by that name" is confusing when the reader asked who to start; "BEAM
 * cannot see your league yet, League Pulse can" is useful, and it points at the
 * tool that actually answers it.
 *
 * Detected on the raw normalized string rather than through the claiming pass,
 * because these phrases overlap heavily with filler and lens words and are only
 * consulted once BEAM has already failed.
 */
const OUT_OF_SCOPE_PHRASES = [
  "my league",
  "my team",
  "my roster",
  "my lineup",
  "should i start",
  "who do i start",
  "who should i start",
  "should i trade",
  "should i accept",
  "should i drop",
  "should i pick up",
  "waiver wire",
  "this trade",
  "trade offer",
  "flex spot",
] as const;

/**
 * Phrases that mean "my league" ONLY when the reader has not already narrowed
 * the question themselves.
 *
 * "Who should I draft?" is a question about a draft board BEAM cannot see.
 * "Who should I draft in my redraft league, Amon-Ra or James Cook?" is a
 * head-to-head between two named players that happens to mention a draft, and
 * BEAM answers those. The phrase is identical; the difference is whether two
 * subjects were named, so that is what decides it.
 */
const OUT_OF_SCOPE_UNLESS_NARROWED = [
  "my draft",
  "my keeper",
  "my pick",
] as const;

export function looksOutOfScope(
  normalized: string,
  options: { comparingNamedPlayers?: boolean; askingDraftBoard?: boolean } = {},
): boolean {
  if (OUT_OF_SCOPE_PHRASES.some((phrase) => normalized.includes(phrase)))
    return true;
  if (options.comparingNamedPlayers) return false;
  // "Who should I avoid in my draft" mentions a draft BEAM cannot see, but the
  // answer does not depend on seeing it: the guide's fade list is the same list
  // whatever room the reader is sitting in. Same escape hatch as a named
  // head-to-head, for the same reason.
  if (options.askingDraftBoard) return false;
  return OUT_OF_SCOPE_UNLESS_NARROWED.some((phrase) =>
    normalized.includes(phrase),
  );
}

/**
 * Words that split a question into two sides.
 *
 * "and" is deliberately absent. It joins two names ("purdy and lamb") about as
 * often as it joins two clauses, and treating it as a split would cut "amon ra
 * st brown" style names in half. Two unclaimed name spans with nothing between
 * them are already treated as two sides by the extractor, so "and" costs nothing
 * by being filler.
 */
const comparatorPhrases: PhraseEntry<"compare">[] = [
  { phrase: "vs", value: "compare" },
  { phrase: "v", value: "compare" },
  { phrase: "versus", value: "compare" },
  { phrase: "or", value: "compare" },
  { phrase: "compared to", value: "compare" },
  { phrase: "compare", value: "compare" },
];
export const COMPARATOR_MATCHER = new PhraseMatcher<"compare">(
  comparatorPhrases,
);

/* ------------------------------------------------------------------ */
/* Filler                                                              */
/* ------------------------------------------------------------------ */

/**
 * Politeness and scaffolding. Marked, not deleted: the scorer penalizes leftover
 * CONTENT tokens, and "please" left unaccounted for would look like a one-word
 * player name and drag a good match below threshold.
 */
const fillerPhrases: PhraseEntry<true>[] = [
  "please",
  "thanks",
  "thank you",
  "hey",
  "hi",
  "hello",
  "hey beam",
  "beam",
  "ask beam",
  "can you tell me",
  "can you",
  "could you",
  "i wanted to know",
  "i want to know",
  "do you know",
  "tell me",
  "i need to know",
  "does anyone know",
  "quick question",
  "the",
  "a",
  "an",
  "did",
  "does",
  "do",
  "have",
  "has",
  "had",
  "for",
  "in",
  "on",
  "at",
  "of",
  "with",
  "to",
  "his",
  "her",
  "their",
  "he",
  "she",
  "they",
  "him",
  "it",
  "was",
  "were",
  "is",
  "are",
  "get",
  "got",
  "total",
  "up",
  "so far",
  "this",
  "that",
  "i",
  "me",
  "my",
  "about",
  "put",
  "post",
  "record",
  "season",
  "year",
  "stats",
  "stat",
  "number",
  "numbers",
  "put up",
  "end up with",
  "finish with",
  // Comparison words. Unclaimed, "fewer" became a one-word name span and the
  // whole comparison failed to resolve.
  "more",
  "fewer",
  "less",
  "most",
  "least",
  "than",
  "between",
  // "and" is filler, NOT a comparator, and the difference matters.
  // Claiming it here breaks the token run, so "between amon ra and james cook"
  // becomes two name spans instead of one four-token span with a conjunction
  // buried in it. Left unclaimed, that question resolved one player called
  // "ra and james cook". It stays out of COMPARATOR_MATCHER because "or" and
  // "vs" genuinely announce a comparison and "and" often just joins two things
  // in a list, so it should split sides without also claiming the question is a
  // head-to-head.
  "and",
  // League shape words. The reader who says "in a redraft league" has already
  // been heard: "redraft" is a lens. "league" itself carries nothing, and
  // unclaimed it became a one-word player name.
  "league",
  "leagues",
  "should",
  "would",
  "could",
  // Words that sit around a week range or a two-player question and mean
  // nothing on their own. Unclaimed, each one becomes a one-word player name:
  // "how many yards did X and Y each have" was resolving a player called "each".
  "from",
  "each",
  "apiece",
  "respectively",
  "over",
  "across",
  "during",
  "span",
  "stretch",
  "overall",
  "against",
  "often",
  "higher",
  "lower",
  // How people describe the INPUT to a projection: "his season totals ... by
  // using his weeks 1 through 5". Every one of these was becoming a candidate
  // player name and inflating the count of people in the question.
  "totals",
  "by",
  "using",
  "use",
  "used",
  "based",
  "based on",
  "off of",
  "going by",
  // Words that sit around a "what can I ask" or a draft-board question. Every
  // one of these was becoming a one-word candidate player name: "show me the
  // draft fades" was searching the roster for someone called Show.
  "show",
  "list",
  "give",
  "see",
  "view",
  "want",
  "big",
  "biggest",
  "player",
  "players",
  "guys",
  "can",
  "ask",
  "asking",
  "question",
  "questions",
  "type",
  "types",
  "kind",
  "kinds",
  "sort",
  "information",
  "info",
  "data",
  "topics",
  "you",
  "your",
  "we",
  "our",
  "us",
  // Bare question words. The real head PHRASES ("who is better", "how many")
  // are matched before filler and still win; a leftover bare "who" was becoming
  // a one-word name span and taking the whole question down with it.
  "who",
  "what",
  "which",
  "when",
  "where",
  "how",
  "whose",
].map((phrase) => ({ phrase, value: true as const }));
export const FILLER_MATCHER = new PhraseMatcher<true>(fillerPhrases);
