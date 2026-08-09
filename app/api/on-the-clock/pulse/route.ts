import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getTrustedClientIp } from "@/lib/client-ip";
import { claimPulseBudget, PULSE_BUDGET_WINDOW_SECONDS } from "@/lib/on-the-clock/cache";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import {
  getPulsePayload,
  MAX_MARGINAL_CANDIDATES_CEILING,
} from "@/lib/on-the-clock/pulse-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/on-the-clock/pulse
 *
 * Draft Pulse for every team in a draft, per-player projection summaries for
 * board enrichment, and the marginal starting-lineup value of the candidates the
 * caller names.
 *
 * POST rather than GET because the marginal half is a function of WHO is asking
 * (their roster) and WHAT is still on the board (up to 160 player ids). Those do
 * not belong in a query string, and the response is per-caller anyway.
 *
 * Nothing here is trusted from the body except as a filter. The roster contents,
 * the projections, the league's scoring, and the slot model all come from the
 * server's own cache. A caller can ask about players; it cannot assert anything
 * about them. `myRosterId` only selects which cached roster to measure against,
 * and every roster in a draft is already public through the board.
 *
 * No Sleeper call on the hot path: the NFL state fetch behind resolveFromWeek is
 * memoized for ten minutes, and everything else is Supabase plus arithmetic.
 *
 * Rate limited on its own budget rather than the shared Sleeper one. This route
 * spends CPU, not Sleeper quota: up to 160 candidates each rebuilt across every
 * remaining week. The ceiling is deliberately far above what a real draft room
 * generates (it refetches once per pick, from a handful of tabs) so it only ever
 * bites a script.
 */

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

const DRAFT_ID_RE = /^[0-9]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hard ceiling on survivor ids accepted, so a body cannot be used as a payload. */
const MAX_SURVIVORS = 800;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function idList(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  // Reject rather than iterate. Capping the ACCEPTED count still walks and
  // regex-tests every entry of an all-invalid array, which turns a few hundred
  // kilobytes of body into hundreds of thousands of tests.
  if (raw.length > cap * 4) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !UUID_RE.test(v)) continue;
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

function intOrNull(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function POST(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Invalid request body." }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  if (!DRAFT_ID_RE.test(draftId)) {
    return json({ error: "Invalid draft." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  // Fails CLOSED: a throttle that cannot answer must not open the door.
  let withinBudget: boolean;
  try {
    withinBudget = await claimPulseBudget(admin, getTrustedClientIp(req));
  } catch (err) {
    console.error("[on-the-clock/pulse] rate-limit guard failed", err);
    withinBudget = false;
  }
  if (!withinBudget) {
    return json(
      {
        error: `Too many projection requests from your network. Try again in ${PULSE_BUDGET_WINDOW_SECONDS} seconds.`,
      },
      429,
    );
  }

  const rosterId = intOrNull(body.myRosterId);

  try {
    const payload = await getPulsePayload(admin, {
      draftId,
      includePreDraftRoster: body.includePreDraftRoster === true,
      myRosterId: rosterId,
      // The admin's cap, not a module constant, so raising it in
      // /admin/on-the-clock actually raises it here rather than being silently
      // truncated to a different number the payload then misreports.
      candidateIds: idList(
        body.candidateIds,
        Math.min(settings.marginal.maxCandidates, MAX_MARGINAL_CANDIDATES_CEILING),
      ),
      survivorIds: Array.isArray(body.survivorIds)
        ? idList(body.survivorIds, MAX_SURVIVORS)
        : null,
      nextPickNo: intOrNull(body.nextPickNo),
      picksUntilNext: intOrNull(body.picksUntilNext),
      // A cache hint, nothing more: an etag that does not match simply means the
      // per-player map is sent. Length-capped so a body cannot smuggle bulk.
      knownBoardEtag:
        typeof body.boardEtag === "string" && body.boardEtag.length <= 128
          ? body.boardEtag
          : null,
      maxCandidates: settings.marginal.maxCandidates,
      marginalSettings: {
        insuranceWeight: settings.marginal.insuranceWeight,
        dropoffWeight: settings.marginal.dropoffWeight,
        minStarterRisk: settings.marginal.minStarterRisk,
      },
    });
    if (!payload) {
      return json({ error: "That draft has not been synced yet." }, 404);
    }
    return json({ ok: true, pulse: payload });
  } catch (err) {
    // A projection outage must degrade the room, never break it: the client
    // renders every value-based panel exactly as it did before Draft Pulse
    // existed when this returns an error.
    console.error("[on-the-clock/pulse] failed", err);
    return json({ error: "Projections are unavailable right now." }, 503);
  }
}
