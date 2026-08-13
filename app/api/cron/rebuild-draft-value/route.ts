import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { runBuildRoomAdp } from "@/lib/draft-value/room-adp";
import { runBuildDraftValue } from "@/lib/draft-value/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/rebuild-draft-value
 *
 * Nightly rebuild of the Beacon Steals board. Two stages, in order:
 *   1. draft_market_adp    our own synced rooms, aggregated from the pick ledger
 *   2. draft_value_targets the published board the draft guide renders
 *
 * Stage 1 feeds stage 2 (as the room-agreement confidence input), so they are
 * sequential rather than parallel.
 *
 * Scheduled in vercel.json AFTER every input it reads:
 *   10:00 recalculate-derived     rankings + player_value_trends
 *   11:00 sync-sleeper-market     ADP + season projections
 *   12:00 sync-weekly-projections the weekly stat lines this rescores
 *   15:00 THIS JOB
 *
 * This job does NOT iterate leagues. The board is global, one row per
 * (format, season, player), so it stays the same size whether ten people or ten
 * thousand use the site. Per-league work (power rankings, Power Pulse) stays on
 * demand, per the rules in CLAUDE.md.
 *
 * Stage 1 is best-effort: a room-ADP failure degrades the confidence input but
 * must not stop the board from rebuilding against fresh values and projections.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "rebuild-draft-value", async () => {
      const started = Date.now();

      let roomAdp: unknown;
      try {
        roomAdp = await runBuildRoomAdp(supabase);
      } catch (roomErr) {
        const message = roomErr instanceof Error ? roomErr.message : String(roomErr);
        console.error("[cron/rebuild-draft-value] room ADP stage failed", message);
        roomAdp = { ok: false, error: message };
      }

      const board = await runBuildDraftValue(supabase);

      // A run that built nothing leaves yesterday's board in place, which is a
      // silent staleness rather than a visible failure. Surface it.
      if (board.formatsBuilt === 0) {
        throw new Error("No formats were built; the board would be stale.");
      }

      return { ok: true as const, roomAdp, board, durationMs: Date.now() - started };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/rebuild-draft-value] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
