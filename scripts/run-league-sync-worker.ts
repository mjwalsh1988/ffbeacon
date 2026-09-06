/**
 * scripts/run-league-sync-worker.ts
 *
 * CLI: drain the Sync all queue (public.league_sync_jobs) by hand.
 *
 * Usage:
 *   npm run worker:league-sync            one pass, then exit
 *   npm run worker:league-sync -- --watch keep passing until the queue is empty
 *
 * In production the every-minute cron owns this. Locally there is no cron, so
 * --watch is how you see a queued batch actually drain against a dev server.
 */

import { randomUUID } from "node:crypto";
import { getServiceClient } from "./_supabase";
import { runLeagueSyncWorker } from "../lib/league-bulk-sync";

const PASS_GAP_MS = 5_000;

async function main() {
  const watch = process.argv.slice(2).includes("--watch");
  const supabase = getServiceClient();
  const holder = `script:${randomUUID()}`;

  for (let pass = 1; ; pass++) {
    const startedAt = Date.now();
    const summary = await runLeagueSyncWorker(supabase, { holder });
    const elapsed = Date.now() - startedAt;
    console.log(
      `[league-sync-worker] pass ${pass} in ${elapsed}ms: ${JSON.stringify(summary)}`,
    );

    if (!watch) return;
    // Nothing claimed and nothing reclaimed means the queue is empty or every
    // remaining job is waiting out a backoff. Either way, stop.
    if (summary.claimed === 0 && summary.reaped === 0) {
      console.log("[league-sync-worker] queue is empty; stopping.");
      return;
    }
    await new Promise((r) => setTimeout(r, PASS_GAP_MS));
  }
}

main().catch((err) => {
  console.error("[league-sync-worker] unexpected error:", err);
  process.exit(1);
});
