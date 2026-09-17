/**
 * The grounding check: is every number and name in a Relay actually in the post?
 *
 * The prompt in lib/relays/extract.ts asks the model to build the relay from
 * the post and nothing else. This is what makes that a guarantee rather than a
 * request. It runs before every Relay write, on the live path, the force-push
 * path, the backfill and an admin edit, and a Relay that fails it is written
 * hidden and never posted.
 *
 * Three checks, all one-directional:
 *
 *   numbers   Every number in the headline, the facts and the timeline must
 *             appear in the post after normalising separators. "$54M" matches
 *             "54 million" and "$54,000,000"; "4-6 weeks" matches "4 to 6 weeks"
 *             and "four to six". Ordinals count as numbers in both spellings,
 *             so "2nd round" and "second round" are both checked against the
 *             post's own figure.
 *   names     Every capitalised token of two or more characters in the headline
 *             and in the fact labels and values must appear in the post, in its
 *             quoted or retweeted text, or in the player and team names the
 *             matcher resolved for this post (so "Eagles" may appear when the
 *             post said "PHI" and the team matched).
 *   facts     Every fact value must share at least one content word, or one
 *             matched number, with the post.
 *
 * It is deliberately strict in one direction only. It cannot catch a fact the
 * model left out, and it does not try; a missing fact is a shorter card, which
 * is the safe failure. What it catches is the failure the owner named: a team,
 * a timeline or a number that came from memory rather than from the post.
 *
 * Pure. No I/O, no dependency beyond the shared types.
 */

import type { RelayFact } from "./types";

export interface GroundingPost {
  text: string;
  quotedText?: string | null;
  retweetedText?: string | null;
  /** Full names of the players the matcher resolved for this post. */
  playerNames: string[];
  /** Team names, abbreviations, nicknames and cities the matcher resolved. */
  teamNames: string[];
}

export interface GroundingRelay {
  headline: string;
  facts: RelayFact[];
  timeline: string | null;
}

export interface GroundingFailure {
  check: "number" | "name" | "fact";
  /** The token that the post does not contain. */
  token: string;
  where: "headline" | "fact" | "timeline";
}

export interface GroundingResult {
  ok: boolean;
  failures: GroundingFailure[];
}

/**
 * Capitalised words that start sentences or name generic things and are not
 * evidence of an invented name. Kept short on purpose: a token that is not
 * here is checked, and an unnecessary check is a false failure the admin can
 * clear in a click, which is the safe direction.
 */
const SKIP_CAPITALISED = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "has", "have",
  "had", "will", "would", "can", "could", "should", "may", "might", "not", "no",
  "he", "she", "it", "they", "his", "her", "its", "their", "him", "them", "this",
  "that", "these", "those", "after", "before", "during", "until", "since",
  "per", "also", "both", "each", "new", "now", "out", "up", "down", "off",
  "team", "teams", "player", "players", "league", "game", "games", "week",
  "weeks", "season", "seasons", "year", "years", "day", "days", "month",
  "months", "practice", "injury", "injured", "reserve", "status", "contract",
  "deal", "extension", "trade", "signing", "signed", "release", "released",
  "waived", "suspended", "suspension", "coach", "coaching", "starting",
  "starter", "backup", "return", "returns", "expected", "questionable",
  "doubtful", "active", "inactive", "list", "roster", "sunday", "monday",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "yes", "none",
  "nfl", "mri", "tbd", "n/a",
]);

/**
 * The one kind of word a fact LABEL is checked for: an NFL team's city or
 * nickname. A label is the model's own framing of a value ("Timeline",
 * "Practice status", "Outcome"), written in title case, so every capitalised
 * word in it looks like a name to the general check and none of them is a
 * claim about the world. Checking labels the way values are checked hid twelve
 * of eighteen Relays in one backfill run over words like "Event" and
 * "Assessment". What a label CAN smuggle in is a team ("Chiefs sent" on a post
 * that never says Chiefs), so that is the one thing looked for.
 */
const NFL_TEAM_WORDS = new Set([
  "cardinals", "falcons", "ravens", "bills", "panthers", "bears", "bengals", "browns",
  "cowboys", "broncos", "lions", "packers", "texans", "colts", "jaguars", "jags",
  "chiefs", "raiders", "chargers", "rams", "dolphins", "vikings", "patriots", "pats",
  "saints", "giants", "jets", "eagles", "steelers", "49ers", "niners", "seahawks",
  "buccaneers", "bucs", "titans", "commanders",
  "arizona", "atlanta", "baltimore", "buffalo", "carolina", "chicago", "cincinnati",
  "cleveland", "dallas", "denver", "detroit", "houston", "indianapolis", "jacksonville",
  "kansas", "vegas", "angeles", "miami", "minnesota", "england", "orleans", "york",
  "philadelphia", "philly", "pittsburgh", "francisco", "seattle", "tampa", "tennessee",
  "washington",
]);

