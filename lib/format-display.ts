/**
 * Visual-only abbreviation of format display names. "Superflex" is wide
 * enough that the format toggle in the header wraps awkwardly on narrow
 * phones; collapsing it to "SF" keeps the row on a single line while
 * still being instantly readable to fantasy players (SF is universal in
 * dynasty / superflex parlance).
 *
 * This is a render-time transform only, DB rows keep the full name,
 * and consumers that surface the format to screen readers should pass
 * the original `display_name` via aria-label so SR users still hear
 * "Superflex". Use `shortFormatName(displayName)` for the visible text;
 * keep `displayName` for the accessible name.
 */
export function shortFormatName(displayName: string): string {
  if (!displayName) return displayName;
  // Word-boundary swap so we don't accidentally munge other words. The
  // current format slug set has "Superflex" appearing as a whole word
  // (Redraft PPR Superflex / Dynasty PPR Superflex / Dynasty Superflex
  // TEP), the regex keeps that flexible if more formats land later.
  return displayName.replace(/\bSuperflex\b/gi, "SF");
}
