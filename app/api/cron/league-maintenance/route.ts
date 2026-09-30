import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { runLeagueMaintenance } from "@/lib/league-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/league-maintenance
 *
 * Every 30 minutes. Two bounded jobs (lib/league-maintenance.ts):
 *
 * - Leagues left at `pulse_status = 'syncing'` for over 30 minutes by an
 *   interrupted sync are set back to a retryable `error`, in one UPDATE.
 * - Up to 25 leagues whose last sync ended with Sleeper answering that the
 *   league does not exist get the second look lib/league-removal.ts requires
 *   before it deletes one, through the Sleeper call budget.
 *
 * It does not iterate leagues in general and recomputes no model: Power Pulse,
 * the rankings, Positional WAR and the Manager Ledger stay on demand only.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const admin = createAdminClient();
  try {
    const result = await recordCronRun(admin, "league-maintenance", () =>
      runLeagueMaintenance(admin),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/league-maintenance] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
