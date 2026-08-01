"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus, Pencil, Play } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  upsertRegressionCase,
  deleteRegressionCase,
  runRegression,
  type RegressionCaseResult,
} from "../regression-actions";

export interface RegressionCaseView {
  id: string;
  label: string;
  formatSlug: string;
  inputJson: string;
  expectedVerdict: string;
  expectedMarginMin: string;
  expectedMarginMax: string;
  expectedTradeShape: string;
  expectedConfidence: string;
  adminNotes: string;
}

export interface RulesetChoice {
  id: string;
  version: number;
  status: string;
  isActive: boolean;
}

function emptyCase(): RegressionCaseView {
  return {
    id: "",
    label: "",
    formatSlug: "",
    inputJson:
      '{\n  "formatSlug": "dynasty-ppr-sflex",\n  "sides": {\n    "a": [{ "kind": "player", "playerId": "<uuid>" }],\n    "b": [{ "kind": "player", "playerId": "<uuid>" }]\n  }\n}',
    expectedVerdict: "",
    expectedMarginMin: "",
    expectedMarginMax: "",
    expectedTradeShape: "",
    expectedConfidence: "",
    adminNotes: "",
  };
}

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const labelCls = "block text-xs font-medium text-ink-subtle";

export function RegressionManager({
  cases,
  rulesets,
}: {
  cases: RegressionCaseView[];
  rulesets: RulesetChoice[];
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [form, setForm] = useState<RegressionCaseView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RegressionCaseView | null>(null);
  const [runAgainst, setRunAgainst] = useState("active");
  const [results, setResults] = useState<RegressionCaseResult[] | null>(null);

  const set = <K extends keyof RegressionCaseView>(k: K, v: RegressionCaseView[K]) =>
    setForm((p) => (p ? { ...p, [k]: v } : p));

  function save() {
    if (!form) return;
    setStatus("");
    startTransition(async () => {
      const res = await upsertRegressionCase({
        id: form.id || undefined,
        label: form.label,
        inputJson: form.inputJson,
        expectedVerdict: form.expectedVerdict,
        expectedMarginMin: form.expectedMarginMin,
        expectedMarginMax: form.expectedMarginMax,
        expectedTradeShape: form.expectedTradeShape,
        expectedConfidence: form.expectedConfidence,
        adminNotes: form.adminNotes,
      });
      setStatus(res.ok ? "Saved." : `Failed: ${res.error}`);
      if (res.ok) setForm(null);
    });
  }

  function run() {
    setStatus("");
    setResults(null);
    startTransition(async () => {
      const res = await runRegression(runAgainst === "active" ? undefined : runAgainst);
      if (res.ok) {
        setResults(res.results);
        const failed = res.results.filter((r) => !r.ok).length;
        setStatus(`Ran ${res.results.length} case(s): ${failed} flagged.`);
      } else {
        setStatus(`Failed: ${res.error}`);
      }
    });
  }

  return (
    <div className="mt-8 space-y-10">
      <p aria-live="polite" className="text-sm text-ink-muted">
        {isPending ? "Working..." : status}
      </p>

      {/* Run */}
      <section aria-labelledby="run-heading">
        <h2 id="run-heading" className="text-lg font-semibold text-ink">
          Run regression
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="run-against" className={labelCls}>
              Run against
            </label>
            <select id="run-against" value={runAgainst} onChange={(e) => setRunAgainst(e.target.value)} className={inputCls}>
              <option value="active">Active ruleset</option>
              {rulesets.map((r) => (
                <option key={r.id} value={r.id}>
                  v{r.version} ({r.status}){r.isActive ? " - active" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={isPending || cases.length === 0}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
          >
            <Play aria-hidden="true" className="h-4 w-4" />
            Run {cases.length} case(s)
          </button>
        </div>

        {results && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Regression results</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="py-2 pr-4 font-medium">Case</th>
                  <th className="py-2 pr-4 font-medium">Result</th>
                  <th className="py-2 pr-4 font-medium">Verdict</th>
                  <th className="py-2 pr-4 font-medium">Margin</th>
                  <th className="py-2 font-medium">Issues</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pr-4 text-ink">{r.label}</td>
                    <td className="py-2 pr-4">
                      <span className={r.ok ? "text-brand-cyan" : "text-signal-danger"}>
                        {r.ok ? "Pass" : "Flagged"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-ink-muted">{r.verdict}</td>
                    <td className="py-2 pr-4 text-ink-muted">{r.marginPct != null ? `${r.marginPct}%` : "-"}</td>
                    <td className="py-2 text-ink-muted">
                      {r.issues.length ? (
                        <ul role="list" className="space-y-0.5">
                          {r.issues.map((i, idx) => (
                            <li key={idx}>{i}</li>
                          ))}
                        </ul>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cases */}
      <section aria-labelledby="cases-heading">
        <h2 id="cases-heading" className="text-lg font-semibold text-ink">
          Regression cases
        </h2>
        <ul role="list" className="mt-3 space-y-2">
          {cases.length === 0 ? (
            <li className="rounded-card border border-dashed border-line px-3 py-4 text-sm text-ink-subtle">
              No cases yet.
            </li>
          ) : (
            cases.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface/40 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.label}</span>
                  <span className="block text-xs text-ink-subtle">
                    {c.formatSlug}, expect {c.expectedVerdict || "any"}
                    {c.expectedTradeShape ? `, ${c.expectedTradeShape}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setForm({ ...c })}
                    aria-label={`Edit case ${c.label}`}
                    className="flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink-muted hover:border-brand-cyan hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(c)}
                    aria-label={`Delete case ${c.label}`}
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="mt-4 rounded-card border border-line bg-surface/60 p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="rc-label" className={labelCls}>Label (required)</label>
                <input id="rc-label" value={form.label} onChange={(e) => set("label", e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="rc-json" className={labelCls}>
                  Trade JSON (formatSlug + sides; player ids are FF Beacon uuids)
                </label>
                <textarea
                  id="rc-json"
                  rows={8}
                  value={form.inputJson}
                  onChange={(e) => set("inputJson", e.target.value)}
                  className="mt-1 w-full rounded-card border border-line bg-base px-3 py-2 font-mono text-xs leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                />
              </div>
              <div>
                <label htmlFor="rc-verdict" className={labelCls}>Expected verdict</label>
                <select id="rc-verdict" value={form.expectedVerdict} onChange={(e) => set("expectedVerdict", e.target.value)} className={inputCls}>
                  <option value="">any</option>
                  <option value="a">Side A wins</option>
                  <option value="b">Side B wins</option>
                  <option value="neutral">neutral</option>
                </select>
              </div>
              <div>
                <label htmlFor="rc-conf" className={labelCls}>Expected confidence</label>
                <select id="rc-conf" value={form.expectedConfidence} onChange={(e) => set("expectedConfidence", e.target.value)} className={inputCls}>
                  <option value="">any</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>
              <div>
                <label htmlFor="rc-min" className={labelCls}>Expected margin min (%)</label>
                <input id="rc-min" type="number" step="any" value={form.expectedMarginMin} onChange={(e) => set("expectedMarginMin", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="rc-max" className={labelCls}>Expected margin max (%)</label>
                <input id="rc-max" type="number" step="any" value={form.expectedMarginMax} onChange={(e) => set("expectedMarginMax", e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="rc-shape" className={labelCls}>Expected trade shape key (optional)</label>
                <input id="rc-shape" value={form.expectedTradeShape} onChange={(e) => set("expectedTradeShape", e.target.value)} placeholder="consolidation, stud_swap, ..." className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="rc-notes" className={labelCls}>Admin notes</label>
                <input id="rc-notes" value={form.adminNotes} onChange={(e) => set("adminNotes", e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={isPending} className="inline-flex min-h-11 items-center rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50">
                {form.id ? "Save case" : "Add case"}
              </button>
              <button type="button" onClick={() => setForm(null)} className="inline-flex min-h-11 items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setForm(emptyCase())}
            className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add a case
          </button>
        )}
      </section>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this case?"
          description={`"${deleteTarget.label}" will be permanently removed.`}
          confirmLabel="Delete case"
          cancelLabel="Keep case"
          tone="danger"
          icon={Trash2}
          onConfirm={() => {
            const id = deleteTarget.id;
            setDeleteTarget(null);
            setStatus("");
            startTransition(async () => {
              const res = await deleteRegressionCase(id);
              setStatus(res.ok ? "Case deleted." : `Failed: ${res.error}`);
            });
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
