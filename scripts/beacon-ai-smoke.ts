/**
 * FF Beacon AI signal smoke test (B7).
 *
 * Proves the Anthropic integration end to end with ONE live Haiku call:
 *   - reads the LIVE admin-editable prompt + model + bound from beacon_settings
 *     (ai_system_prompt, ai_model, ai_adjustment_bound),
 *   - sends one sample candidate payload through callClaudeForAdjustment,
 *   - prints the parsed + clamped result.
 *
 * This does NOT enable the signal and does NOT touch the cache. It is a manual
 * sanity check only: it confirms the model id is valid, the structured-output
 * JSON parses, and the clamp holds. Cost is roughly $0.0001 per run.
 *
 * Run: npm run beacon:ai-smoke
 */

import { getServiceClient } from "./_supabase";
import { loadBeaconSettings } from "../lib/beacon/settings";
import { callClaudeForAdjustment } from "../lib/beacon/signals/ai-adjust";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY missing. Run with tsx --env-file=.env.local");
  }
  const supabase = getServiceClient();
  const settings = await loadBeaconSettings(supabase);

  console.log("Model:", settings.aiModel);
  console.log("Adjustment bound:", settings.aiAdjustmentBound);
  console.log("System prompt (live, {bound} substituted at call time):");
  console.log("----");
  console.log(settings.aiSystemPrompt.replaceAll("{bound}", String(settings.aiAdjustmentBound)));
  console.log("----");

  const payload = {
    name: "Sample Player",
    position: "WR",
    consensus_value: 6200,
    per_source_values: [
      { source: "ktc", value: 6800 },
      { source: "fantasycalc", value: 5400 },
      { source: "dynastyprocess", value: 6300 },
    ],
    source_spread: 0.21,
    perf_adjustment_pct: 0.06,
  };

  console.log("\nSample payload:");
  console.log(JSON.stringify(payload, null, 2));

  const result = await callClaudeForAdjustment(payload, {
    model: settings.aiModel,
    bound: settings.aiAdjustmentBound,
    systemPrompt: settings.aiSystemPrompt,
  });

  console.log("\nParsed + clamped result:");
  console.log(JSON.stringify(result, null, 2));

  if (!result) {
    console.error("\nFAIL: call returned null (API error, refusal, or unparseable JSON).");
    process.exit(1);
  }
  const inBound = Math.abs(result.adjustment_pct) <= settings.aiAdjustmentBound + 1e-9;
  const confOk = result.confidence >= 0 && result.confidence <= 1;
  console.log(`\nClamp check: adjustment in bound = ${inBound}, confidence in [0,1] = ${confOk}`);
  if (!inBound || !confOk) {
    console.error("FAIL: result outside expected bounds.");
    process.exit(1);
  }
  console.log("OK: AI integration works (parsed strict JSON, clamp held, model id valid).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
