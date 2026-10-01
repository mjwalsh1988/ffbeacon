/**
 * Settled betting lines for finished games, CLI entrypoint (migration 0333).
 *
 * The daily odds cron already captures each game's line after it finishes
 * (lib/sync-nfl-game-lines.ts). This is for a backfill of weeks played before
 * that existed, and for a one-off retry. A captured line is never rewritten,
 * so re-running is safe.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/sync-nfl-game-lines.ts --season 2026 --weeks 1,2,3
 *   npx tsx --env-file=.env.local scripts/sync-nfl-game-lines.ts --season 2026 --max 60
 */

import { getServiceClient } from "./_supabase";
import { runNflGameLinesSync } from "../lib/sync-nfl-game-lines";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const season = Number.parseInt(argVal("--season") ?? "", 10);
  if (!Number.isFinite(season)) throw new Error("--season is required, for example --season 2026");
  const weeks = (argVal("--weeks") ?? "")
    .split(",")
    .map((w) => Number.parseInt(w.trim(), 10))
    .filter((w) => Number.isFinite(w));
  const max = Number.parseInt(argVal("--max") ?? "", 10);

  const result = await runNflGameLinesSync(getServiceClient(), {
    season,
    weeks: weeks.length > 0 ? weeks : undefined,
    maxGames: Number.isFinite(max) ? max : 60,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
