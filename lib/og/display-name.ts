/**
 * A person's name, shortened to fit a fixed-width column, without ever
 * producing a string that names nobody.
 *
 * PURE, and it imports nothing. Both share images use it and so does the
 * schedule's share-card view model, so it cannot live next to the font reader in
 * lib/og/assets.ts: that module opens files at import time, which is fine in a
 * route and wrong in a unit test.
 *
 * WHY THIS IS NOT `slice(0, n) + "..."`. Satori does not ellipsize, so every
 * generated image has to shorten names itself, and a plain truncation produces
 * "Amon-Ra St...." and "N. England Pat...", which are not names. Each rung below
 * is still something a reader recognises, and the truncation is last on purpose
 * because it is the only rung that is not.
 */

/**
 * A LADDER, FIRST RUNG THAT FITS WINS:
 *
 *   1. The name as it is.
 *   2. The initial form, "C. McCaffrey".
 *   3. The last word alone, "Patriots", "McCaffrey".
 *   4. A truncation, reached only by a single very long token.
 *
 * Rung three exists because of team defences. "New England Patriots" survives
 * rung two as "N. England Patriots", which is still too long, and truncating
 * that gives "N. England Pat...". "Patriots" is what everybody calls them, and
 * the row already says DEF, NE beside it.
 */
export function displayName(name: string, maxLength = 20): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return clip(trimmed, maxLength);

  const initialled = `${parts[0].slice(0, 1)}. ${parts.slice(1).join(" ")}`;
  if (initialled.length <= maxLength) return initialled;

  const last = parts[parts.length - 1];
  if (last.length <= maxLength) return last;

  return clip(initialled, maxLength);
}

/** The floor. Only reached by a single token longer than the whole column. */
export function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 3))}...`;
}
