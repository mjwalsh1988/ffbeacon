"use client";

import { useState, useTransition } from "react";
import { createManualSignal } from "@/app/admin/beacon/actions";

type PlayerOpt = { id: string; name: string; position: string; team: string | null };
type Format = { id: string; slug: string };

/**
 * Owner manual-signal composer. The silent vs true-signal choice is explained in
 * plain language: a true signal flows into trends as movement; a silent change
 * adjusts the value but is excluded from trend/movement chips via formula_offset.
 */
export function ManualComposer({ players, formats }: { players: PlayerOpt[]; formats: Format[] }) {
  const [target, setTarget] = useState<"player" | "pick">("player");
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [pickSeason, setPickSeason] = useState("2027");
  const [pickRound, setPickRound] = useState("1");
  const [pickPosition, setPickPosition] = useState("early");
  const [formatId, setFormatId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<"multiplier" | "delta" | "set_value">("multiplier");
  const [magnitude, setMagnitude] = useState("1.1");
  const [silent, setSilent] = useState(false);
  const [decayDays, setDecayDays] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const magnitudeHint =
    adjustmentType === "multiplier" ? "e.g. 1.1 = +10%, 0.9 = -10%"
    : adjustmentType === "delta" ? "value points to add (can be negative)"
    : "absolute value to set";

  return (
    <form
      className="grid gap-4 rounded-card border border-line bg-surface/60 p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setStatus(null);
          const res = await createManualSignal({
            target,
            playerId: target === "player" ? playerId : null,
            pickSeason: target === "pick" ? Number(pickSeason) : null,
            pickRound: target === "pick" ? Number(pickRound) : null,
            pickPosition: target === "pick" ? pickPosition : null,
            formatConfigId: formatId || null,
            adjustmentType,
            magnitude: Number(magnitude),
            silent,
            reason,
            decayDays: decayDays ? Number(decayDays) : null,
          });
          setStatus(res.ok ? "Signal created." : `Failed: ${res.error}`);
        });
      }}
    >
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Target</legend>
        <div className="mt-2 flex gap-4 text-sm">
          {(["player", "pick"] as const).map((t) => (
            <label key={t} className="inline-flex items-center gap-2">
              <input type="radio" name="target" checked={target === t} onChange={() => setTarget(t)} className="h-4 w-4 accent-brand-purple" />
              {t === "player" ? "Player" : "Draft pick"}
            </label>
          ))}
        </div>
      </fieldset>

      {target === "player" ? (
        <label className="text-sm text-ink-muted">Player
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="mt-1 block min-h-[44px] w-full max-w-md rounded-card border border-line bg-base px-3 text-ink">
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.position}{p.team ? `, ${p.team}` : ""})</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-ink-muted">Season
            <input type="number" value={pickSeason} onChange={(e) => setPickSeason(e.target.value)} className="mt-1 block min-h-[44px] w-28 rounded-card border border-line bg-base px-3 text-ink" />
          </label>
          <label className="text-sm text-ink-muted">Round
            <input type="number" value={pickRound} onChange={(e) => setPickRound(e.target.value)} className="mt-1 block min-h-[44px] w-20 rounded-card border border-line bg-base px-3 text-ink" />
          </label>
          <label className="text-sm text-ink-muted">Slot
            <select value={pickPosition} onChange={(e) => setPickPosition(e.target.value)} className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-ink">
              <option value="early">early</option>
              <option value="mid">mid</option>
              <option value="late">late</option>
            </select>
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-ink-muted">Scope
          <select value={formatId} onChange={(e) => setFormatId(e.target.value)} className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-ink">
            <option value="">All formats</option>
            {formats.map((f) => <option key={f.id} value={f.id}>{f.slug}</option>)}
          </select>
        </label>
        <label className="text-sm text-ink-muted">Adjustment
          <select value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value as typeof adjustmentType)} className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-ink">
            <option value="multiplier">Multiplier</option>
            <option value="delta">Delta</option>
            <option value="set_value">Set value</option>
          </select>
        </label>
        <label className="text-sm text-ink-muted">Magnitude
          <input type="number" step="any" value={magnitude} onChange={(e) => setMagnitude(e.target.value)} aria-describedby="mag-hint" className="mt-1 block min-h-[44px] w-32 rounded-card border border-line bg-base px-3 text-ink" />
          <span id="mag-hint" className="mt-1 block text-xs text-ink-subtle">{magnitudeHint}</span>
        </label>
        <label className="text-sm text-ink-muted">Decay (days, optional)
          <input type="number" value={decayDays} onChange={(e) => setDecayDays(e.target.value)} placeholder="none" className="mt-1 block min-h-[44px] w-28 rounded-card border border-line bg-base px-3 text-ink" />
        </label>
      </div>

      <fieldset className="rounded-card border border-line bg-base/50 p-3">
        <legend className="px-1 text-sm font-semibold text-ink">Movement handling</legend>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="silent" checked={!silent} onChange={() => setSilent(false)} className="mt-1 h-4 w-4 accent-brand-purple" />
            <span><span className="font-semibold text-ink">Record as true signal.</span> <span className="text-ink-muted">The value changes and it shows as movement on the 7d/30d/90d trend chips.</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="silent" checked={silent} onChange={() => setSilent(true)} className="mt-1 h-4 w-4 accent-brand-purple" />
            <span><span className="font-semibold text-ink">Set value silently.</span> <span className="text-ink-muted">The value changes but the delta is tagged formula-induced and excluded from trend/movement chips (via formula_offset).</span></span>
          </label>
        </div>
      </fieldset>

      <label className="text-sm text-ink-muted">Reason
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why you're nudging this" className="mt-1 block min-h-[44px] w-full max-w-md rounded-card border border-line bg-base px-3 text-ink" />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-[44px] rounded-card border border-brand-purple bg-brand-purple/10 px-4 text-sm font-semibold text-ink hover:bg-brand-purple/20 disabled:opacity-50">
          {pending ? "Creating..." : "Create signal"}
        </button>
        <span aria-live="polite" className="text-sm text-ink-muted">{status}</span>
      </div>
      <p className="text-xs text-ink-subtle">Manual signals apply on the next recompute. Use Recompute now above to see the effect.</p>
    </form>
  );
}
