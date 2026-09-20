/**
 * scripts/faab-replay.ts
 *
 * Replay the FAAB price model against every auction we hold:
 *   npm run faab:replay
 *
 * Reads only. Writes nothing, syncs nothing, and is deliberately NOT wired into
 * any cron: this is a model-change check you run before shipping a change to
 * the bid curve, not a scheduled job. It needs the market cells to exist, so
 * run `npm run faab:priors` first if they are stale.
 *
 * See lib/faab/replay.ts for what this can and cannot prove. Short version:
 * historical rosters are not stored, so the worth cap is not applied and the
 * reader's remaining budget is unknown. The win shares below are therefore an
 * UPPER BOUND on the real ones, and the printed footnote says so.
 */

import { getServiceClient } from "./_supabase";
import { loadFaabSettings } from "../lib/faab/settings";
import { loadPriorCellsForReplay, loadReplayAuctions } from "../lib/faab/replay-load";
import { replayAuctions, replayOptionsFrom, type ReplayBucket } from "../lib/faab/replay";

const WIDTH = { label: 32, n: 9, share: 12, overpay: 14 };

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function share(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function overpay(value: number | null, wins: number): string {
  if (value === null) return "-";
  return `${value.toFixed(2)}% (${wins})`;
}

function header(): void {
  console.log(
    pad("Bucket", WIDTH.label) +
      pad("Auctions", WIDTH.n) +
      pad("Value win", WIDTH.share) +
      pad("Sure win", WIDTH.share) +
      pad("Value overpay", WIDTH.overpay) +
      pad("Sure overpay", WIDTH.overpay),
  );
  console.log("-".repeat(WIDTH.label + WIDTH.n + WIDTH.share * 2 + WIDTH.overpay * 2));
}

function row(bucket: ReplayBucket): void {
  console.log(
    pad(bucket.label.slice(0, WIDTH.label - 2), WIDTH.label) +
      pad(bucket.sampleSize, WIDTH.n) +
      pad(share(bucket.valueWinShare), WIDTH.share) +
      pad(share(bucket.sureWinShare), WIDTH.share) +
      pad(overpay(bucket.valueMedianOverpayPct, bucket.valueWins), WIDTH.overpay) +
      pad(overpay(bucket.sureMedianOverpayPct, bucket.sureWins), WIDTH.overpay),
  );
}

function verdict(label: string, value: number | null, low: number, high: number): string {
  if (value === null) return `${label}: no reading`;
  const inside = value >= low && value <= high;
  return `${label}: ${inside ? "inside target" : "outside target"}`;
}

async function main() {
  const supabase = getServiceClient();
  const settings = await loadFaabSettings(supabase);

  console.log("Loading market cells...");
  const cells = await loadPriorCellsForReplay(supabase);
  if (cells.length === 0) {
    console.log("No cells in faab_market_priors. Run npm run faab:priors first.");
    return;
  }

  console.log("Loading settled auctions...");
  const auctions = await loadReplayAuctions(supabase);

  const started = Date.now();
  const { summary } = replayAuctions(auctions, cells, replayOptionsFrom(settings));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `\n${cells.length} cells, ${auctions.length} auctions read, ${summary.graded} graded across ${summary.leagues} leagues in ${seconds}s.`,
  );
  console.log(
    `${summary.skipped} skipped (one bidder, or standard week 1), ${summary.unpriced} had no cell to price from.\n`,
  );

  header();
  row(summary.overall);
  if (summary.standard.length > 0) {
    console.log("");
    console.log("Standard leagues, by time of season");
    for (const bucket of summary.standard) row(bucket);
  }
  if (summary.chopped.length > 0) {
    console.log("");
    console.log("Chopped leagues, by how much of the field is left");
    for (const bucket of summary.chopped) row(bucket);
  }

  console.log("\nTargets (reported, not enforced)");
  console.log(
    `  Value goal wins 55 to 75%:   ${share(summary.overall.valueWinShare)}  ${verdict("verdict", summary.overall.valueWinShare, 0.55, 0.75)}`,
  );
  console.log(
    `  Sure goal wins 85 to 95%:    ${share(summary.overall.sureWinShare)}  ${verdict("verdict", summary.overall.sureWinShare, 0.85, 0.95)}`,
  );
  console.log(
    `  Median overpay under 2%:     ${overpay(summary.overall.valueMedianOverpayPct, summary.overall.valueWins)}  ${verdict("verdict", summary.overall.valueMedianOverpayPct, 0, 2)}`,
  );

  console.log("\nHow to read this");
  console.log(
    "  Win share counts a bid over the real winner as a win and a bid level with it as half.",
  );
  console.log(
    "  Overpay is the median of (our bid minus the winning bid) over the auctions we strictly won,",
  );
  console.log("  in shares of the league's full budget, with that win count in brackets.");
  console.log(
    "  Historical rosters are not stored, so the worth cap is not applied and the reader's",
  );
  console.log(
    "  remaining budget is unknown. These win shares are an upper bound on the real ones.",
  );
  if (summary.valueAtBudgetCap > 0 || summary.sureAtBudgetCap > 0) {
    console.log(
      `  Target out of reach at the whole budget on ${summary.valueAtBudgetCap} value bids and ${summary.sureAtBudgetCap} sure bids.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
