/**
 * Fetching KeepTradeCut's ranked list (every player and, on dynasty, every
 * draft pick) for one product.
 *
 * Where KTC keeps the list has moved three times (lib/ktc-page.ts reads the
 * two in-page layouts). Since 2026-11-24 the rankings page ships an empty
 * `var playersArray = [];` and the browser fills it from
 *
 *   GET https://keeptradecut.com/{route}-rankings/player-pool?v={playersVersion}
 *
 * which returns the same array of player objects the page used to embed
 * (playerID, playerName, position, oneQBValues, superflexValues and the
 * rest). One pool serves both formats, so a product is fetched once. The
 * endpoint answers 403 unless the request names a KTC page as its Referer.
 *
 * fetchKtcPlayers loads the rankings page the way a browser does, uses the
 * page's own list if it still carries a non-empty one, and otherwise asks the
 * pool endpoint the way the page's script does: with the page's version, the
 * cookies the page set and the page as Referer. Any failure throws an Error
 * that says which step failed, so the nightly alert names the cause.
 *
 * Used by the nightly sync (lib/sync-ktc.ts), the history backfill
 * (scripts/backfill-ktc-history.ts) and the probe scripts, so they cannot
 * drift apart again.
 */

import { extractKtcPlayers, extractKtcPlayersVersion, type KtcPageLayout } from "./ktc-page";

export type KtcRoute = "dynasty" | "fantasy";

export type KtcPlayersSource = KtcPageLayout | "player-pool";

export type KtcPlayersResult = { players: unknown[]; source: KtcPlayersSource };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ORIGIN = "https://keeptradecut.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
/** Per request. The pool is about 2.4 MB and normally arrives in under two seconds. */
const REQUEST_TIMEOUT_MS = 30_000;

export function ktcRankingsPageUrl(route: KtcRoute): string {
  return `${ORIGIN}/${route}-rankings?format=1`;
}

export function ktcPlayerPoolUrl(route: KtcRoute, version: string | null): string {
  const base = `${ORIGIN}/${route}-rankings/player-pool`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/** Refuses a response that a redirect delivered from another host. */
function assertKtcHost(response: Response, requested: string, what: string): void {
  const host = new URL(response.url || requested).hostname;
  if (host !== new URL(ORIGIN).hostname) {
    throw new Error(`KTC ${what} was redirected to ${host}`);
  }
}

/** `name=value` pairs from a response's Set-Cookie headers, ready for a Cookie header. */
function cookieHeaderFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return setCookies
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .join("; ");
}

export async function fetchKtcPlayers(
  route: KtcRoute,
  fetchImpl: FetchLike = fetch,
): Promise<KtcPlayersResult> {
  const pageUrl = ktcRankingsPageUrl(route);
  const page = await fetchImpl(pageUrl, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!page.ok) {
    throw new Error(`KTC ${route} rankings page answered HTTP ${page.status}`);
  }
  assertKtcHost(page, pageUrl, `${route} rankings page`);
  const html = await page.text();

  const embedded = extractKtcPlayers(html);
  if (embedded && embedded.players.length > 0) {
    return { players: embedded.players, source: embedded.layout };
  }

  const version = extractKtcPlayersVersion(html);
  const cookie = cookieHeaderFrom(page);
  const poolUrl = ktcPlayerPoolUrl(route, version);
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/json",
    referer: pageUrl,
  };
  if (cookie) headers.cookie = cookie;

  const pool = await fetchImpl(poolUrl, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!pool.ok) {
    throw new Error(
      `KTC ${route} player pool answered HTTP ${pool.status} (page ${html.length} bytes, ` +
        `version ${version ?? "not found"}); the endpoint or its gate may have changed`,
    );
  }
  assertKtcHost(pool, poolUrl, `${route} player pool`);
  let body: unknown;
  try {
    body = await pool.json();
  } catch {
    throw new Error(`KTC ${route} player pool did not return JSON`);
  }
  if (!Array.isArray(body)) {
    throw new Error(`KTC ${route} player pool returned ${typeof body}, not an array`);
  }
  if (body.length === 0) {
    throw new Error(`KTC ${route} player pool returned an empty list`);
  }
  return { players: body, source: "player-pool" };
}
