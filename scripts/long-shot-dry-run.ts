/**
 * Long Shot dry run: plan a puzzle for a date and print it WITHOUT writing.
 *
 *   npx tsx --env-file=.env.local scripts/long-shot-dry-run.ts --date YYYY-MM-DD [--salt N]
 *
 * Prints the chosen completed week (with both row counts), the roster-rate
 * season, every family tried with its parameters, answer count and outcome,
 * then each passing prompt's text, answer count, tier distribution and the
 * share of rate-0 answers (players nobody rosters, mostly retirees).
 *
 * Plan: docs/completed/long-shot/long-shot-plan.md task LS-T029.
 */

import { loadLongShotSettings } from "../lib/long-shot/settings";
import { planPuzzle } from "../lib/long-shot/generate";
import { TIERS } from "../lib/long-shot/types";
import { getServiceClient } from "./_supabase";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const date = arg("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: --date YYYY-MM-DD [--salt N]");
    process.exit(1);
  }
  const salt = Number(arg("salt") ?? "0");
  const admin = getServiceClient();
  const settings = await loadLongShotSettings(admin);
  const plan = await planPuzzle(admin, date, salt, settings);

  const cw = plan.completed;
  console.log(`Long Shot dry run for ${date}, salt ${salt}. Nothing is written.`);
  console.log(
    `Completed week: ${cw.week ?? "none"} (latest week ${cw.latestWeek ?? "none"} has ${cw.latestCount} rows; the week before has ${cw.priorCount})`,
  );
  console.log(`Roster-rate season: ${plan.ctx.rateSeason ?? "none (every rate is 0)"}`);
  console.log(`Default source: ${plan.ctx.defaultSource?.display ?? "none"}`);
  console.log("");
  console.log("Tries:");
  for (const t of plan.log) {
    console.log(
      `  ${t.template_key} ${JSON.stringify(t.params)} answers=${t.answer_count ?? "-"} ${t.outcome}${t.detail ? ` (${t.detail})` : ""}`,
    );
  }
  console.log("");
  console.log(`Prompts (${plan.prompts.length}${plan.prompts.length < 5 ? ", SHORT" : ""}):`);
  plan.prompts.forEach((p, i) => {
    const dist = TIERS.map((tier) => `${tier} ${plan.answers[i].filter((a) => a.tier === tier).length}`).join(", ");
    console.log(`  ${i + 1}. [${p.template_key}] ${p.prompt_text}`);
    console.log(`     answers ${plan.answers[i].length}; ${dist}; rate-0 share ${plan.rateZeroShare[i]}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
