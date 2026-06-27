import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { readDraftCache } from "@/lib/on-the-clock/cache";
import { performDraftSync } from "@/lib/on-the-clock/sleeper-sync";
import { isValidDraftId } from "@/lib/on-the-clock/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/draft?draft_id=
 *
 * Returns the shaped draft + picks, auto-refreshing the cache when it is stale.
 * Every load (a fresh visitor opening the league, a page reload, anyone pulling
 * up the same draft) routes through performDraftSync, so the cache re-syncs from
 * Sleeper automatically the moment the per-draft cooldown has elapsed. No manual
 * "Sync draft" press is required to pick up new picks once the lock is clear.
 *
 * The cooldown lock is the rate limiter: it is checked inside the claim RPC
 * BEFORE any Sleeper call, so a draft synced within the cooldown window returns
 * straight from the cache with zero Sleeper traffic, and concurrent opens collapse
 * to a single Sleeper fetch. A cold cache (no draft row yet) warms on first load.
 *
 * We read the existing cache first so the auto-resync can claim the lock with the
 * known league_id/season (no Sleeper pre-fetch on the warm-and-fresh path).
 *
 * Response: private, no-store.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  const url = new URL(req.url);
  const draftId = url.searchParams.get("draft_id") ?? "";
  if (!isValidDraftId(draftId)) {
    return json({ error: "Invalid draft id." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  // Read the existing cache first (no Sleeper). This serves as the league_id/season
  // hint so the auto-resync can claim the lock without a Sleeper pre-fetch on the
  // warm-and-fresh path, and as the fallback shape if the sync attempt yields none.
  const existing = await readDraftCache(admin, draftId);

  // Auto-resync through the durable lock. When the cooldown has elapsed (or the
  // cache is cold) this fetches Sleeper and refreshes the cache; when the draft was
  // synced within the cooldown window the claim is denied inside the RPC and the
  // current cache is returned with no Sleeper call.
  const outcome = await performDraftSync(admin, {
    draftId,
    leagueId: existing?.draft.sleeperLeagueId,
    season: existing?.draft.season,
    cooldownSeconds: settings.sync.cooldownSeconds,
    lockSeconds: settings.sync.lockSeconds,
  });

  const cache = outcome.cache ?? existing;
  if (!cache) {
    return json({ error: "We could not load that draft." }, 404);
  }

  return json({ ok: true, cache });
}
