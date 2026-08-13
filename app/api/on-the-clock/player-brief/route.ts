import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { loadPlayerBriefs, MAX_BRIEF_PLAYERS } from "@/lib/on-the-clock/player-brief";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/player-brief?format=<slug>&ids=<uuid,uuid>
 *
 * READ-ONLY. Season-end positional finishes for the two players the draft room
 * is recommending right now, in the scoring the league's format uses.
 *
 * The data is public: it is the same finish history the player profile page
 * renders for anyone, and it depends only on scoring, never on who is asking.
 * The route is header-guarded and feature-gated like every other On The Clock
 * route, and the id list is capped so the URL cannot be used to sweep the table.
 *
 * No Sleeper call. One indexed SELECT over at most four player ids.
 */

// Same as every sibling On The Clock route. The payload is public data and
// would be safe to share at the edge, but the client wrapper sends every
// request with `cache: "no-store"` and each viewer already dedupes by
// (format, playerId) in memory, so an s-maxage here would buy an uncertain
// amount of nothing at the cost of being the one route that behaves
// differently. Per-viewer, a player is fetched exactly once.
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

const FORMAT_SLUG_RE = /^[a-z0-9-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Longest `ids` value worth parsing: four 36-character UUIDs and their commas,
 * with headroom. Checked BEFORE the split so a padded query string cannot make
 * us allocate an array to reject it.
 */
const MAX_IDS_PARAM_LENGTH = 160;

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

  // Reject an oversized list rather than truncating it: a caller sending three
  // hundred ids is not a draft room, and regex-testing all of them to keep four
  // is work we should decline to do.
  const idsParam = url.searchParams.get("ids") ?? "";
  if (idsParam.length > MAX_IDS_PARAM_LENGTH) {
    return json({ error: "Too many players requested." }, 400);
  }
  const raw = idsParam.split(",").filter(Boolean);
  if (raw.length > MAX_BRIEF_PLAYERS) {
    return json({ error: "Too many players requested." }, 400);
  }
  const ids = raw.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) {
    return json({ error: "No valid players requested." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  try {
    const result = await loadPlayerBriefs(admin, { formatSlug: format, playerIds: ids });
    if (!result) {
      return json({ error: "Unknown format." }, 400);
    }
    return json({ ok: true, ...result });
  } catch (err) {
    // History is enrichment. Losing it must never cost the room its spotlight,
    // so this is a 503 the client shrugs off rather than an empty answer it
    // would cache as "he has never scored a point".
    console.error("[on-the-clock/player-brief] failed", err);
    return json({ error: "Player history is unavailable right now." }, 503);
  }
}
