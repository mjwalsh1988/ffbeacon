import { z } from "zod";
import { loadAttempt, submitAnswer } from "@/lib/long-shot/attempt";
import {
  claim,
  errorJson,
  guardRequest,
  handleRouteError,
  privateJson,
  readJson,
  uuidSchema,
} from "@/lib/long-shot/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  position: z.number().int().min(1).max(5),
  playerId: z.string().uuid().nullable(),
  timedOut: z.boolean().default(false),
  skipped: z.boolean().default(false),
});

/**
 * POST /api/games/long-shot/attempt/[id]/answer (plan 17.4)
 *
 * Ownership (404), active (409 attempt_closed), position and pending (409
 * stale_prompt), then the rate claim, then the server clock and scoring. The
 * response never carries the next prompt's text and never creates its row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardRequest(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return errorJson("not_found");
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson("invalid_request");
  try {
    const attempt = await loadAttempt(g.admin, id, g.userId);
    const result = await submitAnswer(g.admin, attempt, parsed.data, g.settings, g.today, () => claim("answer"));
    return privateJson({ result });
  } catch (err) {
    return handleRouteError(err, "answer");
  }
}
