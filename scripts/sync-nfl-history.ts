/**
 * Sync the Long Shot history pool from the nflverse data releases, by hand.
 *
 *   npx tsx --env-file=.env.local scripts/sync-nfl-history.ts [--from YYYY] [--skip-stats] [--dry-run]
 *
 * The monthly cron (/api/cron/long-shot-history) keeps the pool current on
 * its own; this script is for the one-time full load from 1920 (the default
 * window) or a rebuild after a franchise-code fix. --skip-stats reruns the
 * roster, draft and Hall of Fame passes only and leaves the stored stats,
 * career totals and prominence untouched. The work itself is
 * lib/long-shot/history/sync.ts.
 */

import { ROSTER_FLOOR, syncNflHistory } from "../lib/long-shot/history/sync";
import { getServiceClient } from "./_supabase";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const summary = await syncNflHistory(getServiceClient(), {
    fromSeason: Number(arg("from") ?? ROSTER_FLOOR),
    skipStats: process.argv.includes("--skip-stats"),
    dryRun: process.argv.includes("--dry-run"),
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify({ ...summary, defunctCodes: summary.defunctCodes.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
