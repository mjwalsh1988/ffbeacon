import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  ensureSleeperUserId,
  loadSavedSleeperHandle,
} from "@/lib/sleeper-handle/resolve";
import type { SavedSleeperHandle } from "@/lib/sleeper-handle/types";
import { getSleeperUser, getSleeperLeagues, currentNflSeason } from "@/lib/sleeper";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { claimLookup, claimIpBudget } from "@/lib/on-the-clock/cache";
import { isValidUsername, isValidSeason, normalizeUsername } from "@/lib/on-the-clock/validation";
import { getTrustedClientIp } from "@/lib/client-ip";
import { ffbeaconFormatCandidates, detectLeagueFormat } from "@/lib/on-the-clock/format-detect";
import { deriveKeeperStyle } from "@/lib/sleeper-to-format";
import type { LeagueCard } from "@/lib/on-the-clock/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/leagues?username=&season=
 * GET /api/on-the-clock/leagues?saved=1&season=
 *
 * Resolve a Sleeper username to its active-draft leagues for a season. This is the
 * Sleeper fan-out surface, so it is guarded three ways before any Sleeper call:
 *   1. header guard (x-requested-with: ff-beacon) - cheap CSRF-lite / bot filter,
 *   2. strict input validation (username + season regexes),
 *   3. a durable per-(ip, username) claim RPC so a rotated-username attack cannot
 *      fan out unbounded Sleeper calls across server instances.
 *
 * SAVED MODE (`saved=1`) is the auto-run a tool page performs for a signed-in
 * reader who saved a Sleeper handle. The handle comes from the SESSION, read
 * server-side through `loadSavedSleeperHandle`; the client never sends it, so
 * there is nothing in the query string for a caller to forge and no way to ask
 * this route about somebody else's saved identity. No session, or a session with
 * nothing saved, is a 401. Every guard above still runs, in the same order, on
 * the username the session produced.
 *
 * Saved mode also spends ONE Sleeper call instead of two: the saved identity
 * carries the `sleeper_user_id` resolved at save time, so `getSleeperUser` is
 * skipped entirely. A row saved before that id existed gets it filled in once
 * by `ensureSleeperUserId`, and every later visit is back to one call.
 *
 * To avoid over-hitting Sleeper, league detection uses ONLY the league objects from
 * one getSleeperLeagues call (which carry status + draft_id). We do NOT fan out a
 * per-league drafts fetch. Every league with a draft id is returned, staged for
 * the picker: actively drafting first, then pre-draft, then completed/in-season
 * drafts (openable for after-the-fact review; those load in snapshot mode).
 * Each stage is capped independently at the maxActiveLeagues limit.
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

/** Picker stage for a Sleeper league status. Anything past pre_draft/drafting
 * (in_season, complete, post_season, ...) means the draft already happened. */
function stageOf(status: string): "drafting" | "pre_draft" | "completed" {
  if (status === "drafting") return "drafting";
  if (status === "pre_draft") return "pre_draft";
  return "completed";
}

