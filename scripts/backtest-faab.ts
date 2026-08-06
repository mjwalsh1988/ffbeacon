/**
 * scripts/backtest-faab.ts
 *
 * Grade the FAAB price model against what leagues have actually paid.
 *
 *   npm run backtest:faab
 *   npm run backtest:faab -- --season 2025
 *   npm run backtest:faab -- --sleeper-league-id <id>
 *
 * Reads only. Writes nothing, syncs nothing, and is deliberately NOT wired into
 * any cron: this is a model-change check you run before shipping a change to
 * the bid curve, not a scheduled job.
 *
 * See lib/faab/backtest.ts for what this can and cannot prove. Short version:
 * historical rosters are not stored, so this measures whether the model's price
 * curve lands where real bids land, not whether it would have won any specific
 * claim.
 */

import { getServiceClient } from "./_supabase";
import { loadFaabSettings } from "../lib/faab/settings";
import { loadWinningBids } from "../lib/faab/league-load";
import {
  calibrateLeague,
  summarizeCalibration,
  type LeagueBidSample,
} from "../lib/faab/backtest";

const MIN_SAMPLES = 8;

function argValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

async function main() {
  const args = process.argv.slice(2);
  const seasonArg = argValue(args, "--season");
  const sleeperLeagueId = argValue(args, "--sleeper-league-id");
  const season = seasonArg ? Number(seasonArg) : null;

  const supabase = getServiceClient();
  const settings = await loadFaabSettings(supabase);

  let query = supabase.from("leagues").select("id, sleeper_league_id, name, season, metadata");
  if (sleeperLeagueId) query = query.eq("sleeper_league_id", sleeperLeagueId);
  if (season !== null) query = query.eq("season", season);

  const { data: leagues, error } = await query;
  if (error) throw error;
  if (!leagues || leagues.length === 0) {
    console.log("No leagues matched.");
    return;
  }

  console.log(`Grading ${leagues.length} league season(s) against real winning bids.\n`);

  const samples: LeagueBidSample[] = [];
  for (const league of leagues) {
    const bids = await loadWinningBids(supabase, league.id, [Number(league.season)]);
    const meta = (league.metadata ?? {}) as { settings?: Record<string, unknown> };
    samples.push({
      sleeperLeagueId: league.sleeper_league_id,
      leagueName: league.name ?? "Untitled league",
      season: Number(league.season),
      totalBudget: numberFrom(meta.settings?.waiver_budget),
      bids: bids.map((b) => b.amount),
    });
  }

  const rows = samples.map((s) => calibrateLeague(s, settings, MIN_SAMPLES));
  const summary = summarizeCalibration(rows);

  console.log(
    `${pad("League", 28)}${pad("Season", 8)}${pad("Bids", 6)}${pad("Observed p25/med/p75", 24)}${pad("Model med", 11)}${pad("Ratio", 8)}Verdict`,
  );
  console.log("-".repeat(100));

  for (const row of rows.sort((a, b) => a.leagueName.localeCompare(b.leagueName))) {
    if (row.verdict === "insufficient") {
      console.log(
        `${pad(row.leagueName.slice(0, 26), 28)}${pad(row.season, 8)}${pad(row.sampleSize, 6)}${pad("-", 24)}${pad("-", 11)}${pad("-", 8)}too few bids`,
      );
      continue;
    }
    const observed = `${row.observed.p25}/${row.observed.median}/${row.observed.p75}`;
    console.log(
      `${pad(row.leagueName.slice(0, 26), 28)}${pad(row.season, 8)}${pad(row.sampleSize, 6)}${pad(observed, 24)}${pad(row.modelled.median, 11)}${pad(row.medianRatio?.toFixed(2) ?? "-", 8)}${row.verdict}`,
    );
  }

  console.log("\nSummary");
  console.log(`  Leagues graded:      ${summary.graded}`);
  console.log(`  Calibrated:          ${summary.calibrated}`);
  console.log(`  Model bids too low:  ${summary.under}`);
  console.log(`  Model bids too high: ${summary.over}`);
  console.log(
    `  Median ratio:        ${summary.medianRatio === null ? "n/a" : summary.medianRatio.toFixed(2)} (1.00 is perfectly calibrated)`,
  );

  if (summary.graded === 0) {
    console.log(
      "\nNothing had enough bid history to grade. Sync more league seasons and run this again.",
    );
    return;
  }

  const ratio = summary.medianRatio;
  if (ratio !== null && (ratio < 0.6 || ratio > 1.6)) {
    console.log(
      `\nThe model is systematically ${ratio < 1 ? "under" : "over"}bidding against real league behavior. Adjust marginal.maxPctFromUpgrade in /admin/faab before shipping.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
