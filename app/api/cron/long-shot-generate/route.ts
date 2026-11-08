import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { addDays, currentEasternGameDate } from "@/lib/game-date";
import { generatePuzzle, type GenerateResult } from "@/lib/long-shot/generate";
import { loadLongShotSettings } from "@/lib/long-shot/settings";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUN_BUDGET_MS = 280_000;

/**
 * GET /api/cron/long-shot-generate, 17:00 UTC daily (plan 6 and 17.6).
 *
 * Builds tomorrow's Long Shot puzzle (noon or 1 PM Eastern the day before,
 * after every table it reads has refreshed), and today's too when a missed
 * night left it empty and nobody has played. A date that already has a row
 * is skipped. The result records every family tried with its parameters,
 * answer count and outcome, the completed week, the rate season and the
 * rate-0 share per prompt, which is what the admin page's try log reads.
 * A short or empty day is reported as a failed step so cron-health sees it.
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
      "long-shot-generate",
      async () => {
        const settings = await loadLongShotSettings(admin);
        const today = currentEasternGameDate();
        const dates = [today, addDays(today, 1)];
        const runs: Array<{ gameDate: string; skipped: true } | GenerateResult> = [];
        const failedSteps: string[] = [];
        for (const gameDate of dates) {
          const { data: existing, error } = await admin
            .from("long_shot_puzzles")
            .select("id")
            .eq("game_date", gameDate)
            .maybeSingle();
          if (error) throw new Error(`puzzle read failed: ${error.message}`);
          if (existing) {
            runs.push({ gameDate, skipped: true });
            continue;
          }
          const run = await generatePuzzle(admin, gameDate, "cron", 0, settings);
          runs.push(run);
          if (run.error === "no_prompts") failedSteps.push(`${gameDate}: no prompt passed its bounds`);
          else if (run.status === "short") failedSteps.push(`${gameDate}: short puzzle, ${run.promptCount} prompts`);
        }
        const allSkipped = runs.every((r) => "skipped" in r && r.skipped === true);
        return { runs, failedSteps, ...(allSkipped ? { skipped: true } : {}) };
      },
      { timeoutMs: RUN_BUDGET_MS },
    );
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[long-shot-generate] failed", err);
    return NextResponse.json({ ok: false, error: "generate failed" }, { status: 500 });
  }
}
