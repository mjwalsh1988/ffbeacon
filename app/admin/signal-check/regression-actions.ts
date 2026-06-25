"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { analysisInputSchema } from "@/lib/signal-check/rules/schema";
import { loadSignalCheckSettings, loadActiveRuleset, loadRulesetById } from "@/lib/signal-check/settings";
import { resolveFormat } from "@/lib/signal-check/format";
import { buildValueResolver } from "@/lib/signal-check/values";
import { runPipeline } from "@/lib/signal-check/pipeline";
import { SignalCheckError } from "@/lib/signal-check/errors";

type ActionResult = { ok: true } | { ok: false; error: string };
type RegressionInsert = Database["public"]["Tables"]["signal_check_regression_cases"]["Insert"];

const REG_PATH = "/admin/signal-check/regression";

export interface UpsertCaseInput {
  id?: string;
  label: string;
  inputJson: string;
  expectedVerdict: string; // 'a' | 'b' | 'neutral' | ''
  expectedMarginMin: string;
  expectedMarginMax: string;
  expectedTradeShape: string;
  expectedConfidence: string;
  adminNotes: string;
}

export async function upsertRegressionCase(input: UpsertCaseInput): Promise<ActionResult> {
  const { userId } = await requireAdmin(REG_PATH);
  if (!input.label.trim()) return { ok: false, error: "Label is required." };

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(input.inputJson);
  } catch {
    return { ok: false, error: "Trade JSON is not valid JSON." };
  }
  const valid = analysisInputSchema.safeParse(parsedInput);
  if (!valid.success) {
    return { ok: false, error: `Trade JSON invalid: ${valid.error.issues[0]?.message ?? "bad shape"}` };
  }

  const admin = createAdminClient();
  const row: RegressionInsert = {
    label: input.label,
    format_slug: valid.data.formatSlug,
    input_assets: valid.data as never,
    expected_verdict: input.expectedVerdict || null,
    expected_margin_min: input.expectedMarginMin === "" ? null : Number(input.expectedMarginMin),
    expected_margin_max: input.expectedMarginMax === "" ? null : Number(input.expectedMarginMax),
    expected_trade_shape: input.expectedTradeShape || null,
    expected_confidence: input.expectedConfidence || null,
    admin_notes: input.adminNotes || null,
    created_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await admin.from("signal_check_regression_cases").update(row).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("signal_check_regression_cases").insert(row);
    if (error) return { ok: false, error: error.message };
  }

  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action: "regression_update",
    target: input.id ? `case:${input.id}` : "case:new",
    after: { event: input.id ? "updated" : "created", label: input.label } as never,
  });
  revalidatePath(REG_PATH);
  return { ok: true };
}

export async function deleteRegressionCase(id: string): Promise<ActionResult> {
  const { userId } = await requireAdmin(REG_PATH);
  const admin = createAdminClient();
  const { error } = await admin.from("signal_check_regression_cases").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action: "regression_update",
    target: `case:${id}`,
    after: { event: "deleted" } as never,
  });
  revalidatePath(REG_PATH);
  return { ok: true };
}

export interface RegressionCaseResult {
  id: string;
  label: string;
  ok: boolean;
  verdict: string; // 'a' | 'b' | 'neutral'
  marginPct: number | null;
  tradeShapeKey: string | null;
  confidence: string | null;
  issues: string[];
}

export type RunRegressionResult =
  | { ok: true; rulesetVersion: number | null; results: RegressionCaseResult[] }
  | { ok: false; error: string };

/**
 * Run every regression case through the pipeline using either a specific
 * ruleset (preview a draft) or the active ruleset, and flag verdict flips,
 * margin drift, and shape/confidence changes versus the stored expectations.
 */
export async function runRegression(rulesetId?: string): Promise<RunRegressionResult> {
  await requireAdmin(REG_PATH);
  const admin = createAdminClient();
  const settings = await loadSignalCheckSettings(admin);
  const ruleset = rulesetId ? await loadRulesetById(admin, rulesetId) : await loadActiveRuleset(admin);

  const { data: cases } = await admin
    .from("signal_check_regression_cases")
    .select("id, label, input_assets, expected_verdict, expected_margin_min, expected_margin_max, expected_trade_shape, expected_confidence")
    .order("created_at", { ascending: true })
    .limit(200);

  const results: RegressionCaseResult[] = [];
  for (const c of cases ?? []) {
    const parsed = analysisInputSchema.safeParse(c.input_assets);
    if (!parsed.success) {
      results.push({ id: c.id, label: c.label, ok: false, verdict: "neutral", marginPct: null, tradeShapeKey: null, confidence: null, issues: ["Stored trade JSON is invalid."] });
      continue;
    }
    const format = await resolveFormat(admin, parsed.data.formatSlug);
    if (!format) {
      results.push({ id: c.id, label: c.label, ok: false, verdict: "neutral", marginPct: null, tradeShapeKey: null, confidence: null, issues: ["Format not supported."] });
      continue;
    }
    try {
      const built = await buildValueResolver(admin, format, parsed.data);
      const analysis = runPipeline({
        input: parsed.data,
        resolver: built.resolver,
        format,
        source: built.source,
        settings,
        rules: ruleset.rules,
        rulesetVersion: ruleset.version,
      });
      const verdict = analysis.verdict.winnerSide ?? "neutral";
      const issues: string[] = [];
      if (c.expected_verdict && c.expected_verdict !== verdict) {
        issues.push(`Verdict flip: expected ${c.expected_verdict}, got ${verdict}.`);
      }
      if (c.expected_margin_min != null && analysis.verdict.marginPct < c.expected_margin_min) {
        issues.push(`Margin ${analysis.verdict.marginPct}% below expected min ${c.expected_margin_min}%.`);
      }
      if (c.expected_margin_max != null && analysis.verdict.marginPct > c.expected_margin_max) {
        issues.push(`Margin ${analysis.verdict.marginPct}% above expected max ${c.expected_margin_max}%.`);
      }
      if (c.expected_trade_shape && c.expected_trade_shape !== (analysis.tradeShape.key ?? "")) {
        issues.push(`Shape changed: expected ${c.expected_trade_shape}, got ${analysis.tradeShape.key ?? "none"}.`);
      }
      if (c.expected_confidence && c.expected_confidence !== (analysis.confidence.level ?? "")) {
        issues.push(`Confidence changed: expected ${c.expected_confidence}, got ${analysis.confidence.level ?? "none"}.`);
      }
      if (analysis.hasMissingValues) issues.push("Trade has missing values.");
      results.push({
        id: c.id,
        label: c.label,
        ok: issues.length === 0,
        verdict,
        marginPct: analysis.verdict.marginPct,
        tradeShapeKey: analysis.tradeShape.key,
        confidence: analysis.confidence.level,
        issues,
      });
    } catch (err) {
      const msg = err instanceof SignalCheckError ? err.message : "Pipeline error.";
      results.push({ id: c.id, label: c.label, ok: false, verdict: "neutral", marginPct: null, tradeShapeKey: null, confidence: null, issues: [msg] });
    }
  }

  return { ok: true, rulesetVersion: ruleset.version, results };
}
