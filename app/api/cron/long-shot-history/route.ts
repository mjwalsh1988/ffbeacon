import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { incrementalFromSeason, syncNflHistory } from "@/lib/long-shot/history/sync";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUN_BUDGET_MS = 280_000;

/**
 * GET /api/cron/long-shot-history, 12:00 UTC on the first of each month
 * (plan 31.3).
 *
 * Keeps the Long Shot history pool current without anyone remembering to:
 * reads the nflverse releases for the current season and the one before it
 * (rosters, the players master, draft picks, weekly stats aggregated per
 * season, the Hall of Fame list), upserts them, then recomputes every touched
 * person's career-wide columns and prominence. Two seasons is small (about
 * 20 MB of CSV and a few thousand rows), so a run fits the budget; the full
 * 1920 load is the script's job and ran once.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  try {
    const result = await recordCronRun(
      admin,
      "long-shot-history",
      async () => {
        const lines: string[] = [];
        const summary = await syncNflHistory(admin, {
          fromSeason: incrementalFromSeason(),
          log: (line) => lines.push(line),
        });
        const failedSteps: string[] = [];
        if (summary.rosterRows === 0) failedSteps.push("no roster rows were published for the window");
        if (summary.wikidata.startsWith("lookup failed")) failedSteps.push(`Wikidata: ${summary.wikidata}`);
        return { ...summary, defunctCodes: summary.defunctCodes.slice(0, 20), lines, failedSteps };
      },
      { timeoutMs: RUN_BUDGET_MS },
    );
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[long-shot-history] failed", err);
    return NextResponse.json({ ok: false, error: "history sync failed" }, { status: 500 });
  }
}
