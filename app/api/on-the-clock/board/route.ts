import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { currentNflSeason } from "@/lib/sleeper";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { loadRankedBoard } from "@/lib/on-the-clock/board-loader";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/board?format=<slug>
 *
 * READ-ONLY. Returns the FF Beacon ranked board for a format. The value SOURCE is
 * forced to FF Beacon inside loadRankedBoard (On The Clock never uses the global
 * source selector); the FORMAT comes from the league's auto-detected slug (the
 * client passes the LeagueCard.formatSlug). No Sleeper call. The board is the same
 * for every viewer of a format, so player ids and values are public data.
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

  const board = await loadRankedBoard(admin, {
    formatSlug: format,
    rookieSeason: currentNflSeason(),
  });

  return json({ ok: true, board });
}
