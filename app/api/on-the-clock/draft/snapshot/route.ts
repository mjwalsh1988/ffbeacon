import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { claimLookup, claimIpBudget } from "@/lib/on-the-clock/cache";
import { getOrCreateDraftSnapshot } from "@/lib/on-the-clock/draft-snapshot";
import { isValidDraftId } from "@/lib/on-the-clock/validation";
import { getTrustedClientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/on-the-clock/draft/snapshot?draft_id=&format=&league_name=
 *
 * Snapshot mode entry point for completed drafts. Returns the finalized draft
 * snapshot, creating it on first open (the one-time historical resolution +
 * Sleeper trade fetch). Once a snapshot exists this route is a single DB read;
 * completed-draft results never change afterwards.
 *
 * `format` is the client's detected LeagueCard.formatSlug hint (validated
 * against the slug shape; the finalizer validates existence). `league_name` is
 * a display-only hint (sanitized, public Sleeper data).
 *
 * Throttling: serving an existing snapshot is unthrottled (cheap DB read). The
 * CREATE path fans out to Sleeper (transactions walk), so it sits behind the
 * shared durable per-(ip, draft) claim, matching the transactions route.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

const FORMAT_SLUG_RE = /^[a-z0-9-]{1,64}$/;
const LOOKUP_WINDOW_SECONDS = 10;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/** Display-only league name hint: trimmed, control characters out, capped. */
function sanitizeLeagueName(raw: string | null): string | null {
  if (!raw) return null;
  let cleaned = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) cleaned += ch;
  }
  cleaned = cleaned.trim().slice(0, 100);
  return cleaned || null;
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
  const formatRaw = url.searchParams.get("format") ?? "";
  const formatSlug = FORMAT_SLUG_RE.test(formatRaw) ? formatRaw : null;
  const leagueName = sanitizeLeagueName(url.searchParams.get("league_name"));

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  // Existing snapshots serve unthrottled; only creation fans out to Sleeper.
  const { data: existingRow, error: existsErr } = await admin
    .from("on_the_clock_draft_snapshots")
    .select("sleeper_draft_id")
    .eq("sleeper_draft_id", draftId)
    .maybeSingle();
  if (existsErr) {
    return json({ error: "Try again in a moment." }, 503);
  }

  if (!existingRow) {
    // Only the CREATE path fans out to Sleeper, so the guards live here. Per-IP budget
    // (FFB-SEC-002) first, then the per-(ip, draft) cooldown. Fail closed.
    const ip = getTrustedClientIp(req);
    let allowed: boolean;
    try {
      allowed =
        (await claimIpBudget(admin, ip)) &&
        (await claimLookup(admin, {
          ip,
          username: `snap:${draftId}`,
          windowSeconds: LOOKUP_WINDOW_SECONDS,
        }));
    } catch (err) {
      console.error("[on-the-clock/draft/snapshot] rate-limit guard failed", err);
      return json({ error: "Try again in a moment." }, 503);
    }
    if (!allowed) {
      return json({ error: "Too many lookups. Try again in a few seconds." }, 429);
    }
  }

  const outcome = await getOrCreateDraftSnapshot(admin, {
    draftId,
    formatSlug,
    leagueName,
    settings,
  });

  switch (outcome.status) {
    case "ready":
      return json({ ok: true, snapshot: outcome.snapshot, created: outcome.created });
    case "not-complete":
      // Not an error: the client falls back to live mode.
      return json({ ok: true, snapshot: null, reason: "not-complete" });
    case "no-board":
      return json({ ok: true, snapshot: null, reason: "no-board" });
    default:
      console.error("[on-the-clock/draft/snapshot] failed", outcome.message);
      return json({ error: "We could not build this draft's results. Try again shortly." }, 500);
  }
}
