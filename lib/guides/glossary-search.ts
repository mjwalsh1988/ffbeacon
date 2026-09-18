/**
 * The matching behind the glossary's "Find a term" box.
 *
 * Pure and client-safe, so the box can run it on every keystroke without a
 * server call and the tests can pin its behaviour.
 *
 * People type the question the way they would type it into a search engine:
 * "what does bn mean in fantasy football". The filler words are stripped
 * first, so that query is matched as "bn". Punctuation is ignored when
 * comparing, so "wrt", "W/R/T" and "w r t" all find the same entry.
 *
 * Ranking, best first: the letters match exactly, the label starts with the
 * query, the label or its alternate name contains it, the definition contains
 * it. Ties keep glossary order, which is the order the page reads in.
 */

export type GlossarySearchEntry = {
  /** Anchor id on the glossary page. */
  id: string;
  /** What the reader sees first: the term, or the abbreviation's letters. */
  label: string;
  /** Expansion or alternate name. */
  aka?: string;
  /** One or two sentences: the definition. */
  gist: string;
  /** Which part of the page it lives in, for the result line. */
  group: string;
};

const FILLER = new Set([
  "what",
  "whats",
  "does",
  "do",
  "is",
  "are",
  "a",
  "an",
  "the",
  "mean",
  "means",
  "meaning",
  "stand",
  "stands",
  "for",
  "in",
  "on",
  "of",
  "fantasy",
  "football",
  "ff",
  "nfl",
]);

/** Lowercase, drop punctuation. "W/R/T" becomes "wrt". */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9%+]/g, "");
}

/**
 * The words a reader typed, minus the ones every question shares. When the
 * whole query is filler ("what does it mean"), nothing is left and nothing
 * matches, which is better than matching everything.
 */
export function normalizeGlossaryQuery(raw: string): string {
  const words = raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[?!.,"']/g, ""))
    .filter((w) => w.length > 0 && !FILLER.has(w));
  return words.join(" ").trim();
}

/** Split a label like "BN, BE" or "DEF, D/ST" into the separate codes it names. */
function codes(label: string): string[] {
  return label.split(/,|\bor\b|\band\b/).map(squash).filter(Boolean);
}

export function searchGlossary(
  entries: GlossarySearchEntry[],
  raw: string,
  limit = 8,
): GlossarySearchEntry[] {
  const query = normalizeGlossaryQuery(raw);
  if (!query) return [];
  const whole = rank(entries, query);
  if (whole.length > 0) return whole.slice(0, limit);

  // "pf and pa" matches nothing as one string. Try each word on its own and
  // keep the results in the order the words were typed, without repeats.
  const words = query.split(" ").filter((w) => w !== "and" && w !== "or");
  if (words.length < 2) return [];
  const seen = new Set<string>();
  const merged: GlossarySearchEntry[] = [];
  for (const word of words) {
    for (const entry of rank(entries, word)) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }
  }
  return merged.slice(0, limit);
}

function rank(entries: GlossarySearchEntry[], query: string): GlossarySearchEntry[] {
  const q = squash(query);
  if (!q) return [];

  const scored: { entry: GlossarySearchEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = squash(entry.label);
    const aka = entry.aka ? squash(entry.aka) : "";
    let score = 0;
    if (codes(entry.label).includes(q) || label === q || (aka && codes(entry.aka!).includes(q))) {
      score = 4;
    } else if (label.startsWith(q)) {
      score = 3;
    } else if (label.includes(q) || (aka && aka.includes(q))) {
      score = 2;
    } else if (q.length >= 3 && entry.gist.toLowerCase().includes(query)) {
      // The definition is searched only for three letters or more, so "q" does
      // not match every sentence with the word "quarterback" in it.
      score = 1;
    }
    if (score > 0) scored.push({ entry, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  // A short query that names an abbreviation exactly is a lookup, not a
  // browse. "be" should answer with BN and BE, not with Best Ball and Beacon
  // Verdict because they happen to start with the same two letters.
  if (q.length <= 3 && scored.some((s) => s.score === 4)) {
    return scored.filter((s) => s.score === 4).map((s) => s.entry);
  }
  return scored.map((s) => s.entry);
}
