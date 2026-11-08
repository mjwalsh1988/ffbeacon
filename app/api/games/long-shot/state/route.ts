import { loadPageState } from "@/lib/long-shot/page-state";
import { claim, errorJson, guardRequest, handleRouteError, privateJson } from "@/lib/long-shot/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/games/long-shot/state (plan 17.1)
 *
 * The signed-in page state, through the same loader the page renders with.
 * Never generates a puzzle. Heals a completed Hurry-Up whose stats write
 * never landed.
 */
export async function GET(req: Request) {
  const g = await guardRequest(req);
  if (!g.ok) return g.response;
  if (!(await claim("state"))) return errorJson("rate_limited");
  try {
    const state = await loadPageState(g.admin, g.userId, g.today, g.settings);
    return privateJson({ state });
  } catch (err) {
    return handleRouteError(err, "state");
  }
}
