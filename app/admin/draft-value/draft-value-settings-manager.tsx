"use client";

/**
 * Beacon Steals model tuning form.
 *
 * Every number the engine reads is editable here so the model can be adjusted
 * without a deploy. Grouped by what the setting DOES rather than by the shape of
 * the JSON, and each group says what changing it costs.
 *
 * Accessibility: every input has a real label tied by id, the toggles are real
 * switches with aria-checked, the save result is announced through a polite live
 * region, and reset is a button so it never navigates.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import type { DraftValueSettings } from "@/lib/draft-value/default-settings";
import { DEFAULT_DRAFT_VALUE_SETTINGS } from "@/lib/draft-value/default-settings";
import { saveDraftValueSettingsAction } from "./actions";

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
      aria-describedby={describedBy}
      value={text}
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
  // The hint is tied to the input with aria-describedby. Without it a screen
  // reader hears "Teams, spin button" and never the sentence explaining what
  // the number does, which for a model-tuning form is most of the information.
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <NumberInput
        id={id}
        value={value}
        onChange={onChange}
        step={step}
        min={min}
        max={max}
        describedBy={hintId}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] leading-tight text-ink-muted">
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
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hintId}
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
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] leading-tight text-ink-muted">
          {hint}
        </p>
      )}
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
  // aria-labelledby makes each group a real region landmark, so the eight
  // setting groups can be jumped between rather than tabbed through.
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5"
    >
      <h2 id={headingId} className="text-sm font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

export function DraftValueSettingsManager({
  initialSettings,
}: {
  initialSettings: DraftValueSettings;
}) {
  const [settings, setSettings] = useState<DraftValueSettings>(initialSettings);
  const [status, setStatus] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const patch = <K extends keyof DraftValueSettings>(
    key: K,
    value: Partial<DraftValueSettings[K]>,
  ) => {
    setSettings((s) => ({ ...s, [key]: { ...(s[key] as object), ...value } }));
  };

  const patchShape = (value: Partial<DraftValueSettings["leagueShape"]>) =>
    patch("leagueShape", value);

  const starterTotal =
    settings.leagueShape.starters.QB +
    settings.leagueShape.starters.RB +
    settings.leagueShape.starters.WR +
    settings.leagueShape.starters.TE +
    settings.leagueShape.flex;

  const flexShareTotal =
    settings.leagueShape.flexShare.RB +
    settings.leagueShape.flexShare.WR +
    settings.leagueShape.flexShare.TE;

  const [failed, setFailed] = useState(false);

  const save = () => {
    // Guarding on `pending` here rather than disabling the button: Chrome moves
    // focus to <body> when the focused element becomes disabled, so a keyboard
    // user loses their place mid-save.
    if (pending) return;
    setStatus("");
    setFailed(false);
    startTransition(async () => {
      const result = await saveDraftValueSettingsAction(settings);
      setFailed(!result.ok);
      setStatus(
        result.ok
          ? "Saved. The board rescores on the next nightly rebuild, or run npm run calculate:draft-value now."
          : `Error: could not save. ${result.error}`,
      );
    });
  };

  return (
    <div className="mt-6 space-y-5">
      <Section
        title="League shape"
        description={`What a league is assumed to start, which is what sets the replacement level at each position. A superflex format adds one quarterback on top of this. Current starting lineup: ${starterTotal} slots.`}
      >
        <Field
          label="Teams"
          value={settings.leagueShape.teams}
          onChange={(v) => patchShape({ teams: v })}
          step="1"
          min={4}
          max={32}
          hint="Also the divisor that turns a gap in picks into a gap in rounds."
        />
        <Field
          label="Starting QB"
          value={settings.leagueShape.starters.QB}
          onChange={(v) =>
            patchShape({ starters: { ...settings.leagueShape.starters, QB: v } })
          }
        />
        <Field
          label="Starting RB"
          value={settings.leagueShape.starters.RB}
          onChange={(v) =>
            patchShape({ starters: { ...settings.leagueShape.starters, RB: v } })
          }
        />
        <Field
          label="Starting WR"
          value={settings.leagueShape.starters.WR}
          onChange={(v) =>
            patchShape({ starters: { ...settings.leagueShape.starters, WR: v } })
          }
        />
        <Field
          label="Starting TE"
          value={settings.leagueShape.starters.TE}
          onChange={(v) =>
            patchShape({ starters: { ...settings.leagueShape.starters, TE: v } })
          }
        />
        <Field
          label="Flex slots"
          value={settings.leagueShape.flex}
          onChange={(v) => patchShape({ flex: v })}
        />
        <Toggle
          label="Superflex adds a QB"
          checked={settings.leagueShape.superflexAddsQb}
          onChange={(v) => patchShape({ superflexAddsQb: v })}
          hint="Off would price a superflex board as though it started one quarterback."
        />
      </Section>

      <Section
        title="Flex share"
        description={`How flex demand splits across the eligible positions. Tight ends win a flex slot far less often than they are eligible for one, so giving TE a full share pushes its replacement level down to a level nobody drafts for. Current total: ${flexShareTotal.toFixed(2)} of one slot.`}
      >
        <Field
          label="RB share"
          value={settings.leagueShape.flexShare.RB}
          onChange={(v) =>
            patchShape({ flexShare: { ...settings.leagueShape.flexShare, RB: v } })
          }
          min={0}
          max={1}
        />
        <Field
          label="WR share"
          value={settings.leagueShape.flexShare.WR}
          onChange={(v) =>
            patchShape({ flexShare: { ...settings.leagueShape.flexShare, WR: v } })
          }
          min={0}
          max={1}
        />
        <Field
          label="TE share"
          value={settings.leagueShape.flexShare.TE}
          onChange={(v) =>
            patchShape({ flexShare: { ...settings.leagueShape.flexShare, TE: v } })
          }
          min={0}
          max={1}
        />
      </Section>

      <Section
        title="Value against points"
        description="How the asset ladder and the projected-points ladder combine into where we would draft a player. Redraft leans on points because this season is the whole game; dynasty leans on value because a young player with modest current points is still the asset. Each pair is normalized, so they do not have to sum to 1."
      >
        <Field
          label="Redraft: value"
          value={settings.blend.redraft.value}
          onChange={(v) => patch("blend", { redraft: { ...settings.blend.redraft, value: v } })}
        />
        <Field
          label="Redraft: points"
          value={settings.blend.redraft.points}
          onChange={(v) => patch("blend", { redraft: { ...settings.blend.redraft, points: v } })}
        />
        <div />
        <Field
          label="Dynasty: value"
          value={settings.blend.dynasty.value}
          onChange={(v) => patch("blend", { dynasty: { ...settings.blend.dynasty, value: v } })}
        />
        <Field
          label="Dynasty: points"
          value={settings.blend.dynasty.points}
          onChange={(v) => patch("blend", { dynasty: { ...settings.blend.dynasty, points: v } })}
        />
      </Section>

      <Section
        title="Reliability and availability"
        description="Multipliers on a projection, from player_projection_accuracy. Both default to 1 for a player with no graded history, so a rookie is neither rewarded nor punished for having none."
      >
        <Toggle
          label="Use reliability"
          checked={settings.reliability.enabled}
          onChange={(v) => patch("reliability", { enabled: v })}
        />
        <Field
          label="Reliability floor"
          value={settings.reliability.minMultiplier}
          onChange={(v) => patch("reliability", { minMultiplier: v })}
        />
        <Field
          label="Reliability ceiling"
          value={settings.reliability.maxMultiplier}
          onChange={(v) => patch("reliability", { maxMultiplier: v })}
        />
        <Toggle
          label="Use availability"
          checked={settings.availability.enabled}
          onChange={(v) => patch("availability", { enabled: v })}
        />
        <Field
          label="Availability damping"
          value={settings.availability.damping}
          onChange={(v) => patch("availability", { damping: v })}
          hint="Blends availability toward 1 so a missed season never zeroes a player out."
        />
        <Field
          label="Availability floor"
          value={settings.availability.minMultiplier}
          onChange={(v) => patch("availability", { minMultiplier: v })}
        />
      </Section>

      <Section
        title="Confidence"
        description="The guard against deep-board noise. The raw gap between our opinion and the market is largest exactly where both numbers are least reliable, so confidence decays with depth and multiplies into the score. Loosening this puts unknown players back at the top of the board."
      >
        <Field
          label="Market trusted to pick"
          value={settings.confidence.marketTrustedDepth}
          onChange={(v) => patch("confidence", { marketTrustedDepth: v })}
          step="1"
          hint="ADP is fully trusted to here, then decays toward the floor."
        />
        <Field
          label="Market floor"
          value={settings.confidence.marketFloor}
          onChange={(v) => patch("confidence", { marketFloor: v })}
        />
        <Field
          label="Value trusted to rank"
          value={settings.confidence.valueTrustedDepth}
          onChange={(v) => patch("confidence", { valueTrustedDepth: v })}
          step="1"
        />
        <Field
          label="Value floor"
          value={settings.confidence.valueFloor}
          onChange={(v) => patch("confidence", { valueFloor: v })}
        />
        <Field
          label="Projection and history"
          value={settings.confidence.bothDataFactor}
          onChange={(v) => patch("confidence", { bothDataFactor: v })}
        />
        <Field
          label="Projection only"
          value={settings.confidence.projectionOnlyFactor}
          onChange={(v) => patch("confidence", { projectionOnlyFactor: v })}
          hint="Where rookies land."
        />
        <Field
          label="Neither"
          value={settings.confidence.noCompetitiveFactor}
          onChange={(v) => patch("confidence", { noCompetitiveFactor: v })}
        />
        <Field
          label="Room ADP minimum drafts"
          value={settings.confidence.roomMinDrafts}
          onChange={(v) => patch("confidence", { roomMinDrafts: v })}
          step="1"
          hint="Below this our own synced drafts say nothing."
        />
        <Field
          label="Room agreement ceiling"
          value={settings.confidence.roomAgreementMax}
          onChange={(v) => patch("confidence", { roomAgreementMax: v })}
        />
        <Field
          label="Room agreement floor"
          value={settings.confidence.roomAgreementMin}
          onChange={(v) => patch("confidence", { roomAgreementMin: v })}
        />
        <Field
          label="Room agreement rounds"
          value={settings.confidence.roomAgreementRounds}
          onChange={(v) => patch("confidence", { roomAgreementRounds: v })}
          hint="Rounds of disagreement between our rooms and the public market that saturate the adjustment."
        />
        <Field
          label="Minimum to be called a steal"
          value={settings.confidence.minConfidence}
          onChange={(v) => patch("confidence", { minConfidence: v })}
        />
      </Section>

      <Section
        title="Positional centering"
        description="A points-above-replacement model and a real draft market disagree about whole positions, not only about players. Ours wants elite quarterbacks earlier than a one-QB room takes them. Subtracting each position's median gap before ranking keeps the board about players. Switching this off put quarterbacks in all twelve of the top twelve slots on the test board."
      >
        <Toggle
          label="Center by position"
          checked={settings.positionCentering.enabled}
          onChange={(v) => patch("positionCentering", { enabled: v })}
        />
        <Field
          label="Minimum players to center"
          value={settings.positionCentering.minPlayers}
          onChange={(v) => patch("positionCentering", { minPlayers: v })}
          step="1"
          hint="Below this the median is itself noise, so the position is left alone."
        />
      </Section>

      <Section
        title="Score and categories"
        description="Turning a gap in rounds into a 0 to 100 score and one of the four buckets. 50 is neutral."
      >
        <Field
          label="Saturation (rounds)"
          value={settings.scoring.stealSaturationRounds}
          onChange={(v) => patch("scoring", { stealSaturationRounds: v })}
          hint="Gap at which the score reaches 0 or 100."
        />
        <Field
          label="Steal threshold (rounds)"
          value={settings.scoring.stealMinRounds}
          onChange={(v) => patch("scoring", { stealMinRounds: v })}
        />
        <Field
          label="Fade threshold (rounds)"
          value={settings.scoring.fadeMinRounds}
          onChange={(v) => patch("scoring", { fadeMinRounds: v })}
        />
        <Field
          label="Swing threshold (rounds)"
          value={settings.scoring.swingMinRounds}
          onChange={(v) => patch("scoring", { swingMinRounds: v })}
        />
        <Field
          label="Late-round pick"
          value={settings.scoring.lateRoundPick}
          onChange={(v) => patch("scoring", { lateRoundPick: v })}
          step="1"
          hint="A swing has to actually be available at or after this pick."
        />
        <div>
          <label htmlFor="dv-model-version" className="block text-xs font-medium text-ink-muted">
            Model version
          </label>
          <input
            id="dv-model-version"
            type="text"
            value={settings.modelVersion}
            onChange={(e) => setSettings((s) => ({ ...s, modelVersion: e.target.value }))}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] leading-tight text-ink-muted">
            Stamped on every row, so an older model is identifiable after a change.
          </p>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          aria-disabled={pending}
          aria-busy={pending}
          className={`inline-flex min-h-11 items-center rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
            pending ? "opacity-60" : ""
          }`}
        >
          {pending ? "Saving..." : "Save model"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSettings(DEFAULT_DRAFT_VALUE_SETTINGS);
            setStatus("Reset to code defaults. Not saved yet.");
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset to defaults
        </button>
        {/* A failure is announced as an alert so it is not queued politely
            behind whatever else is speaking; a success stays polite. */}
        <p
          role={failed ? "alert" : "status"}
          aria-live={failed ? "assertive" : "polite"}
          className="text-sm text-ink-muted"
        >
          {status}
        </p>
      </div>
    </div>
  );
}
