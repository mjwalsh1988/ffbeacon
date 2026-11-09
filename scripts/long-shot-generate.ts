/**
 * Long Shot: write the puzzle for a date from the command line.
 *
 *   npx tsx --env-file=.env.local scripts/long-shot-generate.ts --date YYYY-MM-DD [--salt N] [--replace]
 *
 * --replace deletes the date's existing puzzle first (its prompts, attempts,
 * answers and tallies cascade), so it is for a day nobody should keep: use it
 * only after the attempts for that day have been cleared on purpose. Without
 * it an existing date is left alone and reported.
 */

import { generatePuzzle } from "../lib/long-shot/generate";
import { loadLongShotSettings } from "../lib/long-shot/settings";
import { getServiceClient } from "./_supabase";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const date = arg("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: --date YYYY-MM-DD [--salt N] [--replace]");
    process.exit(1);
  }
  const salt = Number(arg("salt") ?? "0");
  const admin = getServiceClient();
  if (process.argv.includes("--replace")) {
    const { error, count } = await admin.from("long_shot_puzzles").delete({ count: "exact" }).eq("game_date", date);
    if (error) throw new Error(`delete failed: ${error.message}`);
    console.log(`Removed ${count ?? 0} existing puzzle row(s) for ${date}.`);
  }
  const settings = await loadLongShotSettings(admin);
  const result = await generatePuzzle(admin, date, "admin", salt, settings);
  console.log(
    `${date}: ok=${result.ok} created=${result.created} status=${result.status} prompts=${result.promptCount}${result.error ? ` error=${result.error}` : ""}`,
  );
  for (const t of result.log) {
    console.log(`  ${t.template_key} ${JSON.stringify(t.params)} answers=${t.answer_count ?? "-"} ${t.outcome}${t.detail ? ` (${t.detail})` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
