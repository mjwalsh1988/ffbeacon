import { endFilmRoomAttempt, loadAttempt } from "@/lib/long-shot/attempt";
import { loadPageState } from "@/lib/long-shot/page-state";
import {
  claim,
  errorJson,
  guardRequest,
  handleRouteError,
  privateJson,
  uuidSchema,
} from "@/lib/long-shot/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/games/long-shot/attempt/[id]/end (plan 17.3a)
 *
 * End practice: Film Room only (400 not_film_room for a Hurry-Up). Returns
 * the page state so the client lands back on the right main panel.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardRequest(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return errorJson("not_found");
  if (!(await claim("next"))) return errorJson("rate_limited");
  try {
    const attempt = await loadAttempt(g.admin, id, g.userId);
    await endFilmRoomAttempt(g.admin, attempt);
    const state = await loadPageState(g.admin, g.userId, g.today, g.settings);
    return privateJson({ state });
  } catch (err) {
    return handleRouteError(err, "end");
  }
}
