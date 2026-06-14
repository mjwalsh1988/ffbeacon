"use client";

import { useState, useTransition } from "react";
import { upsertValueBand } from "@/app/admin/beacon/actions";

type Band = {
  id: string;
  position: string;
  format_config_id: string | null;
  floor: number;
  ceiling: number;
};
type Format = { id: string; slug: string };

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** Edit global + per-format position value bands, and add new per-format overrides. */
export function ValueBandsEditor({ bands, formats }: { bands: Band[]; formats: Format[] }) {
  const slugById = new Map(formats.map((f) => [f.id, f.slug]));
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">Position value bands</caption>
          <thead>
            <tr className="border-b border-line bg-surface/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="px-3 py-2">Position</th>
              <th scope="col" className="px-3 py-2">Scope</th>
              <th scope="col" className="px-3 py-2">Floor</th>
              <th scope="col" className="px-3 py-2">Ceiling</th>
              <th scope="col" className="px-3 py-2">Save</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <BandRow
                key={b.id}
                position={b.position}
                formatConfigId={b.format_config_id}
                scopeLabel={b.format_config_id ? (slugById.get(b.format_config_id) ?? "format") : "Global default"}
                floor={b.floor}
                ceiling={b.ceiling}
              />
            ))}
          </tbody>
        </table>
      </div>
      <AddOverride formats={formats} />
    </div>
  );
}

function BandRow({
  position, formatConfigId, scopeLabel, floor, ceiling,
}: {
  position: string; formatConfigId: string | null; scopeLabel: string; floor: number; ceiling: number;
}) {
  const [f, setF] = useState(String(floor));
  const [c, setC] = useState(String(ceiling));
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  return (
    <tr className="border-b border-line/60">
      <td className="px-3 py-2 font-medium text-ink">{position}</td>
      <td className="px-3 py-2 text-ink-muted">{scopeLabel}</td>
      <td className="px-3 py-2">
        <input aria-label={`${position} ${scopeLabel} floor`} type="number" value={f}
          onChange={(e) => setF(e.target.value)}
          className="min-h-[40px] w-24 rounded-card border border-line bg-base px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan" />
      </td>
      <td className="px-3 py-2">
        <input aria-label={`${position} ${scopeLabel} ceiling`} type="number" value={c}
          onChange={(e) => setC(e.target.value)}
          className="min-h-[40px] w-24 rounded-card border border-line bg-base px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan" />
      </td>
      <td className="px-3 py-2">
        <button type="button" disabled={pending}
          onClick={() => start(async () => {
            setStatus(null);
            const res = await upsertValueBand({ position, formatConfigId, floor: Number(f), ceiling: Number(c) });
            setStatus(res.ok ? "Saved" : res.error);
          })}
          className="min-h-[40px] rounded-card border border-line bg-base px-3 text-xs font-semibold text-ink hover:border-brand-cyan disabled:opacity-50">
          {pending ? "..." : "Save"}
        </button>
        <span aria-live="polite" className="ml-2 text-xs text-ink-muted">{status}</span>
      </td>
    </tr>
  );
}

function AddOverride({ formats }: { formats: Format[] }) {
  const [position, setPosition] = useState("TE");
  const [formatId, setFormatId] = useState(formats[0]?.id ?? "");
  const [floor, setFloor] = useState("0");
  const [ceiling, setCeiling] = useState("10000");
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setStatus(null);
          const res = await upsertValueBand({
            position, formatConfigId: formatId || null, floor: Number(floor), ceiling: Number(ceiling),
          });
          setStatus(res.ok ? "Override saved." : res.error);
        });
      }}
    >
      <p className="w-full text-sm font-semibold text-ink">Add per-format override</p>
      <label className="text-xs text-ink-muted">Position
        <select value={position} onChange={(e) => setPosition(e.target.value)} className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-ink">
          {POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-muted">Format
        <select value={formatId} onChange={(e) => setFormatId(e.target.value)} className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-ink">
          {formats.map((f) => <option key={f.id} value={f.id}>{f.slug}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-muted">Floor
        <input type="number" value={floor} onChange={(e) => setFloor(e.target.value)} className="mt-1 block min-h-[44px] w-24 rounded-card border border-line bg-base px-3 text-ink" />
      </label>
      <label className="text-xs text-ink-muted">Ceiling
        <input type="number" value={ceiling} onChange={(e) => setCeiling(e.target.value)} className="mt-1 block min-h-[44px] w-24 rounded-card border border-line bg-base px-3 text-ink" />
      </label>
      <button type="submit" disabled={pending} className="min-h-[44px] rounded-card border border-brand-purple bg-brand-purple/10 px-4 text-sm font-semibold text-ink hover:bg-brand-purple/20 disabled:opacity-50">
        {pending ? "Saving..." : "Add override"}
      </button>
      <span aria-live="polite" className="text-xs text-ink-muted">{status}</span>
    </form>
  );
}
