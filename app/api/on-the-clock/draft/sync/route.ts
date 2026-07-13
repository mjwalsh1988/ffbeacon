import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { performDraftSync } from "@/lib/on-the-clock/sleeper-sync";
import { isValidDraftId, isValidLeagueId, isValidSeason } from "@/lib/on-the-clock/validation";
import { getTrustedClientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

/**
 * POST /api/on-the-clock/draft/sync   body: { draft_id, league_id?, season? }
 *
 * STATE-CHANGING. Delegates the whole flow to performDraftSync (Phase 2), which:
 *   - claims the durable 30s lock BEFORE any Sleeper call (the lock is the rate
 *     limiter; two simultaneous syncs collapse to exactly one Sleeper fetch),
 *   - on a successful claim: fetches Sleeper draft/picks/users/rosters, resolves
 *     player ids once, upserts the cache, completes the lock,
 *   - on a blocked claim (cooldown or another sync in flight): returns the cached
 *     shape with status "cooldown" | "synced-by-other",
 *   - on a Sleeper failure: releases the lock (no cooldown advance) and returns a
 *     safe error plus the existing cache.
 *
 * Passing league_id + season (from the leagues route card) lets the claim happen
 * with no pre-fetch. With only draft_id, performDraftSync resolves them via one
 * getSleeperDraft call. The service role NEVER reaches the client: createAdminClient
 * is used server-side only and only the shaped, whitelisted cache is returned.
 *
 * Always 200 with a status union in the body so the client renders regardless;
 * 400 on bad input, 403 on a missing header, 500 only on an unexpected throw.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const draftId = typeof b.draft_id === "string" ? b.draft_id : "";
  if (!isValidDraftId(draftId)) {
    return json({ error: "Invalid draft id." }, 400);
  }
  // league_id + season are optional, but if present they must be well-formed.
  const leagueId = typeof b.league_id === "string" ? b.league_id : undefined;
  if (leagueId !== undefined && !isValidLeagueId(leagueId)) {
    return json({ error: "Invalid league id." }, 400);
  }
  const season = typeof b.season === "string" ? b.season : undefined;
  if (season !== undefined && !isValidSeason(season)) {
    return json({ error: "Invalid season." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  try {
    const outcome = await performDraftSync(admin, {
      draftId,
      leagueId,
      season,
      cooldownSeconds: settings.sync.cooldownSeconds,
      lockSeconds: settings.sync.lockSeconds,
      ipKey: getTrustedClientIp(req),
    });
    // Identifier-independent per-IP Sleeper fan-out budget exhausted (FFB-SEC-002).
    if (outcome.status === "rate-limited") {
      return json(
        {
          error: outcome.error ?? "Too many draft lookups from your network. Try again in a minute.",
          cache: outcome.cache,
          retryInSeconds: outcome.cooldownRemainingSeconds,
        },
        429,
      );
    }
    return json({
      ok: outcome.status !== "error",
      status: outcome.status,
      cooldownRemainingSeconds: outcome.cooldownRemainingSeconds,
      lastSyncedAt: outcome.lastSyncedAt,
      cache: outcome.cache,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
  } catch (err) {
    console.error("[on-the-clock/draft/sync] unexpected failure", err);
    return json({ error: "Sync failed. Try again shortly." }, 500);
  }
}
