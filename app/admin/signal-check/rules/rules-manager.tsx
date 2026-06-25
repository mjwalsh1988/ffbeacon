"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatEastern } from "@/lib/datetime";
import {
  createDraftRuleset,
  saveRule,
  deleteRule,
  publishRuleset,
  rollbackRuleset,
} from "../actions";

export interface RulesetSummary {
  id: string;
  version: number;
  status: string;
  isActive: boolean;
  label: string | null;
  createdAt: string;
  ruleCount: number;
}

export interface RuleRow {
  id: string;
  sortOrder: number;
  scope: string;
  phase: string;
  condition: unknown;
  action: unknown;
  stackable: boolean;
  stackGroup: string | null;
  maxAdjustment: unknown;
  adminLabel: string;
  internalDescription: string | null;
  publicExplanationTemplate: string;
  enabled: boolean;
}

const ACTION_TYPES = [
  "multiply_pct",
  "add_points",
  "cap_value",
  "side_penalty_pct",
  "side_boost_pct",
  "assign_shape",
  "confidence_modifier",
  "trace_note",
] as const;

interface FormState {
  ruleId: string | null;
  adminLabel: string;
  scope: string;
  phase: string;
  actionType: string;
  actionValue: string;
  positions: string;
  formats: string;
  player: boolean;
  pick: boolean;
  minValue: string;
  maxValue: string;
  tradeShape: string;
  stackable: boolean;
  stackGroup: string;
  maxAdjType: string;
  maxAdjValue: string;
  publicTemplate: string;
  sortOrder: string;
  enabled: boolean;
}

function emptyForm(): FormState {
  return {
    ruleId: null,
    adminLabel: "",
    scope: "single_asset",
    phase: "post_format_calibration",
    actionType: "multiply_pct",
    actionValue: "0",
    positions: "",
    formats: "",
    player: false,
    pick: false,
    minValue: "",
    maxValue: "",
    tradeShape: "",
    stackable: false,
    stackGroup: "",
    maxAdjType: "none",
    maxAdjValue: "",
    publicTemplate: "",
    sortOrder: "0",
    enabled: true,
  };
}

function csv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
}

function assembleRaw(f: FormState): unknown {
  const condition: Record<string, unknown> = {};
  if (csv(f.positions).length) condition.positions = csv(f.positions);
  if (csv(f.formats).length) condition.formats = csv(f.formats);
  const kinds = [f.player ? "player" : null, f.pick ? "pick" : null].filter(Boolean);
  if (kinds.length) condition.assetKinds = kinds;
  if (f.minValue !== "") condition.minValue = Number(f.minValue);
  if (f.maxValue !== "") condition.maxValue = Number(f.maxValue);
  if (csv(f.tradeShape).length) condition.tradeShape = csv(f.tradeShape);

  let action: Record<string, unknown>;
  if (f.actionType === "trace_note") action = { type: "trace_note" };
  else if (f.actionType === "assign_shape") action = { type: "assign_shape", value: f.actionValue };
  else action = { type: f.actionType, value: Number(f.actionValue) };

  const maxAdjustment =
    f.maxAdjType === "none" ? null : { type: f.maxAdjType, value: Number(f.maxAdjValue) };

  return {
    scope: f.scope,
    phase: f.phase,
    sortOrder: Number(f.sortOrder) || 0,
    condition,
    action,
    stackable: f.stackable,
    stackGroup: f.stackGroup || null,
    maxAdjustment,
    adminLabel: f.adminLabel,
    publicExplanationTemplate: f.publicTemplate,
    enabled: f.enabled,
  };
}

function ruleToForm(r: RuleRow): FormState {
  const cond = (r.condition ?? {}) as Record<string, unknown>;
  const act = (r.action ?? {}) as { type?: string; value?: unknown };
  const maxAdj = (r.maxAdjustment ?? null) as { type?: string; value?: number } | null;
  const kinds = Array.isArray(cond.assetKinds) ? (cond.assetKinds as string[]) : [];
  return {
    ruleId: r.id,
    adminLabel: r.adminLabel,
    scope: r.scope,
    phase: r.phase,
    actionType: act.type ?? "multiply_pct",
    actionValue: act.value !== undefined ? String(act.value) : "",
    positions: Array.isArray(cond.positions) ? (cond.positions as string[]).join(", ") : "",
    formats: Array.isArray(cond.formats) ? (cond.formats as string[]).join(", ") : "",
    player: kinds.includes("player"),
    pick: kinds.includes("pick"),
    minValue: cond.minValue !== undefined ? String(cond.minValue) : "",
    maxValue: cond.maxValue !== undefined ? String(cond.maxValue) : "",
    tradeShape: Array.isArray(cond.tradeShape) ? (cond.tradeShape as string[]).join(", ") : "",
    stackable: r.stackable,
    stackGroup: r.stackGroup ?? "",
    maxAdjType: maxAdj?.type ?? "none",
    maxAdjValue: maxAdj?.value !== undefined ? String(maxAdj.value) : "",
    publicTemplate: r.publicExplanationTemplate,
    sortOrder: String(r.sortOrder),
    enabled: r.enabled,
  };
}