/** Words too common to count as content when checking a fact value. */
const STOPWORDS = new Set([
  ...SKIP_CAPITALISED,
  "about", "against", "into", "over", "under", "than", "then", "there", "here",
  "who", "what", "when", "where", "which", "while", "how", "all", "any", "some",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "more", "most", "less", "least", "very", "just", "only", "still", "yet",
  "did", "does", "do", "done", "get", "got", "gets", "per", "via",
]);

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  million: 1_000_000, billion: 1_000_000_000,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10,
};

const SUFFIX_MULTIPLIER: Record<string, number> = {
  k: 1000,
  thousand: 1000,
  m: 1_000_000,
  mil: 1_000_000,
  mm: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  bil: 1_000_000_000,
  billion: 1_000_000_000,
};

/**
 * Every numeric token in a string, each with the values it could stand for.
 *
 * The suffix alternation carries the ordinal endings as well as the magnitude
 * ones, because a round, a quarter and a down are the commonest figures in
 * football reporting and "2nd round pick" rewritten as "1st round pick" is the
 * exact failure this module exists to catch. Ordinal endings are absent from
 * `SUFFIX_MULTIPLIER`, so they contribute no extra value: "2nd" stands for 2.
 *
 * The trailing lookahead refuses a following digit as well as a following
 * letter, so the reader cannot chop "49ers" down to a bare "4" by giving back
 * the second digit. A token it cannot read whole is left for the name check.
 */
const NUMBER_RE =
  /\$?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|mil|bil|mm|st|nd|rd|th|[mbk])?(?![a-z\d])/gi;

/** Spelled ordinals, which stand for the same figure a digit ordinal does. */
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10,
};

export function numberCandidates(text: string): Array<{ token: string; values: number[] }> {
  const out: Array<{ token: string; values: number[] }> = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const digits = m[1].replace(/,/g, "");
    const value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const suffix = (m[2] ?? "").toLowerCase();
    const values = [value];
    const mult = SUFFIX_MULTIPLIER[suffix];
    if (mult) values.push(value * mult);
    out.push({ token: m[0].trim(), values });
  }
  return out;
}

/** Spelled ordinals in a relay string, read as the figures they are. */
function ordinalWordCandidates(text: string): Array<{ token: string; values: number[] }> {
  const out: Array<{ token: string; values: number[] }> = [];
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const value = ORDINAL_WORDS[word];
    if (value !== undefined) out.push({ token: word, values: [value] });
  }
  return out;
}

/** The set of numeric values a post could be read as containing. */
function postNumberSet(haystack: string): Set<number> {
  const set = new Set<number>();
  for (const { values } of numberCandidates(haystack)) for (const v of values) set.add(v);
  for (const word of haystack.toLowerCase().match(/[a-z]+/g) ?? []) {
    const n = WORD_NUMBERS[word];
    if (n !== undefined) set.add(n);
  }
  return set;
}

/** Lowercase word tokens, apostrophes and hyphens kept inside a word. */
function wordTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'.-]*[a-z0-9]|[a-z0-9]/g) ?? []).map(
    stripPossessive,
  );
}

/**
 * Position words to the abbreviation a relay may use for them. "Quarterback"
 * in the post licenses "QB" in the headline: that is the same fact written the
 * way a card writes it, not an addition.
 */
const POSITION_WORDS: Record<string, string> = {
  quarterback: "qb",
  quarterbacks: "qb",
  "running back": "rb",
  "running backs": "rb",
  "wide receiver": "wr",
  "wide receivers": "wr",
  receiver: "wr",
  receivers: "wr",
  "tight end": "te",
  "tight ends": "te",
  kicker: "k",
  defense: "def",
  linebacker: "lb",
  cornerback: "cb",
  safety: "s",
  "offensive tackle": "ot",
  "offensive lineman": "ol",
  "defensive end": "de",
  "defensive tackle": "dt",
  "injured reserve": "ir",
};

/**
 * The haystack: every word of the post, plus each hyphenated word's parts
 * ("Pro-Bowl" licenses "Pro Bowl"), plus the position abbreviations the post's
 * position words license.
 */
function buildHaystack(text: string): Set<string> {
  const set = new Set<string>();
  for (const t of wordTokens(text)) {
    set.add(t);
    if (t.includes("-")) for (const part of t.split("-")) if (part) set.add(part);
  }
  const lower = text.toLowerCase();
  for (const [word, abbr] of Object.entries(POSITION_WORDS)) {
    if (lower.includes(word)) set.add(abbr);
  }
  return set;
}

/**
 * A crude stem so "Activated" at the start of a headline matches "activate"
 * or "activating" in the post. Only used for sentence-initial tokens, where a
 * capital letter says nothing about whether the word is a name.
 */
function stems(token: string): string[] {
  const out = new Set<string>([token]);
  for (const suffix of ["ed", "ing", "es", "s", "d"]) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      out.add(token.slice(0, -suffix.length));
      if (suffix === "ing" || suffix === "ed") out.add(`${token.slice(0, -suffix.length)}e`);
    }
  }
  return [...out];
}

function stripPossessive(token: string): string {
  return token.replace(/'s$/, "").replace(/'$/, "").replace(/\.+$/, "");
}

