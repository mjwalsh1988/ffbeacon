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

/**
 * The most characters the team card's defender line may print, prefix
 * included. That line gets a row of its own, 1120 px wide (1200 less 40 px of
 * padding each side), at 13 px Geist. Geist's widest realistic run (capitals,
 * W, M) is about 0.7 em, 9.1 px a character, so 110 characters is at most
 * about 1,000 px and cannot reach the edge; ordinary mixed-case names run
 * nearer 7 px a character.
 */
export const DEFENDER_LINE_BUDGET = 110;

/** Printed before the names on the team card (plan IDP-209, R-19). */
export const DEFENDER_LINE_PREFIX = "Defense, no market value: ";

/**
 * Defenders by name for the team card's footer. As many names as fit the
 * character budget, each shortened through displayName, and the rest COUNTED
 * ("and 3 more") rather than cut off without a word. Always prints at least
 * one name when there is one.
 */
export function defenderFooterLine(names: string[], budget = DEFENDER_LINE_BUDGET): string {
  if (names.length === 0) return "";
  const room = budget - DEFENDER_LINE_PREFIX.length;
  const shown: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const next = [...shown, displayName(names[i], 18)].join(", ");
    const rest = names.length - (shown.length + 1);
    const tail = rest > 0 ? ` and ${rest} more` : "";
    if (shown.length > 0 && next.length + tail.length > room) break;
    shown.push(displayName(names[i], 18));
  }
  const more = names.length - shown.length;
  return `${DEFENDER_LINE_PREFIX}${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}
