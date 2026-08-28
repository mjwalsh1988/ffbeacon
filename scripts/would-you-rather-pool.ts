/**
 * scripts/would-you-rather-pool.ts
 *
 * Fill the Would You Rather trade pool.
 *
 *   npm run wyr:pool                 one pass
 *   npm run wyr:pool -- --passes 25  twenty five passes
 *   npm run wyr:pool -- --stats      report the pool and change nothing
 *
 * A pool row is a trade that has already been graded successfully, so the game
 * can serve one with a cheap read instead of discovering mid-request that the
 * trade it picked cannot be scored. The game tops the pool up on its own when
 * it runs low; this script is for priming it before launch and for topping it
 * up in bulk after a big league sync.
 *
 * Each pass samples a window of completed trades, keeps the two-sided ones,
 * picks ONE league group from that window at random (preferring a league that
 * already has Positional WAR curves, and preferring a group of more than one so
 * the grading batch is shared), grades it, and pools whichever of them graded.
 * The group is random rather than the largest because the largest is always the
 * same handful of high-volume leagues, and a hundred passes of that pooled a
 * hundred trades from nine league names. Passes are independent, so twenty five
 * is twenty five samples rather than one deeper scan.
 */

import { getServiceClient } from "./_supabase";
import { countActivePool, growPool } from "../lib/would-you-rather/pool";
import { loadWouldYouRatherSettings } from "../lib/would-you-rather/settings";

async function main() {
  const args = process.argv.slice(2);
  const statsOnly = args.includes("--stats");
  const passesIdx = args.indexOf("--passes");
  const passes = passesIdx >= 0 ? Number(args[passesIdx + 1]) : 1;

  if (!statsOnly && (!Number.isFinite(passes) || passes < 1 || passes > 500)) {
    console.error("--passes must be a whole number between 1 and 500.");
    process.exit(1);
  }

  const supabase = getServiceClient();
  const settings = await loadWouldYouRatherSettings(supabase);

  const before = await countActivePool(supabase);
  if (statsOnly) {
    const { count: discordPolls } = await supabase
      .from("would_you_rather_discord_polls")
      .select("id", { count: "exact", head: true });
    const { count: votes } = await supabase
      .from("would_you_rather_votes")
      .select("id", { count: "exact", head: true });
    console.log(`Pool: ${before} active trades`);
    console.log(`Votes on record: ${votes ?? 0}`);
    console.log(`Discord polls posted: ${discordPolls ?? 0}`);
    return;
  }

  console.log(`Pool before: ${before} active trades. Running ${passes} pass(es)...`);
  const result = await growPool(supabase, settings, { passes });
  const after = await countActivePool(supabase);

  console.log(
    `Considered ${result.considered}, graded ${result.graded}, inserted ${result.inserted}.`,
  );
  if (result.note) console.log(`Last note: ${result.note}`);
  console.log(`Pool after: ${after} active trades.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
