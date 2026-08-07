/**
 * The event key: a deterministic fingerprint for "which real-world event is this
 * post about", computed in code with no model call.
 *
 * WHY THIS EXISTS
 *
 * Between 2026-08-04 and 2026-08-07 the Brief published six separate articles about
 * Jonathan Taylor signing one contract, five about Jahmyr Gibbs signing one contract,
 * and five about Jalon Walker tearing one ACL. Twenty-three of the forty-nine
 * articles written in that window covered an event another article already covered.
 *
 * The pipeline was asking a language model "is this the same story?" and the model
 * was answering wrong in both directions: before 2026-08-04 it merged 75% of
 * everything (including a record running-back contract into an offensive lineman's
 * article), and after the guardrails in migration 0169 it merged almost nothing.
 *
 * Whether "Jonathan Taylor agrees to a two-year extension" at 11:55 and "Jonathan
 * Taylor officially signed his two-year extension" at 19:15 are the same event is not
 * a judgement call. It is a lookup. Lookups are free, they are stable, and they do not
 * drift when a prompt is edited.
 *
 * WHAT THE KEY IS
 *
 *   <event kind>:<sorted resolved player ids>
 *
 * Both halves come from work the pipeline has already done. The player ids are the
 * confidently-resolved references from ./match.ts. The kind is read off the post text,
 * the quoted or retweeted text, and the classifier's own suggested title, slug, and
 * tags, all of which exist before this runs.
 *
 * DESIGN NOTES
 *
 * The kinds are deliberately COARSE. An earlier draft separated "signing" from
 * "contract" and it broke immediately on the real corpus: "Stefon Diggs is expected to
 * sign a one-year deal" and "the Commanders being set to sign free-agent WR Stefon
 * Diggs" are the same event described with different vocabulary, and any scheme that
 * lets them land on different kinds has failed at the only job it has. Two posts about
 * one event must agree; a kind that is arguably imprecise but always agrees is worth
 * more here than a precise one that sometimes disagrees.
 *
 * The key is NOT a claim that two posts are the same story. It is a claim that they
 * COULD be, cheaply enough to check on every post. An exact key match plus a time
 * window is treated as the same story; anything weaker is handed to the model, which
 * now sees a short list of plausible candidates instead of fifteen recent articles.
 */

/**
 * What kind of thing happened. Coarse on purpose: see the design note above.
 *
 * 'unknown' means the post gave no usable signal, which disables the key entirely
 * for that post rather than inventing a grouping.
 */
export type BeaconEventKind =
  "injury" | "discipline" | "transaction" | "usage" | "unknown";

/**
 * Terms are matched whole, against a normalized string padded with spaces, so "ir"
 * matches "placed on IR" and never "first". Multi-word phrases work the same way.
 *
 * Order matters: the first list that matches wins, so the specific vocabularies
 * (injury, discipline) are checked before the broad ones. A post that is genuinely
 * both, "Colts sign Pharaoh Brown, place Sean McKeon on IR", lands on injury. That
 * is not the more accurate label, but its siblings will land there too, which is
 * the only property this function has to have.
 */
const INJURY_TERMS = [
  "injury",
  "injuries",
  "injured",
  "injured reserve",
  "hurt",
  "tear",
  "tore",
  "torn",
  "acl",
  "mcl",
  "pcl",
  "achilles",
  "hamstring",
  "groin",
  "quad",
  "calf",
  "ankle",
  "knee",
  "shoulder",
  "hip",
  "concussion",
  "strain",
  "strained",
  "sprain",
  "sprained",
  "fracture",
  "fractured",
  "broken",
  "surgery",
  "mri",
  "x ray",
  "xray",
  "soreness",
  "sore",
  "bruise",
  "carted",
  "limped",
  "week to week",
  "day to day",
  "questionable",
  "doubtful",
  "ir",
  "pup",
  "nfi",
  "non football injury",
  "physically unable",
  "rehab",
  "rehabbing",
  "clot",
  "embolism",
  "ailment",
];

const DISCIPLINE_TERMS = [
  "suspend",
  "suspends",
  "suspended",
  "suspension",
  "banned",
  "fined",
  "arrest",
  "arrested",
  "charged",
  "charges",
  "investigation",
  "investigated",
  "gambling policy",
  "personal conduct",
  "violation",
  "violations",
];

