import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { SignalCheckSubnav } from "@/components/admin/signal-check-subnav";
import { RegressionManager, type RegressionCaseView, type RulesetChoice } from "./regression-manager";

export const dynamic = "force-dynamic";

export default async function SignalCheckRegressionPage() {
  await requireAdmin("/admin/signal-check/regression");
  const admin = createAdminClient();

  const [{ data: cases }, { data: rulesets }] = await Promise.all([
    admin
      .from("signal_check_regression_cases")
      .select(
        "id, label, format_slug, input_assets, expected_verdict, expected_margin_min, expected_margin_max, expected_trade_shape, expected_confidence, admin_notes",
      )
      .order("created_at", { ascending: true }),
    admin
      .from("signal_check_rulesets")
      .select("id, version, status, is_active")
      .order("version", { ascending: false }),
  ]);

  const caseViews: RegressionCaseView[] = (cases ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    formatSlug: c.format_slug,
    inputJson: JSON.stringify(c.input_assets, null, 2),
    expectedVerdict: c.expected_verdict ?? "",
    expectedMarginMin: c.expected_margin_min != null ? String(c.expected_margin_min) : "",
    expectedMarginMax: c.expected_margin_max != null ? String(c.expected_margin_max) : "",
    expectedTradeShape: c.expected_trade_shape ?? "",
    expectedConfidence: c.expected_confidence ?? "",
    adminNotes: c.admin_notes ?? "",
  }));

  const choices: RulesetChoice[] = (rulesets ?? []).map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    isActive: r.is_active,
  }));

  return (
    <>
      <SignalCheckSubnav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Signal Check regression</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Store known trades with expected outcomes and re-run them against the active ruleset or a
        draft before publishing. Flags verdict flips, margin drift, and shape or confidence changes.
      </p>
        <RegressionManager cases={caseViews} rulesets={choices} />
      </div>
    </>
  );
}
