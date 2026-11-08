import { z } from "zod";
import { startAttempt } from "@/lib/long-shot/attempt";
import {
  claim,
  errorJson,
  guardRequest,
  handleRouteError,
  privateJson,
  readJson,
} from "@/lib/long-shot/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The one inline generation path (plan 6): when the 17:00 UTC cron failed,
// the first Hurry-Up start of the day builds the puzzle here.
export const maxDuration = 60;

const bodySchema = z.object({ mode: z.enum(["hurry_up", "film_room"]) });

/**
 * POST /api/games/long-shot/attempt  body { mode } (plan 17.2)
 *
 * Starts an attempt and serves position 1. 409 attempt_active when one is
 * running (the client resumes it). A Hurry-Up start for a day already played
 * returns that day's attempt with no error.
 */
export async function POST(req: Request) {
  const g = await guardRequest(req);
  if (!g.ok) return g.response;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson("invalid_request");
  if (!(await claim("start"))) return errorJson("rate_limited");
  try {
    const result = await startAttempt(g.admin, g.userId, parsed.data.mode, g.settings, g.today);
    return privateJson({ result });
  } catch (err) {
    return handleRouteError(err, "start");
  }
}
