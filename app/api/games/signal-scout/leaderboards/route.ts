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

// Min-interval claim: at most one successful call per identity per N seconds
// (see migration 0131). This is 1 rather than the 2 it shipped with, because
// the game page's leaderboard rail now calls this route from the browser on
// every board switch and page turn; at 2 seconds, a visitor clicking from
// Today to All-Time and on to Streak would be told "too fast" for doing
// nothing unusual. The amplification vector the Phase 5 security review
// flagged (per-user auth admin lookups in lib/user-identity.ts) is separately
// bounded by the 60-second identity cache (cachedResolveIdentities), so the
// claim here is a backstop against scripted loops rather than the primary
// guard, and 1 second still caps a loop at 60 calls/minute/identity. The rail
// additionally caches every (board, page) it has already loaded and retries
// once on a 429, so a human never sees the limit.
const LEADERBOARDS_WINDOW_SECONDS = 1;

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
 * Rate claim: the game page's leaderboard rail
 * (app/games/signal-scout/leaderboard-rail.tsx) calls this route from the
 * browser whenever the visitor switches board or turns a page, so the window
 * has to leave room for ordinary clicking. See LEADERBOARDS_WINDOW_SECONDS
 * below for why it is 1 second and what still bounds the amplification vector
 * the Phase 5 security review flagged.
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
