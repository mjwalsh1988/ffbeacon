import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { SignalCheckSubnav } from "@/components/admin/signal-check-subnav";
import { RulesManager, type RulesetSummary, type RuleRow } from "./rules-manager";

export const dynamic = "force-dynamic";

export default async function SignalCheckRulesPage() {
  await requireAdmin("/admin/signal-check/rules");
  const admin = createAdminClient();

  const { data: rulesets } = await admin
    .from("signal_check_rulesets")
    .select("id, version, status, is_active, label, created_at")
    .order("version", { ascending: false });

  const { data: ruleCountRows } = await admin.from("signal_check_rules").select("ruleset_id");
  const counts = new Map<string, number>();
  for (const r of ruleCountRows ?? []) counts.set(r.ruleset_id, (counts.get(r.ruleset_id) ?? 0) + 1);

  const summaries: RulesetSummary[] = (rulesets ?? []).map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    isActive: r.is_active,
    label: r.label,
    createdAt: r.created_at,
    ruleCount: counts.get(r.id) ?? 0,
  }));

  // Editable draft = highest-version draft ruleset.
  const draft = summaries.find((s) => s.status === "draft") ?? null;

  let draftRules: RuleRow[] = [];
  if (draft) {
    const { data } = await admin
      .from("signal_check_rules")
      .select(
        "id, sort_order, scope, phase, condition, action, stackable, stack_group, max_adjustment, admin_label, internal_description, public_explanation_template, enabled",
      )
      .eq("ruleset_id", draft.id)
      .order("sort_order", { ascending: true });
    draftRules = (data ?? []).map((d) => ({
      id: d.id,
      sortOrder: d.sort_order,
      scope: d.scope,
      phase: d.phase,
      condition: d.condition,
      action: d.action,
      stackable: d.stackable,
      stackGroup: d.stack_group,
      maxAdjustment: d.max_adjustment,
      adminLabel: d.admin_label,
      internalDescription: d.internal_description,
      publicExplanationTemplate: d.public_explanation_template,
      enabled: d.enabled,
    }));
  }

  return (
    <>
      <SignalCheckSubnav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Signal Check rules</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Calibration and trade-shape rules run after FF Beacon values and format weighting. Rules are
        editable only in a draft ruleset; publishing freezes it so saved analyses stay reproducible.
        Exactly one ruleset is active at a time.
      </p>
        <RulesManager rulesets={summaries} draft={draft} draftRules={draftRules} />
      </div>
    </>
  );
}