/**
 * A name candidate starts with a capital or a digit and carries at least one
 * letter. The digit opening is there for the one NFL team whose name begins
 * with a number: rejecting every digit-leading token exempted "49ers" from the
 * check entirely. A token that is only digits is the number check's business.
 */
function isCapitalisedName(token: string): boolean {
  if (token.length < 2) return false;
  if (/^\d+$/.test(token)) return false;
  if (!/^[A-Z0-9]/.test(token)) return false;
  if (!/[A-Za-z]/.test(token)) return false;
  return /^[A-Z0-9][A-Za-z0-9'.-]*$/.test(token);
}

export function checkRelayGrounding(post: GroundingPost, relay: GroundingRelay): GroundingResult {
  const haystackText = [post.text, post.quotedText ?? "", post.retweetedText ?? ""].join("\n");
  // Two haystacks, deliberately. The name check may draw on the names the
  // matcher resolved ("Eagles" when the post said "PHI"); plan 4.6 grants that
  // allowance to the name check only, so the fact content-word check reads the
  // post's own words and nothing else.
  const postHaystack = buildHaystack(haystackText);
  const haystack = new Set(postHaystack);
  for (const name of [...post.playerNames, ...post.teamNames]) {
    for (const t of wordTokens(name)) haystack.add(t);
  }
  const haystackBare = new Set([...haystack].map((h) => h.replace(/[^a-z0-9]/g, "")));
  const postNumbers = postNumberSet(haystackText);

  const failures: GroundingFailure[] = [];

  const checkNumbers = (text: string, where: GroundingFailure["where"]) => {
    for (const { token, values } of [...numberCandidates(text), ...ordinalWordCandidates(text)]) {
      if (!values.some((v) => postNumbers.has(v))) {
        failures.push({ check: "number", token, where });
      }
    }
  };

  const checkNames = (
    text: string,
    where: GroundingFailure["where"],
    alsoSkip?: ReadonlySet<string>,
  ) => {
    // Walk the raw whitespace-split words and trim each one here, so the token
    // and the word it came from can never fall out of step. Building the two
    // arrays separately dropped punctuation-only words from one and not the
    // other, which shifted the sentence-start flag onto the wrong token for the
    // rest of the string.
    const rawWords = text.split(/\s+/).filter(Boolean);
    let sentenceStart = true;
    for (const raw of rawWords) {
      const startsSentence = sentenceStart;
      sentenceStart = /[.!?:]["')]*$/.test(raw);
      const token = raw.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9]+$/g, "");
      if (!token) continue;
      if (!isCapitalisedName(token)) continue;
      const key = stripPossessive(token.toLowerCase());
      if (SKIP_CAPITALISED.has(key)) continue;
      if (alsoSkip?.has(key)) continue;
      // A token the number reader can read whole ("54M", "12th") is a figure,
      // and the number check has already decided it. Only one it cannot read at
      // all ("49ers") reaches the name check.
      if (/^\d/.test(token) && numberCandidates(token).length > 0) continue;
      if (haystack.has(key)) continue;
      // "Ja'Marr" and "JaMarr", "St." and "St": one more try without punctuation.
      const bare = key.replace(/[^a-z0-9]/g, "");
      if (bare && haystackBare.has(bare)) continue;
      // A number written as a word ("Four") is a number, and the number check
      // already decided it.
      if (WORD_NUMBERS[key] !== undefined && postNumbers.has(WORD_NUMBERS[key])) continue;
      // The first word of a sentence is capitalised whether or not it is a
      // name. Let it through when a stem of it is in the post ("Activated"
      // against "activate"); a real invented name will not stem to anything.
      if (startsSentence && stems(key).some((st) => haystack.has(st) || haystackBare.has(st))) continue;
      failures.push({ check: "name", token, where });
    }
  };

  checkNumbers(relay.headline, "headline");
  checkNames(relay.headline, "headline");
  if (relay.timeline) checkNumbers(relay.timeline, "timeline");

  for (const fact of relay.facts) {
    checkNumbers(fact.value, "fact");
    checkNames(fact.value, "fact");
    // The label renders in the card's <dt> and in the Discord text as
    // "Label: value", so a team name in it is checked like one in the value.
    // Nothing else in a label is (see NFL_TEAM_WORDS).
    for (const raw of fact.label.split(/\s+/)) {
      const token = raw.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9]+$/g, "");
      const key = stripPossessive(token.toLowerCase());
      if (!NFL_TEAM_WORDS.has(key)) continue;
      if (haystack.has(key) || haystackBare.has(key.replace(/[^a-z0-9]/g, ""))) continue;
      failures.push({ check: "name", token, where: "fact" });
    }

    const contentWords = wordTokens(fact.value).filter(
      (w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d/.test(w),
    );
    if (contentWords.length === 0) continue; // a bare number or a yes/no: the number check decided
    // Plan 4.6 bullet 3 is unconditional: a fact value with content words must
    // share one with the post. There is no escape for a value whose numbers all
    // matched, because the words around a matched number are exactly where an
    // invented detail hides.
    if (!contentWords.some((w) => postHaystack.has(w))) {
      failures.push({ check: "fact", token: fact.value, where: "fact" });
    }
  }

  return { ok: failures.length === 0, failures };
}
