import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSleeperUser, getSleeperLeagues, currentNflSeason } from "@/lib/sleeper";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { claimLookup } from "@/lib/on-the-clock/cache";
import { isValidUsername, isValidSeason, normalizeUsername } from "@/lib/on-the-clock/validation";
import { ffbeaconFormatCandidates, detectLeagueFormat } from "@/lib/on-the-clock/format-detect";
import type { LeagueCard } from "@/lib/on-the-clock/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/leagues?username=&season=
 *
 * Resolve a Sleeper username to its active-draft leagues for a season. This is the
 * Sleeper fan-out surface, so it is guarded three ways before any Sleeper call:
 *   1. header guard (x-requested-with: ff-beacon) - cheap CSRF-lite / bot filter,
 *   2. strict input validation (username + season regexes),
 *   3. a durable per-(ip, username) claim RPC so a rotated-username attack cannot
 *      fan out unbounded Sleeper calls across server instances.
 *
 * To avoid over-hitting Sleeper, league detection uses ONLY the league objects from
 * one getSleeperLeagues call (which carry status + draft_id). We do NOT fan out a
 * per-league drafts fetch: status "drafting" / "pre_draft" plus a present draft_id
 * is a reliable, zero-extra-call signal (Sleeper flips league.status off "drafting"
 * once a draft completes). See ON-THE-CLOCK-PLAN.md section 6.
 *
 * Response: private, no-store, Referrer-Policy: no-referrer (usernames are sensitive
 * even though Sleeper is public). Returns trimmed league cards only.
 */

// The lookup throttle window is an abuse-guard internal, not a user-facing tunable.
const LOOKUP_WINDOW_SECONDS = 10;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Drafting leagues first, then not-yet-started (pre_draft). */
function statusRank(status: string): number {
  if (status === "drafting") return 0;
  if (status === "pre_draft") return 1;
  return 2;
}

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  const url = new URL(req.url);
  const usernameRaw = url.searchParams.get("username") ?? "";
  const seasonRaw = url.searchParams.get("season") ?? currentNflSeason();

  if (!isValidUsername(usernameRaw)) {
    return json({ error: "Enter a valid Sleeper username." }, 400);
  }
  if (!isValidSeason(seasonRaw)) {
    return json({ error: "Invalid season." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  // Durable abuse guard, BEFORE any Sleeper call. normalizeUsername already
  // re-validates, so the non-null assertion is safe after isValidUsername.
  const normalized = normalizeUsername(usernameRaw)!;
  let allowed: boolean;
  try {
    allowed = await claimLookup(admin, {
      ip: clientIp(req),
      username: normalized,
      windowSeconds: LOOKUP_WINDOW_SECONDS,
    });
  } catch (err) {
    // Fail closed: if the guard cannot be evaluated, do not fan out to Sleeper.
    console.error("[on-the-clock/leagues] lookup guard failed", err);
    return json({ error: "Try again in a moment." }, 503);
  }
  if (!allowed) {
    return json({ error: "Too many lookups. Try again in a few seconds." }, 429);
  }

  const user = await getSleeperUser(usernameRaw);
  if (!user) {
    return json({ error: "We could not find a Sleeper user with that name." }, 404);
  }

  const leagues = await getSleeperLeagues(user.user_id, seasonRaw);
  const cap = settings.limits.maxActiveLeagues;

  const candidates = leagues
    .filter(
      (l) =>
        typeof l.draft_id === "string" &&
        l.draft_id.length > 0 &&
        (l.status === "drafting" || l.status === "pre_draft"),
    )
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));

  const truncated = candidates.length > cap;

  // Auto-detect each league's FF Beacon format from the rich Sleeper league object
  // we already fetched above (scoring_settings / roster_positions). This adds ZERO
  // extra Sleeper calls; the candidate list is one Supabase read. On The Clock
  // derives format from the league, never the global toggle (source is forced to
  // FF Beacon downstream).
  const formatCandidates = await ffbeaconFormatCandidates(admin);

  const cards: LeagueCard[] = candidates.slice(0, cap).map((l) => {
    const detected = detectLeagueFormat(l, formatCandidates);
    return {
      leagueId: l.league_id,
      draftId: l.draft_id as string,
      season: l.season,
      name: l.name,
      totalRosters: l.total_rosters,
      avatar: l.avatar ?? null,
      draftStatus: l.status,
      formatSlug: detected?.slug ?? null,
      formatLabel: detected?.label ?? null,
      formatDerivedLabel: detected?.derivedLabel ?? null,
      formatIsClosest: detected?.isClosest ?? false,
    };
  });

  // userId is the resolved Sleeper user_id (public data). The client uses it to
  // detect the connected user's team/picks inside the room (My Draft, "your turn",
  // "Your pick" markers). Additive field; existing fields unchanged.
  return json({ ok: true, season: seasonRaw, userId: user.user_id, leagues: cards, truncated });
}
