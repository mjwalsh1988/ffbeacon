import { searchFantasyPlayers } from "@/lib/player-search";
import { readSleeperId } from "@/lib/ranking-boards";
import { claim, errorJson, guardRequest, handleRouteError, privateJson } from "@/lib/long-shot/route-helpers";
import { longShotSearchPool } from "@/lib/long-shot/search-pool";
import { ELIGIBLE_POSITIONS } from "@/lib/long-shot/types";
import type { SearchPlayerResult } from "@/components/player-guess-combobox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_QUERY_LENGTH = 50;
const MIN_QUERY_LENGTH = 2;
const RESULT_CAP = 8;

/**
 * GET /api/games/long-shot/search?q= (plan 17.5)
 *
 * The Signal Scout search route's hardening, but signed-in only (the demo
 * never calls it) and drawn from the Long Shot pool: every QB, RB, WR or TE
 * with a stat line since 2020, so a retired player who answers a historical
 * prompt can be typed. Round-independent public player data only.
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
    return privateJson({ results });
  } catch (err) {
    return handleRouteError(err, "search");
  }
}
