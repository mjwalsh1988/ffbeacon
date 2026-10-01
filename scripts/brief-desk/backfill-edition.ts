/**
 * Backfill a published Brief edition into the current format (plan section
 * 23.6, lib/brief-desk/backfill.ts). Two steps, the owner's look in between:
 *
 *   1. Write the week's bundle to a file to draft from:
 *        npx tsx --env-file=.env.local scripts/brief-desk/backfill-edition.ts bundle --season 2026 --week 3 --out <file>
 *
 *   2. Validate a drafted payload against that week and store it as a PRIVATE
 *      redo beside the live edition. Nothing is published, posted or emailed:
 *        npx tsx --env-file=.env.local scripts/brief-desk/backfill-edition.ts store --season 2026 --week 3 --draft <file>
 *
 * The script prints the redo's review page and preview addresses. Applying it
 * to the live page is a button on the review page, never this script.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { getServiceClient } from "../_supabase";
import { buildBackfillBundle, storeBackfillDraft } from "../../lib/brief-desk/backfill";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mode = process.argv[2];
  const season = argVal("--season");
  const week = Number.parseInt(argVal("--week") ?? "", 10);
  if (!season || !/^\d{4}$/.test(season) || !Number.isFinite(week)) {
    throw new Error("Usage: backfill-edition.ts <bundle|store> --season 2026 --week 3 [--out file | --draft file]");
  }
  const admin = getServiceClient();

  if (mode === "bundle") {
    const out = argVal("--out");
    if (!out) throw new Error("--out <file> is required");
    const bundle = await buildBackfillBundle(admin, season, week);
    writeFileSync(out, JSON.stringify(bundle, null, 2));
    console.log(
      JSON.stringify(
        {
          wrote: out,
          relays: bundle.relays.length,
          games: bundle.game_index.length,
          datasets: Object.keys(bundle.datasets),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "store") {
    const file = argVal("--draft");
    if (!file) throw new Error("--draft <file> is required");
    const payload = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const res = await storeBackfillDraft(admin, { season, week, payload });
    if (!res.ok) {
      console.error(JSON.stringify(res, null, 2));
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        {
          editionId: res.editionId,
          wordCount: res.wordCount,
          warnings: res.warnings,
          review: `/admin/brief-desk/editions/${res.editionId}`,
          preview: `/brief/preview/${res.editionId}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(`Unknown mode "${mode}"; use bundle or store`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
