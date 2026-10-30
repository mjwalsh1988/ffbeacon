import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { loadMarketSignalSettings } from "@/lib/market-signals/settings";
import {
  marketSignalDeps,
  runMarketSignals,
  type MarketSignalsRunResult,
} from "@/lib/market-signals/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stop starting partitions with this much of the 300-second limit left. */
const RUN_BUDGET_MS = 280_000;

/**
 * GET /api/cron/market-signals
 *
 * Market Signals: places every priced player's current value inside a band
 * built from his own last 30 days, per (format, source), and writes one
 * latest row per player to player_value_signals. Plan of record:
 * docs/team-blueprint/team-blueprint-plan.md section 5.
 *
 * Scheduled TWICE, 10:30 and 10:50 UTC. The first entry runs partitions until
 * its deadline; the second finds every partition it finished already stamped
 * and does only what is left, so on a normal night it is a quiet no-op.
 *
 * Iterates (format, source) partitions, never leagues. No RPC, no per-row
 * history update, no sleep.
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
      "market-signals",
      async () => {
        const settings = await loadMarketSignalSettings(admin);
        const out = await runMarketSignals(marketSignalDeps(admin, settings), {
          budgetMs: RUN_BUDGET_MS,
          enabled: settings.enabled,
        });
        // The profile badge and every blueprint fingerprint read the new
        // computed_at, so a night that wrote anything busts the value caches.
        if (out.wroteAny) revalidateTag(CACHE_TAGS.playerValues);
        return out;
      },
      {
        timeoutMs: RUN_BUDGET_MS,
        // The catch-up entry on a night the first entry finished.
        quietWhen: (r: MarketSignalsRunResult) =>
          r.done.length === 0 && !r.partial && !r.failedSteps,
      },
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/market-signals] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
