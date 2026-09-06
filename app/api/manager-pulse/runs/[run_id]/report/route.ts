import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";
import { claimManagerPulseRunPollSlot } from "@/lib/manager-pulse/run-poll-rate-limit";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/manager-pulse/runs/[run_id]/report
 *
 * The report itself for one Manager Pulse run, either the final one from
 * manager_pulse_cache once the run has completed, or the newest partial one
 * from manager_pulse_live_reports while it is still capturing
 * (docs/manager-pulse/manager-pulse-plan.md section 4.5). The client component polls the
 * progress route to know something changed, then fetches here to read it.
 *
 * SECURITY, and every line of this is load-bearing (section 9), the same as
 * the progress route at app/api/manager-pulse/runs/[run_id]/route.ts, copied
 * rather than shared through a helper (a helper is how an ownership check
 * gets accidentally skipped later):
 *   - The session is resolved server-side, with the user-scoped client. A
 *     signed-out caller gets 401. No user id is ever accepted from the
 *     request; only the session decides who is asking.
 *   - The run id is an IDOR surface: it names another table's primary key,
 *     and manager_pulse_runs holds one row per lookup any signed-in user has
 *     ever made. The row is read ONCE with the SERVICE-ROLE client (bypassing
 *     manager_pulse_runs_select_own on purpose), carrying status, seasons and
 *     handle alongside id and user_id, and ownership is then checked here,
 *     explicitly, against the signed-in session's own user id, on that SAME
 *     row. A second, unchecked read of the same table would let the
 *     ownership check and the data it gates drift apart. A mismatch returns
 *     404, never 403: a 403 would confirm to the caller that someone else's
 *     run exists at that id, and a 404 does not.
 *   - The run id is validated as a uuid before it ever reaches a query, so a
 *     malformed id fails the same way a well-formed but unknown one does.
 *   - Only after that check passes does the route read the report, and it
 *     reads with the SERVICE-ROLE client. The report document is the
 *     reader's own request's subject, which they are entitled to see; the
 *     ownership check on the RUN is what stops enumeration of other people's
 *     lookups.
 *   - Rate limited AFTER the ownership check, sharing one bucket with the
 *     progress route (lib/manager-pulse/run-poll-rate-limit.ts), so a stale
 *     link or a forged run id costs a reader nothing from that budget. The
 *     limit fails OPEN on its own outage, the same reasoning as the progress
 *     route: a reader waiting on a report must not see an error page because
 *     a rate limit check failed.
 *   - This is per-user, point-in-time state, never a stable resource, so the
 *     response always carries Cache-Control: no-store.
 *   - The response echoes nothing the client sent.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ run_id: string }> },
) {
  const { run_id: runId } = await params;

  if (!runId || !UUID_PATTERN.test(runId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to check this run." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createAdminClient();

  const { data: run, error } = await admin
    .from("manager_pulse_runs")
    .select("id, user_id, status, sleeper_user_id, season_from, season_to")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    console.error("[manager-pulse] run lookup failed", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }

  // A mismatch and a missing row produce the same response, on purpose:
  // telling them apart would confirm that a run belonging to someone else
  // exists at this id.
  if (!run || run.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const settings = await loadManagerPulseSettings(admin);

  const allowed = await claimManagerPulseRunPollSlot(user.id, settings.sync.pollIntervalMs);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Slow down and try again shortly." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  if (run.status === "complete") {
    const { data: cached } = await admin
      .from("manager_pulse_cache")
      .select("report, generated_at, league_seasons_counted")
      .eq("sleeper_user_id", run.sleeper_user_id)
      .eq("season_from", run.season_from)
      .eq("season_to", run.season_to)
      .eq("model_version", settings.modelVersion)
      .maybeSingle();

    if (!cached) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      {
        final: true,
        version: -1,
        coverage: cached.league_seasons_counted,
        coverageTotal: cached.league_seasons_counted,
        computedAt: cached.generated_at,
        report: cached.report,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  const { data: live } = await admin
    .from("manager_pulse_live_reports")
    .select("report, coverage, coverage_total, version, computed_at")
    .eq("sleeper_user_id", run.sleeper_user_id)
    .eq("season_from", run.season_from)
    .eq("season_to", run.season_to)
    .eq("model_version", settings.modelVersion)
    .maybeSingle();

  if (!live) {
    return NextResponse.json(
      { final: false, version: 0, coverage: 0, coverageTotal: 0, computedAt: null, report: null },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      final: false,
      version: live.version,
      coverage: live.coverage,
      coverageTotal: live.coverage_total,
      computedAt: live.computed_at,
      report: live.report,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
