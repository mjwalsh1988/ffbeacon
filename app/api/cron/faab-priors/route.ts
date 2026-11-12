import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { runFaabPriors, type FaabPriorsRunResult } from "@/lib/faab/priors-incremental";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import {
  buildPickupShowcase,
  offseasonSeasonFor,
  showcaseBuiltAt,
  showcaseDue,
  type ShowcaseBuildResult,
} from "@/lib/waiver-wire/offseason";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stop starting work with this much of the 300-second limit left. */
const RUN_BUDGET_MS = 280_000;
/** The priors pass gets most of the run; the showcase needs well under a minute. */
const PRIORS_BUDGET_MS = 220_000;

type RunResult = FaabPriorsRunResult & {
  showcase: ShowcaseBuildResult | { skipped: string } | null;
};

/**
 * GET /api/cron/faab-priors
 *
 * Hourly. Advances the incremental FAAB priors pass (lib/faab/priors-incremental.ts):
 * re-reads only the leagues whose waiver rows changed since the last completed
 * pass, for this season and last, and rebuilds a season's price cells once its
 * pass completes. A pass that runs out of time resumes on the next tick, and
 * a tick with nothing changed costs a handful of small reads.
 *
 * Moved off /api/cron/recalculate-derived on 2026-11-12, after the weekly
 * full rebuild there pushed that job past its time budget.
 *
 * In the offseason it also refreshes the waiver wire's offseason board
 * (lib/waiver-wire/offseason.ts), at most once a week.
 *
 * Iterates leagues as id batches for aggregates, never per-league model work
 * and never a Sleeper request.
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
    const result = await recordCronRun(
      admin,
      "faab-priors",
      async (): Promise<RunResult> => {
        const started = Date.now();
        const priors = await runFaabPriors(admin, { budgetMs: PRIORS_BUDGET_MS });
        if (priors.wroteCells) revalidateTag(CACHE_TAGS.faabPriors);

        let showcase: RunResult["showcase"] = null;
        const clock = await resolveSeasonClock(admin);
        const season = offseasonSeasonFor(clock);
        if (season === null) {
          showcase = { skipped: "the season is in progress" };
        } else if (!showcaseDue(await showcaseBuiltAt(admin, season), Date.now())) {
          showcase = { skipped: "built within the last week" };
        } else if (Date.now() - started > RUN_BUDGET_MS - 60_000) {
          showcase = { skipped: "no time left in this run" };
        } else {
          showcase = await buildPickupShowcase(admin, season);
          revalidateTag(CACHE_TAGS.waiverShowcase);
        }

        return { ...priors, showcase };
      },
      // No quietWhen: its heartbeat lands only on minute 0 of an hour, and this
      // job ticks at minute 25, so a quiet tick would never be recorded and
      // cron-health would report the job missed. One row an hour is what the
      // other hourly jobs write, and the seven-day retention prunes it.
      { timeoutMs: RUN_BUDGET_MS },
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/faab-priors] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
