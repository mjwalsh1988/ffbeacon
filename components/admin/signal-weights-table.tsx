"use client";

import { useState, useTransition } from "react";
import { updateSignalWeight } from "@/app/admin/beacon/actions";

export type WeightRow = {
  id: string;
  signal_type: string;
  source_slug: string | null;
  weight: number;
  confidence_cap: number;
  is_enabled: boolean;
};

/** Per-signal / per-source weight, confidence cap, and enable toggle editor. */
export function SignalWeightsTable({ weights }: { weights: WeightRow[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">FF Beacon signal weights, confidence caps, and enable toggles</caption>
        <thead>
          <tr className="border-b border-line bg-surface/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
            <th scope="col" className="px-3 py-2">Signal</th>
            <th scope="col" className="px-3 py-2">Source</th>
            <th scope="col" className="px-3 py-2">Weight</th>
            <th scope="col" className="px-3 py-2">Conf. cap</th>
            <th scope="col" className="px-3 py-2">Enabled</th>
            <th scope="col" className="px-3 py-2">Save</th>
          </tr>
        </thead>
        <tbody>
          {weights.map((w) => (
            <WeightTableRow key={w.id} row={w} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeightTableRow({ row }: { row: WeightRow }) {
  const [weight, setWeight] = useState(String(row.weight));
  const [cap, setCap] = useState(String(row.confidence_cap));
  const [enabled, setEnabled] = useState(row.is_enabled);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const label = `${row.signal_type}${row.source_slug ? ` (${row.source_slug})` : ""}`;

  return (
    <tr className="border-b border-line/60">
      <td className="px-3 py-2 font-medium text-ink">{row.signal_type}</td>
      <td className="px-3 py-2 font-mono text-xs text-ink-subtle">{row.source_slug ?? "global"}</td>
      <td className="px-3 py-2">
        <input
          aria-label={`Weight for ${label}`}
          type="number" step="any" value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="min-h-[40px] w-20 rounded-card border border-line bg-base px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        />
      </td>
      <td className="px-3 py-2">
        <input
          aria-label={`Confidence cap for ${label}`}
          type="number" step="0.05" min="0" max="1" value={cap}
          onChange={(e) => setCap(e.target.value)}
          className="min-h-[40px] w-20 rounded-card border border-line bg-base px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        />
      </td>
      <td className="px-3 py-2">
        <input
          aria-label={`Enable ${label}`}
          type="checkbox" checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-5 w-5 accent-brand-purple"
        />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setStatus(null);
              const res = await updateSignalWeight(row.id, {
                weight: Number(weight),
                confidenceCap: Number(cap),
                isEnabled: enabled,
              });
              setStatus(res.ok ? "Saved" : res.error);
            })
          }
          className="min-h-[40px] rounded-card border border-line bg-base px-3 text-xs font-semibold text-ink hover:border-brand-cyan disabled:opacity-50"
        >
          {pending ? "..." : "Save"}
        </button>
        <span aria-live="polite" className="ml-2 text-xs text-ink-muted">{status}</span>
      </td>
    </tr>
  );
}
