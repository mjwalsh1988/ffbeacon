/**
 * Reading the player list out of a KeepTradeCut rankings page.
 *
 * KTC embeds every ranked player (and, on the dynasty page, every draft pick)
 * in the page itself. Where it keeps them has changed once already:
 *
 *   - Until early September 2026 the list was a literal in an inline script,
 *     `var playersArray = [ ... ];`.
 *   - From 2026-09-08 it sits in its own element,
 *     `<script type="application/json" id="ktc-players">[ ... ]</script>`,
 *     and `playersArray` only reads that element back with JSON.parse.
 *
 * The regex that read the first layout kept "finding" nothing on the second,
 * so every nightly sync wrote zero rows for eighteen days while the page
 * itself answered 200. Both layouts are read here, the new one first, so the
 * nightly sync and the history backfill cannot drift apart again.
 *
 *   - From 2026-11-24 the page ships `var playersArray = [];` and the browser
 *     loads the list from a separate endpoint, keyed by the page's
 *     `playersVersion` global. That empty literal still "parses" here as an
 *     empty legacy list; lib/ktc-fetch.ts treats an empty list as "go to the
 *     endpoint" and uses extractKtcPlayersVersion below for the version.
 *
 * Pure. Returns null when neither layout is present (or the JSON does not
 * parse into an array), which the callers treat as "the markup changed".
 */

const ELEMENT_PATTERN = /<script\b[^>]*\bid\s*=\s*["']ktc-players["'][^>]*>([\s\S]*?)<\/script>/i;
const LEGACY_PATTERN = /var\s+playersArray\s*=\s*(\[[\s\S]*?\])\s*;/;

export type KtcPageLayout = "element" | "legacy-literal";

export function extractKtcPlayers(html: string): { players: unknown[]; layout: KtcPageLayout } | null {
  const element = html.match(ELEMENT_PATTERN);
  if (element) {
    const parsed = parseArray(element[1]);
    if (parsed) return { players: parsed, layout: "element" };
  }
  const legacy = html.match(LEGACY_PATTERN);
  if (legacy) {
    const parsed = parseArray(legacy[1]);
    if (parsed) return { players: parsed, layout: "legacy-literal" };
  }
  return null;
}

// Bounded to the characters KTC uses (e.g. 2611241820-8e1084b1baae51c9), so an
// odd value never reaches the request URL or the alert text.
const VERSION_PATTERN = /\bplayersVersion\s*=\s*["']([A-Za-z0-9._-]{1,64})["']/;

/** The page's `playersVersion` global, which the player-pool endpoint is keyed by. Null when absent. */
export function extractKtcPlayersVersion(html: string): string | null {
  const match = html.match(VERSION_PATTERN);
  return match ? match[1] : null;
}

function parseArray(text: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(text.trim());
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
