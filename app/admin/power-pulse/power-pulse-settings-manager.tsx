"use client";

/**
 * Power Pulse model tuning form.
 *
 * Every number the engine reads is editable here so the model can be adjusted
 * without a deploy. Grouped by what the setting actually does rather than by the
 * shape of the JSON, and each group states the consequence of changing it.
 *
 * Accessibility: every input has a real label tied by id, the save result is
 * announced through a polite live region, and the reset control is a button
 * rather than a link so it never navigates.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import { WAR_SETTING_BOUNDS } from "@/lib/positional-war/default-settings";
import { savePowerPulseSettingsAction } from "./actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function NumberInput({
  id,
  value,
  onChange,
  step = "any",
  min,
  max,
  describedBy,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
  min?: number;
  max?: number;
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
      max={max}
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
  value,
  onChange,
  hint,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
  step?: string;
  min?: number;
  max?: number;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        {label}
      </label>
      <NumberInput
        id={id}
        value={value}
        onChange={onChange}
        step={step}
        min={min}
        max={max}
        describedBy={hint ? hintId : undefined}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] leading-tight text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="inline-flex min-h-11 items-center gap-2.5 text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <span
          aria-hidden="true"
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            checked ? "bg-brand-cyan" : "bg-line-accent"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
        {label}
      </button>
      {hint && <p className="mt-1 text-[11px] leading-tight text-ink-subtle">{hint}</p>}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  describedBy,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  describedBy: string;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={describedBy}
        className="h-5 w-5 shrink-0 rounded border-line bg-base text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
      <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

export function PowerPulseSettingsManager({
  initialSettings,
}: {
  initialSettings: PowerPulseSettings;
}) {
  const [settings, setSettings] = useState<PowerPulseSettings>(initialSettings);
  const [status, setStatus] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const patch = <K extends keyof PowerPulseSettings>(
    key: K,
    value: Partial<PowerPulseSettings[K]>,
  ) => {
    setSettings((s) => ({ ...s, [key]: { ...(s[key] as object), ...value } }));
  };

  const weightTotal =
    settings.weights.points +
    settings.weights.schedule +
    settings.weights.depth +
    settings.weights.form;

  const save = () => {
    setStatus("");
    startTransition(async () => {
      const result = await savePowerPulseSettingsAction(settings);
      setStatus(
        result.ok
          ? "Saved. Leagues rescore on their next load once the cache goes stale."
          : `Could not save. ${result.error}`,
      );
    });
  };

  return (
    <div className="mt-6 space-y-5">
      <Section
        title="Component weights"
        description={`How the four parts combine into the headline score. They do not have to sum to 1, they are normalized. Current total: ${weightTotal.toFixed(2)}. When no games have been played, the form weight is redistributed across the other three.`}
      >
        <Field
          label="Scoring"
          value={settings.weights.points}
          onChange={(v) => patch("weights", { points: v })}
          hint="Projected points per week."
          min={0}
          max={1}
        />
        <Field
          label="Schedule"
          value={settings.weights.schedule}
          onChange={(v) => patch("weights", { schedule: v })}
          hint="Schedule-adjusted win rate."
          min={0}
          max={1}
        />
        <Field
          label="Depth"
          value={settings.weights.depth}
          onChange={(v) => patch("weights", { depth: v })}
          hint="Injury absorption and bye coverage."
          min={0}
          max={1}
        />
        <Field
          label="Form"
          value={settings.weights.form}
          onChange={(v) => patch("weights", { form: v })}
          hint="Recent results against expectation."
          min={0}
          max={1}
        />
      </Section>

      <Section
        title="Recency weighting"
        description="How much a graded game counts based on how long ago it happened. The current season is the strongest signal because roles and offenses change between years. Lower the older-season values to make the model react faster."
      >
        <Field
          label="Current season"
          value={settings.recency.currentSeason}
          onChange={(v) => patch("recency", { currentSeason: v })}
          min={0}
          max={1}
        />
        <Field
          label="One season back"
          value={settings.recency.oneSeasonBack}
          onChange={(v) => patch("recency", { oneSeasonBack: v })}
          min={0}
          max={1}
        />
        <Field
          label="Two seasons back"
          value={settings.recency.twoSeasonsBack}
          onChange={(v) => patch("recency", { twoSeasonsBack: v })}
          min={0}
          max={1}
        />
        <Field
          label="Older seasons"
          value={settings.recency.olderSeasons}
          onChange={(v) => patch("recency", { olderSeasons: v })}
          min={0}
          max={1}
        />
        <Field
          label="Half life, weeks"
          value={settings.recency.currentSeasonHalfLifeWeeks}
          onChange={(v) => patch("recency", { currentSeasonHalfLifeWeeks: v })}
          hint="Within the current season, how many weeks until a game counts half as much."
          step="1"
          min={1}
          max={52}
        />
      </Section>

      <Section
        title="Projection reliability"
        description="Adjusts a player's projection by how far he beats it compared with others at his own position. Prior games is the shrinkage strength: higher pulls small samples harder toward neutral. Keep the multiplier range narrow. Whether a player beats his projection has no measured year to year persistence, so a wide range reorders the board on noise rather than on football."
      >
        <Toggle
          label="Reliability enabled"
          checked={settings.reliability.enabled}
          onChange={(v) => patch("reliability", { enabled: v })}
        />
        <Field
          label="Prior games"
          value={settings.reliability.priorGames}
          onChange={(v) => patch("reliability", { priorGames: v })}
          step="1"
          min={0}
        />
        <Field
          label="Minimum multiplier"
          value={settings.reliability.minMultiplier}
          onChange={(v) => patch("reliability", { minMultiplier: v })}
        />
        <Field
          label="Maximum multiplier"
          value={settings.reliability.maxMultiplier}
          onChange={(v) => patch("reliability", { maxMultiplier: v })}
        />
      </Section>

      <Section
        title="Availability"
        description="Players who miss time are worth less than their per-game projection suggests. Damping controls how much of that penalty applies: 0 ignores availability entirely, 1 applies it in full."
      >
        <Toggle
          label="Availability enabled"
          checked={settings.availability.enabled}
          onChange={(v) => patch("availability", { enabled: v })}
        />
        <Field
          label="Damping"
          value={settings.availability.damping}
          onChange={(v) => patch("availability", { damping: v })}
          min={0}
          max={1}
        />
        <Field
          label="Floor multiplier"
          value={settings.availability.minMultiplier}
          onChange={(v) => patch("availability", { minMultiplier: v })}
        />
      </Section>

      <Section
        title="Opponent strength"
        description="How much an opposing NFL defense moves a projection, from our own defense-versus-position splits. Sleeper's projections barely adjust for opponent, so this is where schedule signal comes from."
      >
        <Toggle
          label="Opponent adjustment enabled"
          checked={settings.opponent.enabled}
          onChange={(v) => patch("opponent", { enabled: v })}
        />
        <Field
          label="Minimum multiplier"
          value={settings.opponent.minMultiplier}
          onChange={(v) => patch("opponent", { minMultiplier: v })}
        />
        <Field
          label="Maximum multiplier"
          value={settings.opponent.maxMultiplier}
          onChange={(v) => patch("opponent", { maxMultiplier: v })}
        />
        <Field
          label="Recent season weight"
          value={settings.opponent.currentSeasonWeight}
          onChange={(v) => patch("opponent", { currentSeasonWeight: v })}
          min={0}
          max={1}
        />
        <Field
          label="Prior season weight"
          value={settings.opponent.priorSeasonWeight}
          onChange={(v) => patch("opponent", { priorSeasonWeight: v })}
          min={0}
          max={1}
        />
        <Field
          label="Minimum games sampled"
          value={settings.opponent.minGamesSampled}
          onChange={(v) => patch("opponent", { minGamesSampled: v })}
          hint="Defenses with a thinner sample fall back to neutral."
          step="1"
          min={0}
        />
      </Section>

      <Section
        title="Weekly variance"
        description="How much a player's score swings week to week, as a share of their average. Drives win probabilities: a high-variance team beats a better opponent more often than the averages suggest. These are the fallbacks for players with no measured history."
      >
        {(["QB", "RB", "WR", "TE", "K", "DEF"] as const).map((position) => (
          <Field
            key={position}
            label={`${position} default`}
            value={settings.variance.defaultCv[position]}
            onChange={(v) =>
              patch("variance", {
                defaultCv: { ...settings.variance.defaultCv, [position]: v },
              })
            }
          />
        ))}
        <Field
          label="Games before measured"
          value={settings.variance.minGamesForMeasured}
          onChange={(v) => patch("variance", { minGamesForMeasured: v })}
          step="1"
          min={0}
        />
        <Field
          label="Minimum variance"
          value={settings.variance.minCv}
          onChange={(v) => patch("variance", { minCv: v })}
        />
        <Field
          label="Maximum variance"
          value={settings.variance.maxCv}
          onChange={(v) => patch("variance", { maxCv: v })}
        />
      </Section>

      <Section
        title="Simulation and display"
        description="Runs is how many times the remaining season is played out. Higher is smoother but slower, and this runs inline on a league page load. The seed keeps odds stable between recomputes. Sharpness stretches or compresses the 1 to 99 scale."
      >
        <Field
          label="Simulation runs"
          value={settings.simulation.runs}
          onChange={(v) => patch("simulation", { runs: v })}
          step="100"
          min={200}
          max={20000}
        />
        <Field
          label="Random seed"
          value={settings.simulation.seed}
          onChange={(v) => patch("simulation", { seed: Math.trunc(v) })}
          step="1"
        />
        <Field
          label="Score minimum"
          value={settings.display.min}
          onChange={(v) => patch("display", { min: v })}
          step="1"
        />
        <Field
          label="Score maximum"
          value={settings.display.max}
          onChange={(v) => patch("display", { max: v })}
          step="1"
        />
        <Field
          label="Sharpness"
          value={settings.display.sharpness}
          onChange={(v) => patch("display", { sharpness: v })}
          hint="Above 1 pushes the extremes apart; below 1 pulls the league together."
        />
        <div>
          <label
            htmlFor="pp-model-version"
            className="block text-xs font-medium text-ink-subtle"
          >
            Model version
          </label>
          <input
            id="pp-model-version"
            type="text"
            value={settings.modelVersion}
            onChange={(e) => setSettings((s) => ({ ...s, modelVersion: e.target.value }))}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] leading-tight text-ink-subtle">
            Change this to force every league to rescore on its next view.
          </p>
        </div>
      </Section>

      <Section
        title="Positional WAR"
        description="Controls the curve on the Positional WAR chart: how far it extends past replacement level, where a position's cliff falls, and whether a below-replacement player floors at zero. Saving does not recompute anything. Every field here is part of the cache key, so each league recomputes on its next view on its own."
      >
        <Field
          label="Curve depth multiple"
          value={settings.war.displayDepthMultiple}
          onChange={(v) => patch("war", { displayDepthMultiple: v })}
          hint="How far past the replacement line each position's curve is drawn, as a multiple of how many that league starts. Lower this to cut the curve shorter."
          step={String(WAR_SETTING_BOUNDS.displayDepthMultiple.step)}
          min={WAR_SETTING_BOUNDS.displayDepthMultiple.min}
          max={WAR_SETTING_BOUNDS.displayDepthMultiple.max}
        />
        <Field
          label="Minimum curve depth"
          value={settings.war.minDisplayDepth}
          onChange={(v) => patch("war", { minDisplayDepth: Math.trunc(v) })}
          hint="A floor on that length, so a position a league starts only twelve of still gets a readable curve."
          step={String(WAR_SETTING_BOUNDS.minDisplayDepth.step)}
          min={WAR_SETTING_BOUNDS.minDisplayDepth.min}
          max={WAR_SETTING_BOUNDS.minDisplayDepth.max}
        />
        <Field
          label="Cliff threshold"
          value={settings.war.cliffThreshold}
          onChange={(v) => patch("war", { cliffThreshold: v })}
          hint="The share of the best player's wins that marks where a position falls off. The cliff rank is the first player below it."
          step={String(WAR_SETTING_BOUNDS.cliffThreshold.step)}
          min={WAR_SETTING_BOUNDS.cliffThreshold.min}
          max={WAR_SETTING_BOUNDS.cliffThreshold.max}
        />
        <div>
          <Checkbox
            label="Clamp below-replacement players to zero"
            checked={settings.war.clampBelowReplacement}
            onChange={(v) => patch("war", { clampBelowReplacement: v })}
            describedBy="war-clamp-hint"
          />
          <p id="war-clamp-hint" className="mt-1 text-[11px] leading-tight text-ink-subtle">
            When on, a player below replacement level scores zero rather than a negative. Turn it
            off to let the chart show negative wins, and the y-axis then starts below zero.
          </p>
        </div>
        <div>
          <label htmlFor="war-model-version" className="block text-xs font-medium text-ink-subtle">
            Model version
          </label>
          <input
            id="war-model-version"
            type="text"
            value={settings.war.modelVersion}
            maxLength={WAR_SETTING_BOUNDS.modelVersion.maxLength}
            aria-describedby="war-model-version-hint"
            onChange={(e) => patch("war", { modelVersion: e.target.value })}
            className={inputCls}
          />
          <p id="war-model-version-hint" className="mt-1 text-[11px] leading-tight text-ink-subtle">
            Bump this by hand to force every league to recompute, for a change the fields above
            do not otherwise capture.
          </p>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save model"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSettings(DEFAULT_POWER_PULSE_SETTINGS);
            setStatus("Reset to code defaults. Not saved yet.");
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset to defaults
        </button>
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          {status}
        </p>
      </div>
    </div>
  );
}
