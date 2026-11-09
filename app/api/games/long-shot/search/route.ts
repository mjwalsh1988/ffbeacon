import { searchFantasyPlayers } from "@/lib/player-search";
import { readSleeperId } from "@/lib/ranking-boards";
import { searchHistoryPlayers } from "@/lib/long-shot/history/answers";
import { claim, errorJson, guardRequest, handleRouteError, privateJson } from "@/lib/long-shot/route-helpers";
import { longShotSearchPool } from "@/lib/long-shot/search-pool";
import { ELIGIBLE_POSITIONS, SEARCH_MIN_LENGTH } from "@/lib/long-shot/types";
import type { SearchPlayerResult } from "@/components/player-guess-combobox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_QUERY_LENGTH = 50;
// Enforced here as well as in the picker, so a hand-written request cannot
// turn the search into a browsable list two letters at a time.
const MIN_QUERY_LENGTH = SEARCH_MIN_LENGTH;
const RESULT_CAP = 8;

/**
 * GET /api/games/long-shot/search?q= (plan 17.5 and 31.3)
 *
 * The Signal Scout search route's hardening, but signed-in only (the demo
 * never calls it) and drawn from two pools: every QB, RB, WR or TE with a
 * stat line since 2020, then the history pool (lib/long-shot/history) for
 * everyone else back to 1920, under the id rule in history/answers.ts.
 * Round-independent public player data only.
 */
export async function GET(req: Request) {
  const g = await guardRequest(req);
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const raw = (url.searchParams.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);
  // Strip everything that is not a name character, so nothing reaches a
  // PostgREST filter as syntax.
  const query = raw.replace(/[^\p{L}\p{N} '.\-]/gu, "").trim();
  if (query.length < MIN_QUERY_LENGTH) return privateJson({ results: [] satisfies SearchPlayerResult[] });
  if (!(await claim("search"))) return errorJson("rate_limited");
  try {
    const pool = await longShotSearchPool(g.admin);
    const rows = await searchFantasyPlayers(g.admin, {
      query,
      positions: ELIGIBLE_POSITIONS,
      limit: RESULT_CAP,
      pool,
    });
    const results: SearchPlayerResult[] = rows.slice(0, RESULT_CAP).map((r) => ({
      id: r.id,
      name: r.full_name ?? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
      position: r.position,
      team: r.team,
      sleeperId: readSleeperId(r.external_ids as Record<string, unknown> | null),
    }));
    if (results.length < RESULT_CAP) {
      const history = await searchHistoryPlayers(g.admin, query, RESULT_CAP - results.length, pool);
      results.push(...history);
    }
    return privateJson({ results });
  } catch (err) {
    return handleRouteError(err, "search");
  }
}
