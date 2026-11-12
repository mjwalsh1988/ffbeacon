/**
 * scripts/build-faab-priors.ts
 *
 * Run the FAAB priors pass by hand:
 *   npm run faab:priors              advance the incremental pass, as the hourly cron does
 *   npm run faab:priors -- --full    walk every league of this season and last
 *   npm run faab:priors -- --showcase 2025   also (re)build that season's offseason board
 *   npm run faab:priors -- --no-cells   fill the kept sample, leave the published cells alone
 *
 * Unlike the cron, a script has no 300-second limit, so it loops until the
 * pass completes. Each loop is one call to the same runFaabPriors the cron
 * uses, which saves its cursor after every batch, so stopping this script
 * midway loses nothing: the next run, or the next cron tick, resumes.
 */

import { getServiceClient } from "./_supabase";
import { runFaabPriors } from "../lib/faab/priors-incremental";
import { buildPickupShowcase } from "../lib/waiver-wire/offseason";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const supabase = getServiceClient();
  const full = process.argv.includes("--full");
  const showcaseSeason = argValue("--showcase");
  const skipCells = process.argv.includes("--no-cells");

  let first = true;
  for (;;) {
    const result = await runFaabPriors(supabase, {
      budgetMs: 10 * 60 * 1000,
      forceFull: full && first,
      skipCells,
    });
    first = false;
    const pass = result.pass;
    console.log(
      `Season ${result.currentSeason ?? "none"}: ${pass ? `${pass.full ? "full" : "incremental"} pass${pass.resumed ? " (resumed)" : ""}, ${pass.leaguesRead} leagues, ${pass.auctionsWritten} auctions` : "nothing to do"}${result.partial ? ", continuing..." : ""}`,
    );
    for (const c of result.cells) {
      console.log(`  ${c.season}: ${c.cells} cells from ${c.auctions} auctions, ${c.deleted} stale removed`);
    }
    if (!result.partial) break;
    // With --no-cells a finished walk still reports partial (the pass stays
    // open for the cells); stop once a run reads nothing new.
    if (skipCells && (pass?.leaguesRead ?? 0) === 0) break;
  }

  if (showcaseSeason) {
    const season = Number(showcaseSeason);
    if (!Number.isInteger(season)) throw new Error(`--showcase needs a season, got ${showcaseSeason}`);
    const built = await buildPickupShowcase(supabase, season);
    console.log(
      `Showcase ${built.season}: ${built.stored} players stored from ${built.candidates} qualifying, across ${built.leagues} leagues.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
