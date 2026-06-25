"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ruleInputSchema } from "@/lib/signal-check/rules/schema";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateRulesetResult = { ok: true; id: string; version: number } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

const RULES_PATH = "/admin/signal-check/rules";

/**
 * Update one Signal Check setting (a beacon_settings row in a signal_check*
 * category) and append a signal_check_audit_log row capturing before/after.
 * Mirrors updateBeaconSetting's coercion but is scoped + audited.
 */
export async function updateSignalCheckSetting(key: string, raw: string): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/signal-check");
  if (!key.startsWith("signal_check")) return fail("Not a Signal Check setting.");

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("beacon_settings")
    .select("value, value_type")
    .eq("key", key)
    .maybeSingle();
  if (readErr || !row) return fail(readErr?.message ?? `Unknown setting: ${key}`);

  let value: unknown;
  if (row.value_type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fail("Value must be a number.");
    value = n;
  } else if (row.value_type === "boolean") {
    value = raw === "true";
  } else {
    value = raw;
  }

  const before = row.value;
  const { error } = await admin
    .from("beacon_settings")
    .update({ value: value as never, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) return fail(error.message);

  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action: "setting_change",
    target: key,
    before: { value: before } as never,
    after: { value: value } as never,
  });

  revalidatePath("/admin/signal-check");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ruleset + rule management
//
// Rules are only editable while their ruleset is a DRAFT. Published rulesets are
// immutable so a frozen analysis can always be reproduced against the exact
// ruleset version it pinned. Publishing/rollback flips the single is_active
// pointer (enforced one-at-a-time by clearing the old active row first).
// ---------------------------------------------------------------------------

export async function createDraftRuleset(label: string, notes: string): Promise<CreateRulesetResult> {
  const { userId } = await requireAdmin(RULES_PATH);
  const admin = createAdminClient();
  const { data: latest } = await admin
    .from("signal_check_rulesets")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest?.version ?? 0) + 1;
  const { data, error } = await admin
    .from("signal_check_rulesets")
    .insert({ version, status: "draft", is_active: false, label: label || null, notes: notes || null, created_by: userId })
    .select("id, version")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create ruleset." };
  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action: "rule_change",
    target: `ruleset:${data.id}`,
    after: { event: "draft_created", version } as never,
  });
  revalidatePath(RULES_PATH);
  return { ok: true, id: data.id, version: data.version };
}

async function requireDraftRuleset(
  admin: ReturnType<typeof createAdminClient>,
  rulesetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await admin
    .from("signal_check_rulesets")
    .select("status")
    .eq("id", rulesetId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Ruleset not found." };
  if (data.status !== "draft") {
    return { ok: false, error: "Published rulesets are immutable. Create a new draft to make changes." };
  }
  return { ok: true };
}

export async function saveRule(rulesetId: string, ruleId: string | null, raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(RULES_PATH);
  const admin = createAdminClient();

  const draftCheck = await requireDraftRuleset(admin, rulesetId);
  if (!draftCheck.ok) return draftCheck;

  const parsed = ruleInputSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid rule.");
  }
  const r = parsed.data;
  const row = {
    ruleset_id: rulesetId,
    sort_order: r.sortOrder,
    scope: r.scope,
    phase: r.phase,
    condition: r.condition as never,
    action: r.action as never,
    stackable: r.stackable,
    stack_group: r.stackGroup,
    max_adjustment: r.maxAdjustment as never,
    admin_label: r.adminLabel,
    internal_description: r.internalDescription,
    public_explanation_template: r.publicExplanationTemplate,
    enabled: r.enabled,
    updated_at: new Date().toISOString(),
  };

  if (ruleId) {
    const { error } = await admin.from("signal_check_rules").update(row).eq("id", ruleId);
    if (error) return fail(error.message);
  } else {
    const { error } = await admin.from("signal_check_rules").insert(row);
    if (error) return fail(error.message);
  }

  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action: "rule_change",
    target: ruleId ? `rule:${ruleId}` : `ruleset:${rulesetId}`,
    after: { event: ruleId ? "rule_updated" : "rule_created", label: r.adminLabel } as never,
  });
  revalidatePath(RULES_PATH);
  return { ok: true };
}

export async function deleteRule(ruleId: string): Promise<ActionResult> {
  const { userId } = await requireAdmin(RULES_PATH);
  const admin = createAdminClient();
  const { data: rule } = await admin
    .from("signal_check_rules")
    .select("ruleset_id, admin_label")
    .eq("id", ruleId)
    .maybeSingle();
  if (!rule) return fail("Rule not found.");
  const draftCheck = await requireDraftRuleset(admin, rule.ruleset_id);
  if (!draftCheck.ok) return draftCheck;

  const { error } = await admin.from("signal_check_rules").delete().eq("id", ruleId);
  if (error) return fail(error.message);
  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action: "rule_change",
    target: `rule:${ruleId}`,
    after: { event: "rule_deleted", label: rule.admin_label } as never,
  });
  revalidatePath(RULES_PATH);
  return { ok: true };
}

/** Make a ruleset the single active one. Clears the prior active row first so
 * the one-active partial unique index is never violated. */
async function setActiveRuleset(
  rulesetId: string,
  publish: boolean,
  action: "ruleset_publish" | "rollback",
): Promise<ActionResult> {
  const { userId } = await requireAdmin(RULES_PATH);
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("signal_check_rulesets")
    .select("id, version, status")
    .eq("id", rulesetId)
    .maybeSingle();
  if (!target) return fail("Ruleset not found.");
  if (publish && target.status !== "draft") return fail("Only a draft ruleset can be published.");
  if (!publish && target.status !== "published") return fail("Only a previously published ruleset can be activated.");

  // 1. Clear any current active row.
  const { error: clearErr } = await admin
    .from("signal_check_rulesets")
    .update({ is_active: false })
    .eq("is_active", true);
  if (clearErr) return fail(clearErr.message);

  // 2. Activate the target.
  const patch: Record<string, unknown> = { is_active: true };
  if (publish) {
    patch.status = "published";
    patch.published_at = new Date().toISOString();
  }
  const { error } = await admin.from("signal_check_rulesets").update(patch as never).eq("id", rulesetId);
  if (error) return fail(error.message);

  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action,
    target: `ruleset:${rulesetId}`,
    after: { version: target.version, activated: true, published: publish } as never,
  });
  revalidatePath(RULES_PATH);
  revalidatePath("/admin/signal-check");
  return { ok: true };
}

export async function publishRuleset(rulesetId: string): Promise<ActionResult> {
  return setActiveRuleset(rulesetId, true, "ruleset_publish");
}

export async function rollbackRuleset(rulesetId: string): Promise<ActionResult> {
  return setActiveRuleset(rulesetId, false, "rollback");
}
