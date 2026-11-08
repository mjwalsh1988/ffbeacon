import { loadAttempt, serveNext } from "@/lib/long-shot/attempt";
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
 * POST /api/games/long-shot/attempt/[id]/next (plan 17.3)
 *
 * Serve the prompt at the attempt's current position, starting its clock if
 * it has none yet. An attempt that is not the caller's is 404, never 403, so
 * an id cannot be probed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardRequest(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return errorJson("not_found");
  if (!(await claim("next"))) return errorJson("rate_limited");
  try {
    const attempt = await loadAttempt(g.admin, id, g.userId);
    const result = await serveNext(g.admin, attempt, g.settings, g.today);
    return privateJson({ result });
  } catch (err) {
    return handleRouteError(err, "next");
  }
}
