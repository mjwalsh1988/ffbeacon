import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { loadRankingBuilderSettings } from "@/lib/ranking-boards/settings";
import { deleteExpiredGuestBoards } from "@/lib/ranking-boards/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ranking-guest-cleanup
 *
 * Deletes Beacon Ranker guest boards once they have gone unchanged for the
 * retention time (48 hours by default, /admin/beacon-ranker). The tool page
 * states that time to every guest before their first question, so this job is
 * what keeps the page honest.
 *
 * Iterates guest ROWS by age through one index. It is not the per-league cron
 * the League Pulse rules forbid: it never reads a league, and a signed-in
 * reader's boards are in a different table it cannot touch.
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
    const result = await recordCronRun(admin, "ranking-guest-cleanup", async () => {
      const settings = await loadRankingBuilderSettings(admin);
      const deleted = await deleteExpiredGuestBoards(admin, settings.guests.retentionHours);
      return { deleted, retentionHours: settings.guests.retentionHours };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/ranking-guest-cleanup] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
