/**
 * Longest-match phrase lookup over a token stream.
 *
 * BEAM's vocabulary is small and closed (roughly 40 stats with a dozen phrasings
 * each, 6 positions, 32 teams, a handful of lens and season words), so the right
 * data structure is the boring one: a Map keyed by the joined phrase, probed
 * from the longest possible n-gram down to one token.
 *
 * LONGEST MATCH IS THE WHOLE POINT. "passing yards" must beat "yards", and
 * "yards per carry" must beat both "yards" and "carry". Probing shortest-first
 * would consume "yards" and leave "passing" dangling as a candidate player name,
 * which is how a question about Brock Purdy's arm turns into a search for a
 * receiver called Passing.
 *
 * Matches never overlap: once tokens 3 through 5 are claimed by a phrase, the
 * scan resumes at token 6. Whatever is left unclaimed becomes a candidate name
 * span, which is exactly the signal the entity extractor needs.
 */

export type PhraseEntry<T> = {
  /** Normalized phrase, single-spaced. */
  phrase: string;
  value: T;
};

export type PhraseMatch<T> = {
  value: T;
  /** Inclusive token index where the match starts. */
  start: number;
  /** Exclusive token index where the match ends. */
  end: number;
  /** The matched text, rebuilt from the tokens. */
  text: string;
};

export class PhraseMatcher<T> {
  private readonly byPhrase: Map<string, T>;
  private readonly maxTokens: number;

  constructor(entries: ReadonlyArray<PhraseEntry<T>>) {
    this.byPhrase = new Map();
    let max = 1;
    for (const entry of entries) {
      const phrase = entry.phrase.trim();
      if (!phrase) continue;
      // First writer wins, so an earlier, more specific registry entry is not
      // silently overwritten by a later generic one sharing a phrasing.
      if (!this.byPhrase.has(phrase)) this.byPhrase.set(phrase, entry.value);
      const len = phrase.split(" ").length;
      if (len > max) max = len;
    }
    this.maxTokens = max;
  }

  /**
   * Every non-overlapping match in the token list, left to right, each as long
   * as it can be. `claimed` marks token positions already consumed by an earlier
   * pass (stat phrases are matched before positions, and so on), so two
   * vocabularies can never both claim the same word.
   */
  matchAll(tokens: readonly string[], claimed?: boolean[]): PhraseMatch<T>[] {
    const out: PhraseMatch<T>[] = [];
    let i = 0;
    while (i < tokens.length) {
      if (claimed?.[i]) {
        i += 1;
        continue;
      }
      const maxLen = Math.min(this.maxTokens, tokens.length - i);
      let matched = false;
      for (let len = maxLen; len >= 1; len--) {
        // A phrase may not straddle a token another vocabulary already took.
        let blocked = false;
        if (claimed) {
          for (let k = i; k < i + len; k++) {
            if (claimed[k]) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;

        const slice = tokens.slice(i, i + len);
        const phrase = slice.join(" ");
        const value = this.byPhrase.get(phrase);
        if (value !== undefined) {
          out.push({ value, start: i, end: i + len, text: phrase });
          if (claimed) {
            for (let k = i; k < i + len; k++) claimed[k] = true;
          }
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) i += 1;
    }
    return out;
  }

  /** True when the token list contains this exact phrase anywhere. */
  has(phrase: string): boolean {
    return this.byPhrase.has(phrase);
  }
}
