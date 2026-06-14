import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runCalculateBeaconValues } from "@/lib/calculate-beacon-values";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/recalculate-beacon
 *
 * Recomputes FF Beacon proprietary values (every signal) into
 * player_value_history + draft_pick_values. Scheduled in vercel.json AFTER the
 * three source syncs (07/08/09:00) and BEFORE recalculate-derived (10:00), so
 * the 10:00 job folds the fresh ffbeacon values into rankings + trends.
 *
 * Independent of the source crons: it runs on whatever fresh snapshots exist and
 * is never gated on an upstream sync succeeding (a stale source simply drops out
 * of the blend). Recorded in cron_runs so the admin panel shows its status.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "recalculate-beacon", async () => {
      return runCalculateBeaconValues(supabase);
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/recalculate-beacon] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