const STAGE_ORDER = { drafting: 0, pre_draft: 1, completed: 2 } as const;

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  const url = new URL(req.url);
  const savedMode = url.searchParams.get("saved") === "1";
  const seasonRaw = url.searchParams.get("season") ?? currentNflSeason();

  // In saved mode the identity comes from the session and the `username` param
  // is ignored entirely, so a caller cannot smuggle one in beside `saved=1`.
  let saved: SavedSleeperHandle | null = null;
  let sessionClient: Awaited<ReturnType<typeof createClient>> | null = null;
  if (savedMode) {
    sessionClient = await createClient();
    saved = await loadSavedSleeperHandle(sessionClient);
    if (!saved) {
      return json(
        { error: "Sign in and save your Sleeper username first." },
        401,
      );
    }
  }

  const usernameRaw = saved
    ? saved.username
    : (url.searchParams.get("username") ?? "");

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

  // Durable abuse guards, BEFORE any Sleeper call. First the identifier-independent
  // per-IP budget (FFB-SEC-002) so a rotated-username attack cannot amplify Sleeper
  // fan-out, then the per-(ip, username) cooldown. normalizeUsername already
  // re-validates, so the non-null assertion is safe after isValidUsername.
  const normalized = normalizeUsername(usernameRaw)!;
  const ip = getTrustedClientIp(req);
  let allowed: boolean;
  try {
    // Fail closed: if a guard cannot be evaluated, do not fan out to Sleeper.
    allowed =
      (await claimIpBudget(admin, ip)) &&
      (await claimLookup(admin, {
        ip,
        username: normalized,
        windowSeconds: LOOKUP_WINDOW_SECONDS,
      }));
  } catch (err) {
    console.error("[on-the-clock/leagues] rate-limit guard failed", err);
    return json({ error: "Try again in a moment." }, 503);
  }
  if (!allowed) {
    return json({ error: "Too many lookups. Try again in a few seconds." }, 429);
  }

  // Saved mode already knows the Sleeper user id (D3), so it skips the lookup
  // call. `ensureSleeperUserId` covers the one visit after an older row, and
  // writes the id back through the reader's own session client so the
  // owner-only RLS policy stays the boundary.
  let sleeperUserId: string;
  if (saved && sessionClient) {
    const filled = await ensureSleeperUserId(sessionClient, saved);
    if (!filled.sleeperUserId) {
      return json({ error: "We could not find a Sleeper user with that name." }, 404);
    }
    sleeperUserId = filled.sleeperUserId;
  } else {
    const user = await getSleeperUser(usernameRaw);
    if (!user) {
      return json({ error: "We could not find a Sleeper user with that name." }, 404);
    }
    sleeperUserId = user.user_id;
  }

  const leagues = await getSleeperLeagues(sleeperUserId, seasonRaw);
  const cap = settings.limits.maxActiveLeagues;

  // Every league with a draft id qualifies: active and pre-draft leagues open in
  // live mode; completed/in-season leagues open their finished draft for review
  // (snapshot mode). Each stage is capped independently so a busy in-season
  // account can never crowd out an actively drafting league.
  const candidates = leagues
    .filter((l) => typeof l.draft_id === "string" && l.draft_id.length > 0)
    .sort((a, b) => STAGE_ORDER[stageOf(a.status)] - STAGE_ORDER[stageOf(b.status)]);

  const perStageCount: Record<string, number> = { drafting: 0, pre_draft: 0, completed: 0 };
  const capped: typeof candidates = [];
  let truncated = false;
  for (const l of candidates) {
    const stage = stageOf(l.status);
    if (perStageCount[stage] >= cap) {
      truncated = true;
      continue;
    }
    perStageCount[stage] += 1;
    capped.push(l);
  }

  // Auto-detect each league's FF Beacon format from the rich Sleeper league object
  // we already fetched above (scoring_settings / roster_positions). This adds ZERO
  // extra Sleeper calls; the candidate list is one Supabase read. On The Clock
  // derives format from the league, never the global toggle (source is forced to
  // FF Beacon downstream).
  const formatCandidates = await ffbeaconFormatCandidates(admin);

  const cards: LeagueCard[] = capped.map((l) => {
    const detected = detectLeagueFormat(l, formatCandidates);
    return {
      leagueId: l.league_id,
      draftId: l.draft_id as string,
      season: l.season,
      name: l.name,
      totalRosters: l.total_rosters,
      avatar: l.avatar ?? null,
      draftStatus: l.status,
      stage: stageOf(l.status),
      formatSlug: detected?.slug ?? null,
      formatLabel: detected?.label ?? null,
      formatDerivedLabel: detected?.derivedLabel ?? null,
      formatIsClosest: detected?.isClosest ?? false,
      // Sleeper's own league type, kept separate from the format slug. The slug
      // prices a keeper league off the redraft board, which is right, but the
      // room's copy has to be able to call it a keeper league.
      keeperStyle: deriveKeeperStyle(l),
    };
  });

  // userId is the resolved Sleeper user_id (public data). The client uses it to
  // detect the connected user's team/picks inside the room (My Draft, "your turn",
  // "Your pick" markers). Additive field; existing fields unchanged.
  return json({ ok: true, season: seasonRaw, userId: sleeperUserId, leagues: cards, truncated });
}
