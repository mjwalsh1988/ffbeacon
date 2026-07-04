import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { currentNflSeason } from "@/lib/sleeper";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { loadRankedBoard } from "@/lib/on-the-clock/board-loader";
import { adpFormatKeyCandidates, attachAdpToPlayers } from "@/lib/on-the-clock/adp";
import { resolveAdpSnapshot } from "@/lib/on-the-clock/history-lookup";
import type { PlayerPool } from "@/lib/on-the-clock/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/board?format=<slug>&pool=<everyone|rookies>
 *
 * READ-ONLY. Returns the FF Beacon ranked board for a format. The value SOURCE is
 * forced to FF Beacon inside loadRankedBoard (On The Clock never uses the global
 * source selector); the FORMAT comes from the league's auto-detected slug (the
 * client passes the LeagueCard.formatSlug). No Sleeper call. The board is the same
 * for every viewer of a format, so player ids and values are public data.
 *
 * Each player also carries the latest Sleeper ADP for the format's market key
 * (player_market_snapshots, the nightly ingestion). `pool` only influences which
 * ADP market leads the candidate list (rookie drafts prefer Sleeper's rookie ADP
 * when it has data); it does not filter the returned players.
 *
 * Header-guarded + feature-gated like the other On The Clock routes.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

// Format slugs are lowercase kebab (e.g. "dynasty-ppr-sflex"); reject anything else
// before a DB lookup. The loader also validates existence against format_configs.
const FORMAT_SLUG_RE = /^[a-z0-9-]{1,64}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "";
  if (!FORMAT_SLUG_RE.test(format)) {
    return json({ error: "Invalid format." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  const poolParam = url.searchParams.get("pool");
  const pool: PlayerPool = poolParam === "rookies" ? "rookies" : "everyone";

  const board = await loadRankedBoard(admin, {
    formatSlug: format,
    rookieSeason: currentNflSeason(),
  });

  // Attach the latest Sleeper ADP for this format's market. Best-effort: an ADP
  // outage degrades to a board with adp null everywhere, never a failed board.
  if (board.status === "ok") {
    try {
      const adp = await resolveAdpSnapshot(admin, {
        keyCandidates: adpFormatKeyCandidates(board.formatSlug, pool),
        targetDate: null,
        completedAtMs: null,
        draftStartAtMs: null,
      });
      board.players = attachAdpToPlayers(board.players, adp.adpBySleeperId);
      board.adpFormatKey = adp.adpKey;
      board.adpSnapshotDate = adp.snapshotDate;
    } catch (err) {
      console.error("[on-the-clock/board] ADP attach failed", err);
      board.adpFormatKey = null;
      board.adpSnapshotDate = null;
    }
  }

  return json({ ok: true, board });
}
