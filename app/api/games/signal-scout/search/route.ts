import { createAdminClient } from "@/lib/supabase/server";
import { searchFantasyPlayers } from "@/lib/player-search";
import { readSleeperId } from "@/lib/ranking-boards";
import { loadSignalScoutSettings } from "@/lib/signal-scout/settings";
import {
  requireFfBeaconHeader,
  privateJson,
  resolveRoundIdentity,
  identityKeyFor,
  claimAction,
  engineErrorStatus,
} from "@/lib/signal-scout/route-helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/games/signal-scout/search?q=
 *
 * Player autocomplete for the guessing combobox (plan sections 14 and 15).
 * Wraps searchFantasyPlayers, so results are always the rankings-window pool
 * restricted to the settings-configured eligible positions. This surface is
 * round-INDEPENDENT: it takes no round id and never touches the active round,
 * so it can never leak the target. The returned fields (id, name, position,
 * team, Sleeper headshot id) are public data for arbitrary ranked players.
 *
 * Anti-abuse (mirrors the mutation routes, applied even though this is a GET):
 *   1. same-origin x-requested-with header guard -> 403.
 *   2. min query length: sub-2-char keystrokes short-circuit to an empty
 *      result BEFORE any identity resolution or rate claim, so rapid typing
 *      never spends the caller's per-second search budget.
 *   3. a 1-second windowed claim per identity -> 429 when exceeded. The Phase 4
 *      combobox must debounce at >= 1s (or keep the last results rendered on a
 *      429) so ordinary typing does not trip this.
 *
 * The header guard is uniform across every signal-scout route even on GET;
 * this endpoint is same-origin fetch only, never a top-level navigation.
 */

const SEARCH_WINDOW_SECONDS = 1;
const MAX_QUERY_LENGTH = 50;
const MIN_QUERY_LENGTH = 2;
const RESULT_CAP = 10;

interface SearchResult {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
}

export async function GET(req: Request) {
  if (!requireFfBeaconHeader(req)) {
    return privateJson({ error: "forbidden" }, 403);
  }

  // Cap length before sanitizing, then strip everything that is not a real
  // name character. Commas and parentheses are PostgREST or-filter syntax, so
  // removing them here keeps searchFantasyPlayers' or-filter injection-safe.
  const url = new URL(req.url);
  const rawQuery = (url.searchParams.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);
  const query = rawQuery.replace(/[^\p{L}\p{N} '.\-]/gu, "").trim();
  if (query.length < MIN_QUERY_LENGTH) {
    // Cheap no-op: no identity resolution, no claim spent on a sub-2-char query.
    return privateJson({ results: [] satisfies SearchResult[] });
  }

  try {
    // Identity is used ONLY as the rate-claim key here; a GET never mints or
    // persists a guest cookie. That matters for key selection: a cookie-less
    // caller gets a brand-new guest uuid every request (mintedGuestId !== null),
    // so identityKeyFor would never repeat and the per-second limit would be
    // trivially bypassable. For that case we key the claim on the salted IP
    // hash instead. Guests that already carry a cookie (mintedGuestId === null)
    // keep their per-cookie key, so two guests behind one NAT do not collide.
    const { identity, mintedGuestId } = await resolveRoundIdentity(req);
    const claimKey =
      identity.kind === "guest" && mintedGuestId !== null
        ? `ip:${identity.ipHash}`
        : identityKeyFor(identity);
    const admin = createAdminClient();

    const claimed = await claimAction(
      admin,
      claimKey,
      "search",
      SEARCH_WINDOW_SECONDS,
    );
    if (!claimed) {
      return privateJson({ error: "rate_limited" }, engineErrorStatus("rate_limited"));
    }

    const settings = await loadSignalScoutSettings(admin);
    const eligiblePositions = settings.pool.eligible_positions;
    const eligibleSet = new Set<string>(eligiblePositions);

    const rows = await searchFantasyPlayers(admin, {
      query,
      positions: eligiblePositions,
      limit: RESULT_CAP,
    });

    const results: SearchResult[] = rows
      .filter((r) => r.position != null && eligibleSet.has(r.position))
      .slice(0, RESULT_CAP)
      .map((r) => ({
        id: r.id,
        name: r.full_name ?? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
        position: r.position,
        team: r.team,
        sleeperId: readSleeperId(r.external_ids as Record<string, unknown> | null),
      }));

    return privateJson({ results });
  } catch (err) {
    console.error("[signal-scout] search failed", err);
    return privateJson({ error: "server_error" }, 500);
  }
}
