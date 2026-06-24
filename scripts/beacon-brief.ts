/**
 * The Beacon Brief manual run, CLI entrypoint.
 *
 * Implementation lives in lib/beacon-brief/* so the same code paths run from the
 * Vercel cron endpoints (app/api/cron/beacon-brief + beacon-brief-worker).
 *
 * Run:
 *   npm run beacon-brief            curation pass, then one worker pass
 *   npm run beacon-brief -- curate  curation pass only
 *   npm run beacon-brief -- worker  one worker pass only
 */

import { getServiceClient } from "./_supabase";
import { runCuration } from "../lib/beacon-brief/curate";
import { runWorker } from "../lib/beacon-brief/worker";

async function main() {
  const arg = process.argv[2];
  const supabase = getServiceClient();

  if (arg === "worker") {
    console.log("worker:", JSON.stringify(await runWorker(supabase), null, 2));
    return;
  }
  if (arg === "curate") {
    console.log(
      "curation:",
      JSON.stringify(await runCuration(supabase), null, 2),
    );
    return;
  }
  console.log(
    "curation:",
    JSON.stringify(await runCuration(supabase), null, 2),
  );
  console.log("worker:", JSON.stringify(await runWorker(supabase), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