export function RulesManager({
  rulesets,
  draft,
  draftRules,
}: {
  rulesets: RulesetSummary[];
  draft: RulesetSummary | null;
  draftRules: RuleRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string>("");
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RuleRow | null>(null);
  const [newLabel, setNewLabel] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setStatus("");
    startTransition(async () => {
      const res = await fn();
      setStatus(res.ok ? okMsg : `Failed: ${res.error ?? "unknown error"}`);
    });
  }

  function submitForm() {
    if (!draft || !form) return;
    if (!form.adminLabel.trim()) {
      setStatus("Admin label is required.");
      return;
    }
    run(() => saveRule(draft.id, form.ruleId, assembleRaw(form)), form.ruleId ? "Rule updated." : "Rule added.");
    setForm(null);
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev));

  return (
    <div className="mt-8 space-y-10">
      <p aria-live="polite" className="text-sm text-ink-muted">
        {isPending ? "Working..." : status}
      </p>

      {/* Rulesets */}
      <section aria-labelledby="rulesets-heading">
        <h2 id="rulesets-heading" className="text-lg font-semibold text-ink">
          Rulesets
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Rules</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rulesets.map((rs) => (
                <tr key={rs.id} className="border-b border-line/60">
                  <td className="py-2 pr-4 text-ink">
                    v{rs.version}
                    {rs.label ? <span className="ml-2 text-ink-subtle">{rs.label}</span> : null}
                  </td>
                  <td className="py-2 pr-4">
                    <span className="text-ink">{rs.status}</span>
                    {rs.isActive && (
                      <span className="ml-2 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-medium text-brand-cyan">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-ink-muted">{rs.ruleCount}</td>
                  <td className="py-2 pr-4 text-ink-subtle">{formatEastern(rs.createdAt)}</td>
                  <td className="py-2">
                    {rs.status === "draft" ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => publishRuleset(rs.id), `Published v${rs.version}.`)}
                        className="min-h-11 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan disabled:opacity-50"
                      >
                        Publish
                      </button>
                    ) : rs.status === "published" && !rs.isActive ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => rollbackRuleset(rs.id), `Activated v${rs.version}.`)}
                        className="min-h-11 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan disabled:opacity-50"
                      >
                        Activate
                      </button>
                    ) : (
                      <span className="text-xs text-ink-subtle">{rs.isActive ? "In use" : "-"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Create draft */}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="new-ruleset-label" className="block text-xs font-medium text-ink-subtle">
              New draft label (optional)
            </label>
            <input
              id="new-ruleset-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="mt-1 min-h-11 w-64 rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
            />
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              run(async () => {
                const res = await createDraftRuleset(newLabel, "");
                return res;
              }, "Draft ruleset created.")
            }
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Create draft
          </button>
        </div>
      </section>

      {/* Draft rules */}
      <section aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="text-lg font-semibold text-ink">
          Rules in the draft
        </h2>
        {!draft ? (
          <p className="mt-2 text-sm text-ink-muted">Create a draft ruleset above to add rules.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <ul role="list" className="space-y-2">
              {draftRules.length === 0 ? (
                <li className="rounded-card border border-dashed border-line px-3 py-4 text-sm text-ink-subtle">
                  No rules yet.
                </li>
              ) : (
                draftRules.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface/40 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {r.adminLabel}
                        {!r.enabled && <span className="ml-2 text-xs text-ink-subtle">(disabled)</span>}
                      </span>
                      <span className="block text-xs text-ink-subtle">
                        {r.scope} · {r.phase} · {(r.action as { type?: string }).type}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setForm(ruleToForm(r))}
                        aria-label={`Edit rule ${r.adminLabel}`}
                        className="flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink-muted hover:border-brand-cyan hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                      >
                        <Pencil aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(r)}
                        aria-label={`Delete rule ${r.adminLabel}`}
                        className="flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </span>
                  </li>
                ))
              )}
            </ul>

            {form ? (
              <RuleForm form={form} set={set} onSubmit={submitForm} onCancel={() => setForm(null)} pending={isPending} />
            ) : (
              <button
                type="button"
                onClick={() => setForm(emptyForm())}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add a rule
              </button>
            )}
          </div>
        )}
      </section>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this rule?"
          description={`"${deleteTarget.adminLabel}" will be permanently removed from the draft ruleset.`}
          confirmLabel="Delete rule"
          cancelLabel="Keep rule"
          tone="danger"
          icon={Trash2}
          onConfirm={() => {
            const id = deleteTarget.id;
            setDeleteTarget(null);
            run(() => deleteRule(id), "Rule deleted.");
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function RuleForm({
  form,
  set,
  onSubmit,
  onCancel,
  pending,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const noValueAction = form.actionType === "trace_note";
  const textValueAction = form.actionType === "assign_shape";
  const inputCls =
    "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
  const labelCls = "block text-xs font-medium text-ink-subtle";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="rounded-card border border-line bg-surface/60 p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="f-label" className={labelCls}>
            Admin label (required)
          </label>
          <input id="f-label" value={form.adminLabel} onChange={(e) => set("adminLabel", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="f-scope" className={labelCls}>Scope</label>
          <select id="f-scope" value={form.scope} onChange={(e) => set("scope", e.target.value)} className={inputCls}>
            <option value="single_asset">single_asset</option>
            <option value="one_side">one_side</option>
            <option value="whole_trade">whole_trade</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-phase" className={labelCls}>Phase</label>
          <select id="f-phase" value={form.phase} onChange={(e) => set("phase", e.target.value)} className={inputCls}>
            <option value="post_format_calibration">post_format_calibration</option>
            <option value="post_aggregation_trade_shape">post_aggregation_trade_shape</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-action" className={labelCls}>Action</label>
          <select id="f-action" value={form.actionType} onChange={(e) => set("actionType", e.target.value)} className={inputCls}>
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {!noValueAction && (
          <div>
            <label htmlFor="f-actionval" className={labelCls}>
              Action value {textValueAction ? "(shape key)" : "(number)"}
            </label>
            <input
              id="f-actionval"
              type={textValueAction ? "text" : "number"}
              step="any"
              value={form.actionValue}
              onChange={(e) => set("actionValue", e.target.value)}
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label htmlFor="f-positions" className={labelCls}>Positions (comma)</label>
          <input id="f-positions" value={form.positions} onChange={(e) => set("positions", e.target.value)} placeholder="QB, RB" className={inputCls} />
        </div>
        <div>
          <label htmlFor="f-formats" className={labelCls}>Formats (comma of slugs)</label>
          <input id="f-formats" value={form.formats} onChange={(e) => set("formats", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="f-min" className={labelCls}>Min value</label>
          <input id="f-min" type="number" step="any" value={form.minValue} onChange={(e) => set("minValue", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="f-max" className={labelCls}>Max value</label>
          <input id="f-max" type="number" step="any" value={form.maxValue} onChange={(e) => set("maxValue", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="f-shape" className={labelCls}>Trade shape filter (comma)</label>
          <input id="f-shape" value={form.tradeShape} onChange={(e) => set("tradeShape", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="f-sort" className={labelCls}>Sort order</label>
          <input id="f-sort" type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="f-maxadjtype" className={labelCls}>Max adjustment</label>
          <select id="f-maxadjtype" value={form.maxAdjType} onChange={(e) => set("maxAdjType", e.target.value)} className={inputCls}>
            <option value="none">none</option>
            <option value="pct">pct</option>
            <option value="points">points</option>
          </select>
        </div>
        {form.maxAdjType !== "none" && (
          <div>
            <label htmlFor="f-maxadjval" className={labelCls}>Max adjustment value</label>
            <input id="f-maxadjval" type="number" step="any" value={form.maxAdjValue} onChange={(e) => set("maxAdjValue", e.target.value)} className={inputCls} />
          </div>
        )}
        <div>
          <label htmlFor="f-stackgroup" className={labelCls}>Stack group (optional)</label>
          <input id="f-stackgroup" value={form.stackGroup} onChange={(e) => set("stackGroup", e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="f-template" className={labelCls}>Public explanation template</label>
          <input id="f-template" value={form.publicTemplate} onChange={(e) => set("publicTemplate", e.target.value)} placeholder="Side {side} ..." className={inputCls} />
        </div>
        <fieldset className="sm:col-span-2 flex flex-wrap gap-4">
          <legend className="sr-only">Flags</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.player} onChange={(e) => set("player", e.target.checked)} /> player assets
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.pick} onChange={(e) => set("pick", e.target.checked)} /> pick assets
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.stackable} onChange={(e) => set("stackable", e.target.checked)} /> stackable
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /> enabled
          </label>
        </fieldset>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          {form.ruleId ? "Save rule" : "Add rule"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
