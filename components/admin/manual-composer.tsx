"use client";

import { useMemo, useState, useTransition } from "react";
import { createManualSignal } from "@/app/admin/beacon/actions";
import { PICK_SLOTS } from "@/lib/beacon/pick-slots";

type PlayerOpt = { id: string; name: string; position: string; team: string | null };
type Format = { id: string; slug: string; usesPicks: boolean };

/**
 * Owner manual-signal composer. The silent vs true-signal choice is explained in
 * plain language: a true signal flows into trends as movement; a silent change
 * adjusts the value but is excluded from trend/movement chips via formula_offset.
 *
 * Draft pick signals address a season and round, across one, two, or all three
 * draft slots in a single submission, and they stack on top of the global pick
 * value multiplier in Settings rather than replacing it.
 */
export function ManualComposer({
  players,
  formats,
  pickSeasons,
  pickRounds,
}: {
  players: PlayerOpt[];
  formats: Format[];
  /** Draft seasons the engine currently publishes pick values for. */
  pickSeasons: number[];
  /** Draft rounds the engine currently publishes pick values for. */
  pickRounds: number[];
}) {
  const [target, setTarget] = useState<"player" | "pick">("player");
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [pickSeason, setPickSeason] = useState(String(pickSeasons[0] ?? ""));
  const [pickRound, setPickRound] = useState(String(pickRounds[0] ?? 1));
  const [slots, setSlots] = useState<string[]>([...PICK_SLOTS]);
  const [formatId, setFormatId] = useState("");
  const [pickFormatId, setPickFormatId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<"multiplier" | "delta" | "set_value">("multiplier");
  const [magnitude, setMagnitude] = useState("1.1");
  const [silent, setSilent] = useState(false);
  const [decayDays, setDecayDays] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const canTargetPicks = pickSeasons.length > 0 && pickRounds.length > 0;
  const isPick = target === "pick" && canTargetPicks;
  const pickFormats = useMemo(() => formats.filter((f) => f.usesPicks), [formats]);
  const scopeOptions = isPick ? pickFormats : formats;
  const scopeValue = isPick ? pickFormatId : formatId;
  const allSlots = slots.length === PICK_SLOTS.length;

  const magnitudeHint =
    adjustmentType === "multiplier" ? "e.g. 1.1 = +10%, 0.9 = -10%"
    : adjustmentType === "delta" ? "value points to add (can be negative)"
    : "absolute value to set";

  const scopeName =
    scopeValue === ""
      ? isPick ? "every format that uses draft picks" : "every format"
      : (scopeOptions.find((f) => f.id === scopeValue)?.slug ?? "the selected format");

  // Plain-language preview of exactly what the submission will store, announced
  // as the choices change so the outcome is never a surprise.
  const preview = isPick
    ? slots.length === 0
      ? "Choose at least one draft slot."
      : `Creates ${allSlots ? "1 signal covering all three slots" : `${slots.length} signal${slots.length === 1 ? "" : "s"} (${slots.join(", ")})`} for ${pickSeason || "?"} round ${pickRound || "?"} picks in ${scopeName}, stacked on top of the global pick value multiplier.`
    : `Creates 1 signal for the selected player in ${scopeName}.`;

  // Kept in early, mid, late order however the boxes are checked, so the preview
  // and the created signals always read in draft order.
  const toggleSlot = (slot: string) => {
    setSlots((prev) =>
      prev.includes(slot)
        ? prev.filter((s) => s !== slot)
        : PICK_SLOTS.filter((s) => s === slot || prev.includes(s)),
    );
  };

  return (
    <form
      className="grid gap-4 rounded-card border border-line bg-surface/60 p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPick && slots.length === 0) {
          setStatus("Choose at least one draft slot before creating the signal.");
          return;
        }
        start(async () => {
          setStatus(null);
          const res = await createManualSignal({
            target: isPick ? "pick" : "player",
            playerId: isPick ? null : playerId,
            pickSeason: isPick ? Number(pickSeason) : null,
            pickRound: isPick ? Number(pickRound) : null,
            pickPositions: isPick ? slots : null,
            formatConfigId: (isPick ? pickFormatId : formatId) || null,
            adjustmentType,
            magnitude: Number(magnitude),
            silent: isPick ? false : silent,
            reason,
            decayDays: decayDays ? Number(decayDays) : null,
          });
          setStatus(
            res.ok
              ? `Created ${res.created} signal${res.created === 1 ? "" : "s"}. Recompute to apply.`
              : `Failed: ${res.error}`,
          );
        });
      }}
    >
      <fieldset aria-describedby={canTargetPicks ? undefined : "no-picks-hint"}>
        <legend className="text-sm font-semibold text-ink">Target</legend>
        <div className="mt-2 flex gap-4 text-sm">
          {(["player", "pick"] as const).map((t) => (
            <label key={t} className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="target"
                checked={target === t}
                disabled={t === "pick" && !canTargetPicks}
                onChange={() => setTarget(t)}
                className="h-4 w-4 accent-brand-purple disabled:opacity-50"
              />
              {t === "player" ? "Player" : "Draft pick"}
            </label>
          ))}
        </div>
        {canTargetPicks ? null : (
          <p id="no-picks-hint" className="mt-2 text-xs text-ink-subtle">
            Draft pick signals need published pick values. Run a recompute once KTC pick values have synced.
          </p>
        )}
      </fieldset>

      {!isPick ? (
        <label className="text-sm text-ink-muted">Player
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="mt-1 block min-h-[44px] w-full max-w-md rounded-card border border-line bg-base px-3 text-ink">
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.position}{p.team ? `, ${p.team}` : ""})</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm text-ink-muted">Draft season
              <select value={pickSeason} onChange={(e) => setPickSeason(e.target.value)} className="mt-1 block min-h-[44px] w-32 rounded-card border border-line bg-base px-3 text-ink">
                {pickSeasons.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-sm text-ink-muted">Round
              <select value={pickRound} onChange={(e) => setPickRound(e.target.value)} className="mt-1 block min-h-[44px] w-28 rounded-card border border-line bg-base px-3 text-ink">
                {pickRounds.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>

          <fieldset className="rounded-card border border-line bg-base/50 p-3" aria-describedby="slots-hint">
            <legend className="px-1 text-sm font-semibold text-ink">Draft slots</legend>
            <div className="mt-1 flex flex-wrap gap-4 text-sm">
              {PICK_SLOTS.map((slot) => (
                <label key={slot} className="inline-flex min-h-[44px] items-center gap-2">
                  <input
                    type="checkbox"
                    checked={slots.includes(slot)}
                    onChange={() => toggleSlot(slot)}
                    className="h-4 w-4 accent-brand-purple"
                  />
                  {slot}
                </label>
              ))}
              <button
                type="button"
                onClick={() => setSlots(allSlots ? [] : [...PICK_SLOTS])}
                className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {allSlots ? "Clear all slots" : "Select all slots"}
              </button>
            </div>
            <p id="slots-hint" className="mt-2 text-xs text-ink-subtle">
              All three checked stores one signal that covers the whole round. A smaller selection stores one signal per slot, so you can remove them one at a time.
            </p>
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-ink-muted">Scope
          <select
            value={scopeValue}
            onChange={(e) => (isPick ? setPickFormatId(e.target.value) : setFormatId(e.target.value))}
            className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-ink"
          >
            <option value="">{isPick ? "All formats that use draft picks" : "All formats"}</option>
            {scopeOptions.map((f) => <option key={f.id} value={f.id}>{f.slug}</option>)}
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

      {isPick ? (
        <p className="rounded-card border border-line bg-base/50 p-3 text-sm text-ink-muted">
          Draft pick values carry no trend chips, so the silent option does not apply to them. A pick signal multiplies (or shifts, or sets) the FF Beacon pick value after the global multiplier in Settings has been applied.
        </p>
      ) : (
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
      )}

      <label className="text-sm text-ink-muted">Reason
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why you're nudging this" className="mt-1 block min-h-[44px] w-full max-w-md rounded-card border border-line bg-base px-3 text-ink" />
      </label>

      <p aria-live="polite" className="text-sm text-ink-muted">{preview}</p>

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
