/**
 * Damerau-Levenshtein edit distance, with adjacent transposition.
 *
 * Trigram similarity is a good first filter and a bad final judge on short
 * strings: "lamb" scores similarly against "lamm", "labm", and "lam", and the
 * one that is actually a plausible typo is the transposition. Damerau counts a
 * swapped pair as one edit rather than two, which is the difference between
 * "prudy" reading as one slip away from "purdy" (it is) and two (it is not).
 *
 * The optimal-string-alignment variant is used, not the unrestricted one: it
 * forbids editing a substring twice, which is the right model for typing
 * mistakes and is meaningfully cheaper. For inputs this short the distinction
 * never changes an answer.
 *
 * Bounded on purpose. Callers pass the largest distance they care about, and the
 * function stops as soon as every cell in a row exceeds it, so a comparison
 * against a wildly different name costs a row or two instead of a full matrix.
 */

export function damerauLevenshtein(a: string, b: string, maxDistance = Infinity): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  // A length gap alone already exceeds the budget; no need to build a matrix.
  if (Math.abs(al - bl) > maxDistance) return maxDistance + 1;

  // Three rolling rows: two back for the transposition check, one back for the
  // usual insert/delete/substitute, and the row being filled.
  let twoBack: number[] = new Array(bl + 1).fill(0);
  let oneBack: number[] = new Array(bl + 1);
  let current: number[] = new Array(bl + 1);

  for (let j = 0; j <= bl; j++) oneBack[j] = j;

  for (let i = 1; i <= al; i++) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        current[j - 1] + 1, // insertion
        oneBack[j] + 1, // deletion
        oneBack[j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1); // transposition
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > maxDistance) return maxDistance + 1;

    const spare = twoBack;
    twoBack = oneBack;
    oneBack = current;
    current = spare;
  }

  return oneBack[bl];
}

/**
 * Distance as a 0..1 similarity, normalized by the longer string.
 *
 * Used to scale a fuzzy match's confidence: one typo in a four-letter name is a
 * much weaker signal than one typo in a twelve-letter name, and a flat distance
 * threshold cannot express that.
 */
export function normalizedSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const distance = damerauLevenshtein(a, b);
  return Math.max(0, 1 - distance / longest);
}
