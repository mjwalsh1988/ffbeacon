import { createClient, createAdminClient } from "@/lib/supabase/server";
import { loadSignalScoutSettings } from "@/lib/signal-scout/settings";
import {
  requireFfBeaconHeader,
  privateJson,
  clientIp,
  hashGuestIp,
  claimAction,
  engineErrorStatus,
} from "@/lib/signal-scout/route-helpers";
import { boardSchema, MAX_PAGE, loadLeaderboardView, type Board } from "@/lib/signal-scout/leaderboards";

export const dynamic = "force-dynamic";

const LEADERBOARDS_WINDOW_SECONDS = 2;

/**
 * GET /api/games/signal-scout/leaderboards
 *
 * Thin HTTP layer: header guard, param parsing, settings gates, session
 * resolution, a windowed rate claim, then delegates the board query,
 * page-aware ranks, identity resolution, the your-rank strip, and the
 * total-pages count to lib/signal-scout/leaderboards.ts loadLeaderboardView()
 * (plan section 8). That module is also consumed directly by the
 * app/games/signal-scout/leaderboards server page, so this route and the
 * page share one query implementation.
 *
 * Rate claim: nothing client-side calls this route today (the game page and
 * the leaderboard preview panel both read through lib/signal-scout/leaderboards.ts
 * server-side, not this HTTP endpoint), so the tight 2-second window only
 * affects scripted callers. The limit exists because identity resolution
 * fans out to per-user auth admin lookups (lib/user-identity.ts), which the
 * Phase 5 security review flagged as an amplification vector worth guarding
 * even on a read-only endpoint.
 */
export async function GET(req: Request) {
  if (!requireFfBeaconHeader(req)) {
    return privateJson({ error: "forbidden" }, 403);
  }

  const url = new URL(req.url);

  const boardParsed = boardSchema.safeParse(url.searchParams.get("board") ?? "daily");
  if (!boardParsed.success) {
    return privateJson({ error: "invalid_request" }, 400);
  }
  const board = boardParsed.data;

  const rawPage = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(rawPage)
    ? Math.min(Math.max(Math.trunc(rawPage), 1), MAX_PAGE)
    : 1;

  try {
    const admin = createAdminClient();
    const settings = await loadSignalScoutSettings(admin);
    const { leaderboards } = settings;

    if (!leaderboards.leaderboard_enabled) {
      return privateJson({ error: "leaderboards_disabled" }, 503);
    }
    const perBoardEnabled: Record<Board, boolean> = {
      daily: leaderboards.daily_enabled,
      all_time: leaderboards.all_time_enabled,
      streak: leaderboards.streak_enabled,
    };
    if (!perBoardEnabled[board]) {
      return privateJson({ error: "leaderboards_disabled" }, 503);
    }

    // Session is resolved for isYou flags and the your-rank strip. When
    // require_login is on, a missing session is a hard 401.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (leaderboards.require_login && !user) {
      return privateJson({ error: "login_required" }, 401);
    }
    const meId = user?.id ?? null;

    // Claimed AFTER the settings gates and session resolve, so the
    // require_login 401 still fires without burning a claim. A GET never
    // mints a guest cookie (mirrors app/api/games/signal-scout/search/route.ts),
    // so an anonymous caller is keyed on the salted IP hash rather than a
    // guest id.
    const claimKey = meId ? `user:${meId}` : `ip:${hashGuestIp(clientIp(req))}`;
    const claimed = await claimAction(admin, claimKey, "leaderboards", LEADERBOARDS_WINDOW_SECONDS);
    if (!claimed) {
      return privateJson({ error: "rate_limited" }, engineErrorStatus("rate_limited"));
    }

    const { rows, yourRank, totalPages } = await loadLeaderboardView(
      admin,
      board,
      page,
      meId,
      leaderboards.hide_admin_users,
    );

    return privateJson({ board, page, rows, yourRank, totalPages }, 200);
  } catch (err) {
    console.error("[signal-scout] leaderboards failed", err);
    return privateJson({ error: "server_error" }, 500);
  }
}
