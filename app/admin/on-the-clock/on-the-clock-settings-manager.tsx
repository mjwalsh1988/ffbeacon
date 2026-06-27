"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { ChevronDown, Lock, RotateCcw } from "lucide-react";
import type {
  OnTheClockSettings,
  TeamNeedAggressiveness,
  DstkRecommendBehavior,
} from "@/lib/on-the-clock/types";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "@/lib/on-the-clock/default-settings";
import { formatEastern } from "@/lib/datetime";
import { saveOnTheClockSettings, resetOnTheClockSettings } from "./actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const labelCls = "block text-xs font-medium text-ink-subtle";

/* Controlled number input with a local text buffer (lets decimals be typed without
   the parsed value fighting the keystrokes). Same pattern as the FAAB manager. */
function NumberInput({
  id,
  value,
  onChange,
  step = "any",
  min,
  describedBy,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
  min?: number;
  describedBy?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      value={text}
      aria-describedby={describedBy}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const n = Number(text);
        if (Number.isFinite(n)) onChange(n);
        else setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      className={inputCls}
    />
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const hintId = `${htmlFor}-hint`;
  return (
    <div>
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

function SectionCard({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4 sm:p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">{blurb}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CollapsibleSection({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-card border border-line bg-surface/40">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:p-5">
        <span className="min-w-0">
          <span className="block text-lg font-semibold text-ink">{title}</span>
          <span className="mt-1 block text-sm text-ink-muted">{blurb}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="mt-1 h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line p-4 sm:p-5">{children}</div>
    </details>
  );
}

/* Read-only "this is locked by design" note for behavior the admin cannot change
   this phase (FF Beacon source lock, DST/K always in the room). */
function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-card border border-line bg-base/50 px-3 py-2 text-sm text-ink-muted">
      <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />
      <span>{children}</span>
    </p>
  );
}

/** Aggressiveness preset -> need weight (value = 1 - need). Reach is left as set. */
const AGGRESSIVENESS_NEED: Record<TeamNeedAggressiveness, number> = {
  conservative: 0.25,
  balanced: 0.4,
  aggressive: 0.55,
};

export function OnTheClockSettingsManager({
  initialSettings,
  lastUpdated,
}: {
  initialSettings: OnTheClockSettings;
  lastUpdated: string | null;
}) {
  const [settings, setSettings] = useState<OnTheClockSettings>(initialSettings);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const ids = useId();

  // ---- typed nested updaters ----
  const patchFeature = (next: Partial<OnTheClockSettings["feature"]>) =>
    setSettings((s) => ({ ...s, feature: { ...s.feature, ...next } }));
  const patchSync = (next: Partial<OnTheClockSettings["sync"]>) =>
    setSettings((s) => ({ ...s, sync: { ...s.sync, ...next } }));
  const patchCache = (next: Partial<OnTheClockSettings["cache"]>) =>
    setSettings((s) => ({ ...s, cache: { ...s.cache, ...next } }));
  const patchLimits = (next: Partial<OnTheClockSettings["limits"]>) =>
    setSettings((s) => ({ ...s, limits: { ...s.limits, ...next } }));
  const patchRec = (next: Partial<OnTheClockSettings["recommendation"]>) =>
    setSettings((s) => ({ ...s, recommendation: { ...s.recommendation, ...next } }));
  const patchWeights = (next: Partial<OnTheClockSettings["recommendation"]["weights"]>) =>
    setSettings((s) => ({
      ...s,
      recommendation: { ...s.recommendation, weights: { ...s.recommendation.weights, ...next } },
    }));
  const patchDstk = (next: Partial<OnTheClockSettings["dstk"]>) =>
    setSettings((s) => ({ ...s, dstk: { ...s.dstk, ...next } }));
  const patchPosAdjust = (next: Partial<OnTheClockSettings["positionAdjust"]>) =>
    setSettings((s) => ({ ...s, positionAdjust: { ...s.positionAdjust, ...next } }));
  const patchTargets = (next: Partial<OnTheClockSettings["positionFallbackTargets"]>) =>
    setSettings((s) => ({
      ...s,
      positionFallbackTargets: { ...s.positionFallbackTargets, ...next },
    }));

  // Changing the preset seeds the need + value weights, mirroring the plan's presets.
  const setAggressiveness = (preset: TeamNeedAggressiveness) =>
    setSettings((s) => {
      const need = AGGRESSIVENESS_NEED[preset];
      return {
        ...s,
        recommendation: {
          ...s.recommendation,
          aggressiveness: preset,
          weights: { ...s.recommendation.weights, need, value: Math.round((1 - need) * 100) / 100 },
        },
      };
    });

  function save() {
    setStatus("");
    startTransition(async () => {
      const res = await saveOnTheClockSettings(settings);
      if (res.ok) {
        setStatus("Saved.");
      } else {
        setStatus(`Failed: ${res.error}`);
      }
    });
  }

  function resetForm() {
    setSettings((s) => ({
      ...DEFAULT_ON_THE_CLOCK_SETTINGS,
      // Keep the current launch state so a reset never silently flips the tool.
      feature: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.feature, enabled: s.feature.enabled },
    }));
    setStatus(
      "Settings reset to recommended defaults in this form (the on/off state is kept). Nothing is saved until you press Save settings.",
    );
  }

  function resetSaved() {
    const ok = window.confirm(
      "Reset On The Clock settings to recommended defaults and save now? The on/off state is kept. This cannot be undone.",
    );
    if (!ok) return;
    setStatus("");
    startTransition(async () => {
      const res = await resetOnTheClockSettings();
      if (res.ok) {
        setSettings(res.settings);
        setStatus("Reset to defaults and saved.");
      } else {
        setStatus(`Failed: ${res.error}`);
      }
    });
  }

  return (
    <div className="mt-8 space-y-6">
      <p aria-live="polite" className="text-sm text-ink-muted">
        {isPending ? "Saving..." : status}
      </p>

      {/* 1. Feature status */}
      <SectionCard
        title="Feature status"
        blurb="Turn the public On The Clock tool on or off. While off, visitors see a friendly 'not enabled yet' message and none of the draft routes respond."
      >
        <Toggle
          id={`${ids}-enabled`}
          checked={settings.feature.enabled}
          onChange={(v) => patchFeature({ enabled: v })}
          label="On The Clock is live (visible and usable by the public)"
          hint="Leave this off until you are ready to launch. The setting ships off."
        />
      </SectionCard>

      {/* 2. Sync & Sleeper limits */}
      <SectionCard
        title="Sync and Sleeper limits"
        blurb="How often the room can pull fresh picks from Sleeper, and how many drafting leagues a user can load at once."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Sync cooldown (seconds)"
            htmlFor={`${ids}-cooldown`}
            hint="Minimum wait between Sleeper refreshes for one draft, shared across everyone watching it. Lower feels more live but hits Sleeper more often. 30 is a safe default."
          >
            <NumberInput
              id={`${ids}-cooldown`}
              value={settings.sync.cooldownSeconds}
              onChange={(n) => patchSync({ cooldownSeconds: Math.round(n) })}
              step="1"
              min={5}
            />
          </Field>
          <Field
            label="In-progress lock (seconds)"
            htmlFor={`${ids}-lock`}
            hint="How long one sync holds the lock so two people syncing at once only hit Sleeper once. Must be at most the cooldown; 15 is fine."
          >
            <NumberInput
              id={`${ids}-lock`}
              value={settings.sync.lockSeconds}
              onChange={(n) => patchSync({ lockSeconds: Math.round(n) })}
              step="1"
              min={1}
            />
          </Field>
          <Field
            label="Max drafting leagues shown"
            htmlFor={`${ids}-maxleagues`}
            hint="The most active-draft leagues a user can load from one lookup."
          >
            <NumberInput
              id={`${ids}-maxleagues`}
              value={settings.limits.maxActiveLeagues}
              onChange={(n) => patchLimits({ maxActiveLeagues: Math.round(n) })}
              step="1"
              min={1}
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              id={`${ids}-realtime`}
              checked={settings.sync.realtimeEnabled}
              onChange={(v) => patchSync({ realtimeEnabled: v })}
              label="Live updates between viewers (Realtime)"
              hint="When on, a pick one viewer syncs appears for everyone else with no extra Sleeper call. When off, the room updates only when someone presses Sync."
            />
          </div>
        </div>
      </SectionCard>

      {/* 3. Board & player pool (read-only notes this phase) */}
      <SectionCard
        title="Board and player pool"
        blurb="How the available player board is built. These are locked by design right now."
      >
        <div className="space-y-2">
          <LockedNote>
            Player values always come from <span className="font-medium text-ink">FF Beacon</span>.
            The draft room does not use the global source toggle.
          </LockedNote>
          <LockedNote>
            The scoring format is detected automatically from each Sleeper league (the closest FF
            Beacon format is used when there is no exact match).
          </LockedNote>
          <LockedNote>
            Defenses and kickers always appear in the board, lists, and picks. Whether they can be
            recommended is controlled under Recommendation engine below.
          </LockedNote>
        </div>
      </SectionCard>

      {/* 4. Recommendation engine */}
      <SectionCard
        title="Recommendation engine"
        blurb="Tune the Team Need pick. Best Available is always pure value and is not affected by these. Adjust if Team Need feels too safe or too aggressive."
      >
        <div className="space-y-6">
          <Toggle
            id={`${ids}-teamneed`}
            checked={settings.recommendation.teamNeedEnabled}
            onChange={(v) => patchRec({ teamNeedEnabled: v })}
            label="Show the Team Need recommendation"
            hint="When off, only Best Available (pure value) is shown."
          />

          <fieldset>
            <legend className="text-sm font-semibold text-ink">How aggressive Team Need is</legend>
            <p className="mt-1 text-xs text-ink-subtle">
              Picking a preset sets the value and need weights below. You can still fine-tune them
              after.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Aggressiveness preset" htmlFor={`${ids}-aggr`}>
                <select
                  id={`${ids}-aggr`}
                  value={settings.recommendation.aggressiveness}
                  onChange={(e) =>
                    setAggressiveness(e.target.value as TeamNeedAggressiveness)
                  }
                  className={inputCls}
                >
                  <option value="conservative">Conservative (lean toward best value)</option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive (lean toward filling needs)</option>
                </select>
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Value weight"
                htmlFor={`${ids}-wvalue`}
                hint="How much pure player value counts. Higher = recommend the best player more often."
              >
                <NumberInput
                  id={`${ids}-wvalue`}
                  value={settings.recommendation.weights.value}
                  onChange={(n) => patchWeights({ value: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Need weight"
                htmlFor={`${ids}-wneed`}
                hint="How much filling a roster hole counts. Higher = recommend needed positions more."
              >
                <NumberInput
                  id={`${ids}-wneed`}
                  value={settings.recommendation.weights.need}
                  onChange={(n) => patchWeights({ need: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Reach penalty weight"
                htmlFor={`${ids}-wreach`}
                hint="How much to discourage drafting a player far below the best one at the same position. Keep small."
              >
                <NumberInput
                  id={`${ids}-wreach`}
                  value={settings.recommendation.weights.reach}
                  onChange={(n) => patchWeights({ reach: n })}
                  min={0}
                />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Max acceptable reach (tiers)"
                htmlFor={`${ids}-reachtier`}
                hint="The reach penalty only kicks in once a player is more than this many tiers below the best player at their position. Prevents punishing a sensible need pick."
              >
                <NumberInput
                  id={`${ids}-reachtier`}
                  value={settings.recommendation.maxReachTierBreak}
                  onChange={(n) => patchRec({ maxReachTierBreak: n })}
                  min={0}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">Format priority boosts</legend>
            <p className="mt-1 text-xs text-ink-subtle">
              Extra weight for positions that matter more in certain league types.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Superflex QB boost"
                htmlFor={`${ids}-sfqb`}
                hint="Raises QB need in superflex leagues. 1.0 = no boost; 1.25 is a sensible default."
              >
                <NumberInput
                  id={`${ids}-sfqb`}
                  value={settings.positionAdjust.superflexQbMultiplier}
                  onChange={(n) => patchPosAdjust({ superflexQbMultiplier: n })}
                  min={0.1}
                />
              </Field>
              <Field
                label="TE premium boost"
                htmlFor={`${ids}-tep`}
                hint="Raises TE need in tight-end premium leagues. 1.0 = no boost; 1.15 is a sensible default."
              >
                <NumberInput
                  id={`${ids}-tep`}
                  value={settings.positionAdjust.tePremiumMultiplier}
                  onChange={(n) => patchPosAdjust({ tePremiumMultiplier: n })}
                  min={0.1}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">Defense and kicker recommendations</legend>
            <p className="mt-1 text-xs text-ink-subtle">
              DEF and K always appear in the room. These control whether and when they can be the
              Team Need pick.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="When to recommend DEF/K" htmlFor={`${ids}-dstkbehav`}>
                <select
                  id={`${ids}-dstkbehav`}
                  value={settings.dstk.recommendBehavior}
                  onChange={(e) =>
                    patchDstk({ recommendBehavior: e.target.value as DstkRecommendBehavior })
                  }
                  className={inputCls}
                >
                  <option value="suppress_until_need">Only late, when the roster needs one</option>
                  <option value="never">Never recommend DEF/K</option>
                  <option value="always_allowed">Treat like any other position</option>
                </select>
              </Field>
              <div className="flex items-end">
                <Toggle
                  id={`${ids}-dstkslot`}
                  checked={settings.dstk.requireStartingSlot}
                  onChange={(v) => patchDstk({ requireStartingSlot: v })}
                  label="Only if the league starts a DEF/K"
                  hint="Skip the recommendation in leagues that do not start that position."
                />
              </div>
              <Field
                label="Earliest round for DEF"
                htmlFor={`${ids}-mindef`}
                hint="A defense can only be recommended at or after this round."
              >
                <NumberInput
                  id={`${ids}-mindef`}
                  value={settings.dstk.minRoundForDst}
                  onChange={(n) => patchDstk({ minRoundForDst: Math.round(n) })}
                  step="1"
                  min={1}
                />
              </Field>
              <Field
                label="Earliest round for K"
                htmlFor={`${ids}-mink`}
                hint="A kicker can only be recommended at or after this round."
              >
                <NumberInput
                  id={`${ids}-mink`}
                  value={settings.dstk.minRoundForK}
                  onChange={(n) => patchDstk({ minRoundForK: Math.round(n) })}
                  step="1"
                  min={1}
                />
              </Field>
            </div>
          </fieldset>
        </div>
      </SectionCard>

      {/* 5. Trade Analyzer (informational) */}
      <SectionCard
        title="Trade Analyzer"
        blurb="The in-draft Trade Analyzer compares the value of two sides of a deal."
      >
        <LockedNote>
          Trade values are read from the same FF Beacon board. Draft pick values are projected from
          the board and shown as estimates. The projection settings (discounts and caps) are fixed in
          code for now and are not adjustable here.
        </LockedNote>
      </SectionCard>

      {/* 6. Advanced (collapsed): position fallback targets */}
      <CollapsibleSection
        title="Advanced: starting lineup fallback"
        blurb="Used only when a Sleeper league's roster settings cannot be read. These say how many of each position a typical starting lineup needs, so Team Need still works."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ["QB", "QB"],
              ["RB", "RB"],
              ["WR", "WR"],
              ["TE", "TE"],
              ["FLEX", "FLEX"],
              ["SUPER_FLEX", "Superflex"],
              ["K", "K"],
              ["DEF", "DEF"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`${ids}-tgt-${key}`}>
              <NumberInput
                id={`${ids}-tgt-${key}`}
                value={settings.positionFallbackTargets[key]}
                onChange={(n) => patchTargets({ [key]: Math.round(n) })}
                step="1"
                min={0}
              />
            </Field>
          ))}
        </div>
      </CollapsibleSection>

      {/* 7. Maintenance / debug */}
      <CollapsibleSection
        title="Maintenance and details"
        blurb="Cache cleanup windows, when the settings were last saved, and the raw settings for reference."
      >
        <div className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">Cache cleanup windows</legend>
            <p className="mt-1 text-xs text-ink-subtle">
              How long cached drafts are kept before they can be pruned. These take effect whenever the
              cleanup job runs.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Active draft cache (hours)"
                htmlFor={`${ids}-activettl`}
                hint="An unfinished draft with no activity for this long can be removed. 24 hours is the default."
              >
                <NumberInput
                  id={`${ids}-activettl`}
                  value={settings.cache.activeTtlHours}
                  onChange={(n) => patchCache({ activeTtlHours: Math.round(n) })}
                  step="1"
                  min={1}
                />
              </Field>
              <Field
                label="Completed draft cache (hours)"
                htmlFor={`${ids}-completedttl`}
                hint="A finished draft is kept this long before it can be removed. 168 hours (7 days) is the default."
              >
                <NumberInput
                  id={`${ids}-completedttl`}
                  value={settings.cache.completedRetentionHours}
                  onChange={(n) => patchCache({ completedRetentionHours: Math.round(n) })}
                  step="1"
                  min={1}
                />
              </Field>
            </div>
          </fieldset>

          <div>
            <p className="text-sm font-semibold text-ink">Last saved</p>
            <p className="mt-1 text-sm text-ink-muted">
              {lastUpdated
                ? formatEastern(lastUpdated)
                : "Never saved yet (the tool is running on code defaults)."}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-ink">Current settings (read-only)</p>
            <pre className="mt-1 max-h-72 overflow-auto rounded-card border border-line bg-base/60 p-3 text-[11px] leading-relaxed text-ink-muted">
              {JSON.stringify(settings, null, 2)}
            </pre>
          </div>
        </div>
      </CollapsibleSection>

      {/* Actions */}
      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-line bg-base/85 py-4 backdrop-blur">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex min-h-11 items-center rounded-card bg-beacon px-5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {isPending ? "Saving..." : "Save settings"}
        </button>
        <button
          type="button"
          onClick={resetForm}
          disabled={isPending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset form to defaults
        </button>
        <button
          type="button"
          onClick={resetSaved}
          disabled={isPending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset to defaults and save
        </button>
      </div>
    </div>
  );
}
