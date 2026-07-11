import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { startRound, findActiveRoundId } from "@/lib/signal-scout/round-engine";
import { loadSignalScoutSettings } from "@/lib/signal-scout/settings";
import { currentEasternGameDate } from "@/lib/signal-scout/streaks";
import {
  requireFfBeaconHeader,
  privateJson,
  resolveRoundIdentity,
  identityKeyFor,
  claimAction,
  engineErrorStatus,
  SCOUT_GUEST_COOKIE,
  SCOUT_GUEST_COOKIE_OPTIONS,
} from "@/lib/signal-scout/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/signal-scout/round
 *
 * Starts a new round for the caller's identity (session, else guest
 * cookie). Order of operations (plan section 20 / 15):
 *   1. x-requested-with header guard.
 *   2. Resolve identity (mints a guest cookie id if none exists yet).
 *   3. game_enabled check.
 *   4. guest_play_enabled check (guests only) - not in the plan's original
 *      error list; added because settings.guest_play_enabled exists and
 *      needs a distinct signal from the daily-round-cap 429.
 *   5. Resume check: an existing active round is returned as
 *      active_round_exists WITHOUT spending any claim, so a guest hitting
 *      Start twice never burns a daily-cap slot on a no-op.
 *   6. Rate claim (5s window) for everyone.
 *   7. Guest daily-cap RPC claim (guests only).
 *   8. Engine startRound; a 23505 race resolves to active_round_exists.
 *
 * A freshly minted guest id is set as a cookie on whichever response is
 * ultimately returned, including early error responses from steps 4-8, so
 * the guest keeps a stable identity even on their very first failed call.
 */

const ROUND_START_WINDOW_SECONDS = 5;

export async function POST(req: Request) {
  if (!requireFfBeaconHeader(req)) {
    return privateJson({ error: "forbidden" }, 403);
  }

  const { identity, mintedGuestId } = await resolveRoundIdentity(req);

  function respond(body: unknown, status: number): NextResponse {
    const res = privateJson(body, status);
    if (mintedGuestId) {
      res.cookies.set(SCOUT_GUEST_COOKIE, mintedGuestId, SCOUT_GUEST_COOKIE_OPTIONS);
    }
    return res;
  }

  try {
    const admin = createAdminClient();
    const settings = await loadSignalScoutSettings(admin);

    if (!settings.game_enabled) {
      return respond({ error: "game_disabled" }, engineErrorStatus("game_disabled"));
    }

    if (identity.kind === "guest" && !settings.guest_play_enabled) {
      return respond({ error: "guest_play_disabled" }, engineErrorStatus("guest_play_disabled"));
    }

    const activeRoundId = await findActiveRoundId(admin, identity);
    if (activeRoundId) {
      return respond(
        { error: "active_round_exists", roundId: activeRoundId },
        engineErrorStatus("active_round_exists"),
      );
    }

    const claimed = await claimAction(
      admin,
      identityKeyFor(identity),
      "round_start",
      ROUND_START_WINDOW_SECONDS,
    );
    if (!claimed) {
      return respond({ error: "rate_limited" }, engineErrorStatus("rate_limited"));
    }

    if (identity.kind === "guest") {
      const { data: allowed, error: guestCapError } = await admin.rpc(
        "try_start_signal_scout_guest_round",
        {
          p_guest_id: identity.guestId,
          p_ip_hash: identity.ipHash,
          p_limit: settings.guest_daily_round_limit,
          p_game_date: currentEasternGameDate(),
        },
      );
      if (guestCapError) throw guestCapError;
      if (!allowed) {
        return respond({ error: "guest_limit_reached" }, engineErrorStatus("guest_limit_reached"));
      }
    }

    const result = await startRound(admin, identity);
    if (!result.ok) {
      if (result.code === "active_round_exists") {
        return respond(
          { error: "active_round_exists", roundId: result.existingRoundId },
          engineErrorStatus("active_round_exists"),
        );
      }
      return respond({ error: result.code }, engineErrorStatus(result.code));
    }

    return respond({ round: result.round }, 200);
  } catch (err) {
    console.error("[signal-scout] round start failed", err);
    return respond({ error: "server_error" }, 500);
  }
}