const TRANSACTION_TERMS = [
  "sign",
  "signs",
  "signed",
  "signing",
  "agreement",
  "agreed",
  "terms",
  "contract",
  "contracts",
  "extension",
  "extensions",
  "extend",
  "extended",
  "deal",
  "deals",
  "restructure",
  "restructured",
  "guaranteed",
  "per year",
  "new money",
  "highest paid",
  "raise",
  "incentives",
  "franchise tag",
  "tagged",
  "holdout",
  "holdouts",
  "hold out",
  "trade",
  "trades",
  "traded",
  "acquired",
  "release",
  "released",
  "waived",
  "waivers",
  "claimed",
  "activated",
  "activate",
  "elevated",
  "promoted",
  "practice squad",
  "roster move",
  "roster moves",
  "workout",
  "worked out",
  "tryout",
  "tried out",
  "visit",
  "visiting",
  "free agent",
  "retire",
  "retires",
  "retired",
  "retirement",
  "physical",
  "physicals",
  "million",
];

const USAGE_TERMS = [
  "practice",
  "practices",
  "camp",
  "starter",
  "starters",
  "starting",
  "depth chart",
  "first team",
  "snap",
  "snaps",
  "reps",
  "benched",
  "qb1",
  "rb1",
  "wr1",
  "competition",
  "battle",
  "preseason",
  "debut",
  "drill",
  "drills",
  "yards",
  "touchdown",
  "touchdowns",
  "carries",
  "targets",
  "workload",
];

/**
 * Lowercase, strip everything that is not a letter or a digit, collapse runs of
 * whitespace, and pad with a single leading and trailing space.
 *
 * The padding is what makes whole-term matching a plain `includes` check: a term
 * surrounded by spaces can only match a whole token, so "ir" finds "on IR today"
 * and not "first" or "their".
 */
export function normalizeForEventKind(input: string): string {
  return ` ${input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function matchesAny(normalized: string, terms: string[]): boolean {
  return terms.some((term) => normalized.includes(` ${term} `));
}

/**
 * Read the event kind off whatever text is available.
 *
 * Callers should pass everything they have: the post text, the quoted and retweeted
 * text, and the classifier's suggested title, slug, and tags. The suggested slug in
 * particular carries the signal when the post itself does not. One of the six
 * Jonathan Taylor duplicates was nothing but a stat line ("626 carries, 3,026 rushing
 * yards"), which names no event at all; its classifier slug was
 * "jonathan-taylor-colts-extension", and that is what put it with its siblings.
 */
export function classifyEventKind(
  parts: Array<string | null | undefined>,
): BeaconEventKind {
  const normalized = normalizeForEventKind(parts.filter(Boolean).join(" "));
  if (normalized.trim().length === 0) return "unknown";
  if (matchesAny(normalized, INJURY_TERMS)) return "injury";
  if (matchesAny(normalized, DISCIPLINE_TERMS)) return "discipline";
  if (matchesAny(normalized, TRANSACTION_TERMS)) return "transaction";
  if (matchesAny(normalized, USAGE_TERMS)) return "usage";
  return "unknown";
}

/**
 * Build the key, or null when this post cannot carry one.
 *
 * Null on an unknown kind, and null with no resolved players. Both are refusals to
 * guess. A key built on teams alone would put every Falcons post in one bucket, and
 * a key built on players alone would merge a contract into an injury.
 *
 * Ids are sorted so the key does not depend on the order the matcher happened to
 * return them in.
 */
export function buildEventKey(
  kind: BeaconEventKind,
  playerIds: string[],
): string | null {
  if (kind === "unknown") return null;
  const ids = [...new Set(playerIds.filter(Boolean))].sort();
  if (ids.length === 0) return null;
  return `${kind}:${ids.join(",")}`;
}

/** The kind half of a key, for comparing two keys without re-deriving them. */
export function eventKeyKind(key: string | null | undefined): string | null {
  if (!key) return null;
  const idx = key.indexOf(":");
  return idx > 0 ? key.slice(0, idx) : null;
}

/** The player-id half of a key. */
export function eventKeyPlayerIds(key: string | null | undefined): string[] {
  if (!key) return [];
  const idx = key.indexOf(":");
  if (idx < 0) return [];
  return key
    .slice(idx + 1)
    .split(",")
    .filter(Boolean);
}

/**
 * Do two keys describe the same kind of event involving overlapping people?
 *
 * This is the weaker relationship the model gets asked about. It is what puts "The
 * Colts have now handed out major contracts to their QB/RB/WR trio" next to the
 * Jonathan Taylor contract article: same kind, and Taylor is in both, but the player
 * sets differ so it is not automatically the same story.
 */
export function eventKeysOverlap(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const kindA = eventKeyKind(a);
  if (!kindA || kindA !== eventKeyKind(b)) return false;
  const idsB = new Set(eventKeyPlayerIds(b));
  return eventKeyPlayerIds(a).some((id) => idsB.has(id));
}
