import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { performDraftSync } from "@/lib/on-the-clock/sleeper-sync";
import { isValidDraftId, isValidLeagueId, isValidSeason } from "@/lib/on-the-clock/validation";
import { syncWindows } from "@/lib/on-the-clock/sync-windows";
import {
  claimSyncRequestBudget,
  SYNC_REQUEST_BUDGET_WINDOW_SECONDS,
} from "@/lib/on-the-clock/cache";
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
 * `trigger` says which of the room's two shared windows the caller is spending.
 * "manual" is somebody pressing Sync and claims against the 30s cooldown; "auto"
 * is the room refreshing itself and claims against the longer auto interval, so a
 * roomful of unattended tabs can never collapse into the manual cadence. The
 * window is applied INSIDE claim_on_the_clock_sync, in Postgres, so a client that
 * lies about its trigger buys the manual window at worst, which it already had.
 *
 * The response always reports BOTH windows, computed from the draft's own
 * last_synced_at, so every viewer counts down to the same instant regardless of
 * which trigger they sent or when they opened the room.
 *
 * Always 200 with a status union in the body so the client renders regardless;
 * 400 on bad input, 403 on a missing header, 429 when a single network is asking
 * far past what any real number of draft rooms produces, 500 only on an
 * unexpected throw.
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
  // Anything that is not exactly "auto" is treated as a manual press. An unknown
  // trigger must not silently buy the longer window.
  const trigger: "auto" | "manual" = b.trigger === "auto" ? "auto" : "manual";
  // The stamp of the snapshot the caller already holds. Length-bounded because it
  // is untrusted input; compared as an opaque string and never parsed, so a
  // malformed one simply fails to match and the full cache is sent.
  const knownLastSyncedAt =
    typeof b.known_last_synced_at === "string" && b.known_last_synced_at.length <= 40
      ? b.known_last_synced_at
      : undefined;

  const admin = createAdminClient();

  // A request-count ceiling for this route specifically, ahead of everything else
  // it would otherwise do.
  //
  // The Sleeper fan-out has its own budget further in (claimIpBudget, spent only
  // by a claim that WINS), and that is still the right place for it: twelve tabs
  // on one draft must not each be charged for the one fetch they share. What that
  // budget does not bound is the losing requests, and a room that refreshes itself
  // makes those the common case. Each one costs a settings read, a claim, and,
  // whenever the caller's stamp does not match, a full read of the draft and every
  // pick in it. This caps how many of those one network can ask for.
  //
  // Set far above real use: a dozen viewers on a dozen drafts behind one office
  // or carrier address produce a couple of hundred a minute at most.
  const ip = getTrustedClientIp(req);
  let withinRequestBudget: boolean;
  try {
    withinRequestBudget = await claimSyncRequestBudget(admin, ip);
  } catch {
    withinRequestBudget = false; // fail closed
  }
  if (!withinRequestBudget) {
    return json(
      {
        error: "Too many sync requests from your network. Try again in a minute.",
        retryInSeconds: SYNC_REQUEST_BUDGET_WINDOW_SECONDS,
      },
      429,
    );
  }

  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  const { cooldownSeconds, lockSeconds, autoRefreshEnabled, autoRefreshSeconds } = settings.sync;

  // An automatic refresh against a room whose owner switched the feature off does
  // no work at all: no Sleeper call, no Supabase read, no claim. The flag comes
  // back so a tab that has been open since before the change stops its loop
  // instead of asking again every minute.
  if (trigger === "auto" && !autoRefreshEnabled) {
    return json({
      ok: true,
      status: "served-cache",
      autoRefreshEnabled: false,
      autoRefreshSeconds,
      cooldownRemainingSeconds: 0,
      autoRemainingSeconds: 0,
      lastSyncedAt: null,
      cache: null,
    });
  }

  try {
    const outcome = await performDraftSync(admin, {
      draftId,
      leagueId,
      season,
      // The window the claim is measured against. The automatic refresh spends the
      // longer one; a press spends the short one.
      cooldownSeconds: trigger === "auto" ? autoRefreshSeconds : cooldownSeconds,
      lockSeconds,
      ipKey: ip,
      knownLastSyncedAt,
    });
    // Identifier-independent per-IP Sleeper fan-out budget exhausted (FFB-SEC-002).
    if (outcome.status === "rate-limited") {
      return json(
        {
          error: outcome.error ?? "Too many draft lookups from your network. Try again in a minute.",
          cache: outcome.cache,
          retryInSeconds: outcome.cooldownRemainingSeconds,
          autoRefreshEnabled,
          autoRefreshSeconds,
        },
        429,
      );
    }
    // Recomputed from the draft's stamp rather than passed through: the claim RPC
    // reports its remainder against whichever window THIS caller claimed, and the
    // room needs both, on the same clock, whatever the trigger was.
    const windows = syncWindows(outcome.lastSyncedAt, {
      manualCooldownSeconds: cooldownSeconds,
      autoRefreshSeconds,
      nowMs: Date.now(),
    });
    return json({
      ok: outcome.status !== "error",
      status: outcome.status,
      cooldownRemainingSeconds: windows.manualRemainingSeconds,
      autoRemainingSeconds: windows.autoRemainingSeconds,
      autoRefreshEnabled,
      autoRefreshSeconds,
      lastSyncedAt: outcome.lastSyncedAt,
      cache: outcome.cache,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
  } catch (err) {
    console.error("[on-the-clock/draft/sync] unexpected failure", err);
    return json({ error: "Sync failed. Try again shortly." }, 500);
  }
}
