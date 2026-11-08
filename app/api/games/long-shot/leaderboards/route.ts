import { z } from "zod";
import { boardSchema, loadLeaderboardView, MAX_PAGE } from "@/lib/long-shot/leaderboards";
import { claim, errorJson, guardRequest, handleRouteError, privateJson } from "@/lib/long-shot/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  board: boardSchema.default("daily"),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * GET /api/games/long-shot/leaderboards?board=&page=&date= (plan 17.7)
 *
 * Signed-in only. `date` is used by the daily board alone and must be today
 * or earlier. 503 leaderboards_disabled when the boards are paused.
 */
export async function GET(req: Request) {
  const g = await guardRequest(req);
  if (!g.ok) return g.response;
  if (!g.settings.leaderboards.enabled) return errorJson("leaderboards_disabled");
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    board: url.searchParams.get("board") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) return errorJson("invalid_request");
  const date = parsed.data.date ?? g.today;
  if (date > g.today) return errorJson("invalid_request");
  if (!(await claim("boards"))) return errorJson("rate_limited");
  try {
    const view = await loadLeaderboardView(g.admin, g.settings, parsed.data.board, parsed.data.page, date, g.today, g.userId);
    return privateJson({ view });
  } catch (err) {
    return handleRouteError(err, "leaderboards");
  }
}
