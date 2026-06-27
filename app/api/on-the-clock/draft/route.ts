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
 * READ-ONLY. Returns the shaped draft + picks straight from the Supabase cache,
 * with NO Sleeper call on the normal path. This is what loads on navigation and
 * what Realtime supplements.
 *
 * The ONE exception is a cold cache (no draft row yet): it transparently performs
 * a single warm sync through the SAME durable lock as the POST sync route, then
 * returns the freshly warmed cache. A warm draft never triggers a Sleeper call.
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

  // Warm path: read the cache directly, no Sleeper.
  let cache = await readDraftCache(admin, draftId);

  // Cold path only: warm the cache once through the lock (same path as POST sync).
  if (!cache) {
    const outcome = await performDraftSync(admin, {
      draftId,
      cooldownSeconds: settings.sync.cooldownSeconds,
      lockSeconds: settings.sync.lockSeconds,
    });
    cache = outcome.cache;
    if (!cache) {
      return json({ error: "We could not load that draft." }, 404);
    }
  }

  return json({ ok: true, cache });
}
