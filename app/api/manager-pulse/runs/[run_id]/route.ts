import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { readCaptureProgress } from "@/lib/manager-pulse/capture";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/manager-pulse/runs/[run_id]
 *
 * Real, counted progress for one Manager Pulse run
 * (docs/manager-pulse-plan.md sections 4.5 and 7.4). The client-side poller
 * reads this to drive the progress bar and the per-section status list while
 * a capture drains, and to back off and stop once the run reaches a terminal
 * status.
 *
 * SECURITY, and every line of this is load-bearing (section 9):
 *   - The session is resolved server-side, with the user-scoped client. A
 *     signed-out caller gets 401. No user id is ever accepted from the
 *     request; only the session decides who is asking.
 *   - The run id is an IDOR surface: it names another table's primary key,
 *     and manager_pulse_runs holds one row per lookup any signed-in user has
 *     ever made. The row is read with the SERVICE-ROLE client (bypassing
 *     manager_pulse_runs_select_own on purpose), and ownership is then
 *     checked here, explicitly, against the signed-in session's own user id.
 *     A mismatch returns 404, never 403: a 403 would confirm to the caller
 *     that someone else's run exists at that id, and a 404 does not.
 *   - The run id is validated as a uuid before it ever reaches a query, so a
 *     malformed id fails the same way a well-formed but unknown one does.
 *   - This is per-user, point-in-time progress, never a stable resource, so
 *     the response always carries Cache-Control: no-store.
 *   - The response echoes nothing the client sent: only server-computed
 *     status, counts, and a server-written detail string. `detail` is
 *     rendered as text, never as HTML, the same rule every other
 *     server-written status string in this feature holds.
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
    .select("id, user_id")
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

  const progress = await readCaptureProgress(admin, runId);
  if (!progress) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json(
    {
      status: progress.status,
      leaguesTotal: progress.leaguesTotal,
      leaguesDone: progress.leaguesDone,
      leaguesFailed: progress.leaguesFailed,
      sectionStatus: progress.sectionStatus,
      detail: progress.detail,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
