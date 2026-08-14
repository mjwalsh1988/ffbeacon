"use client";

import { useId, useState, useTransition } from "react";
import { Save } from "lucide-react";
import type { BeamSettings } from "@/lib/beam/default-settings";
import type { CapabilityId } from "@/lib/beam/types";
import { saveBeamSettings } from "@/app/admin/beam/actions";

/**
 * The BEAM settings editor.
 *
 * Deliberately a plain form of labelled number inputs rather than a slider
 * dashboard. These are thresholds an owner tunes once every few weeks after
 * reading the unanswered-questions list, and every one of them needs its "what
 * happens if I move this" explained next to it, which sliders have no room for.
 *
 * Validation is server-side (lib/beam/settings.ts). The client only stops a
 * blank field from being submitted as NaN.
 */

type CapabilityOption = { id: CapabilityId; label: string; description: string };

export function BeamSettingsManager({
  initial,
  capabilities,
}: {
  initial: BeamSettings;
  capabilities: CapabilityOption[];
}) {
  const [settings, setSettings] = useState<BeamSettings>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const patch = <K extends keyof BeamSettings>(key: K, value: Partial<BeamSettings[K]>) => {
    setSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
  };

  const toggleCapability = (id: CapabilityId, enabled: boolean) => {
    const disabled = new Set(settings.capabilities.disabled);
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    patch("capabilities", { disabled: [...disabled] });
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveBeamSettings(settings);
      setMessage(
        result.ok
          ? { kind: "ok", text: "Saved. New questions use these values immediately." }
          : { kind: "error", text: result.error },
      );
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) save();
      }}
      className="space-y-8"
    >
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-card border px-4 py-3 text-sm ${
            message.kind === "error"
              ? "border-signal-danger bg-signal-danger/10 text-ink"
              : "border-brand-cyan/50 bg-brand-cyan/10 text-ink"
          }`}
        >
          {message.text}
        </p>
      )}

      <Section
        title="Name matching"
        blurb="How sure BEAM has to be about WHO you meant before it answers instead of asking. Lowering these makes BEAM bolder and, eventually, confidently wrong."
      >
        <NumberField
          label="Accept confidence"
          help="Minimum score for the best match. 0.97 is an exact name, 0.95 a nickname, 0.88 a single name or initials."
          value={settings.resolver.acceptConfidence}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => patch("resolver", { acceptConfidence: v })}
        />
        <NumberField
          label="Accept margin"
          help="How far ahead of the runner-up the best match must be. This is what makes BEAM ask when you type 'brock'."
          value={settings.resolver.acceptMargin}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => patch("resolver", { acceptMargin: v })}
        />
        <NumberField
          label="Clarify floor"
          help="Below this a candidate is not even offered as a choice."
          value={settings.resolver.clarifyFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => patch("resolver", { clarifyFloor: v })}
        />
        <NumberField
          label="Choices offered"
          help="Most options shown at once when BEAM asks which player you meant."
          value={settings.resolver.maxClarifyOptions}
          step={1}
          min={2}
          max={8}
          onChange={(v) => patch("resolver", { maxClarifyOptions: v })}
        />
        <NumberField
          label="Typo similarity floor"
          help="Trigram similarity a misspelling must clear. Lower catches more typos and more wrong players."
          value={settings.resolver.trigramFloor}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => patch("resolver", { trigramFloor: v })}
        />
        <NumberField
          label="Max typos in a surname"
          help="Edit distance allowed on the last name. Two is one transposition plus one slip."
          value={settings.resolver.maxEditDistance}
          step={1}
          min={0}
          max={4}
          onChange={(v) => patch("resolver", { maxEditDistance: v })}
        />
      </Section>

      <Section
        title="Question routing"
        blurb="How BEAM decides WHAT kind of question it is. Candidate readings are tried in order, so these mainly set how many readings are worth trying."
      >
        <NumberField
          label="Minimum reading score"
          help="A reading below this is never attempted."
          value={settings.intent.acceptScore}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => patch("intent", { acceptScore: v })}
        />
        <NumberField
          label="Tie width"
          help="Readings within this of each other are treated as tied and ordered by specificity."
          value={settings.intent.acceptMargin}
          step={0.01}
          min={0.01}
          max={1}
          onChange={(v) => patch("intent", { acceptMargin: v })}
        />
      </Section>

      <Section
        title="Limits"
        blurb="Input size and how often one visitor can ask. The rate limit is durable and shared across servers."
      >
        <NumberField
          label="Max question length"
          help="Characters. Enforced before anything parses the text."
          value={settings.limits.maxQuestionLength}
          step={10}
          min={40}
          max={500}
          onChange={(v) => patch("limits", { maxQuestionLength: v })}
        />
        <NumberField
          label="Questions per window"
          value={settings.limits.askMaxPerWindow}
          step={1}
          min={1}
          max={600}
          onChange={(v) => patch("limits", { askMaxPerWindow: v })}
        />
        <NumberField
          label="Question window (seconds)"
          value={settings.limits.askWindowSeconds}
          step={10}
          min={10}
          max={3600}
          onChange={(v) => patch("limits", { askWindowSeconds: v })}
        />
        <NumberField
          label="Questions per window, everyone combined"
          help="The ceiling on the whole endpoint, applied to signed-in readers and to guests separately. The per-visitor limit above contains one abuser; this one contains a thousand of them. It cannot be set below what one visitor is allowed."
          value={settings.limits.askGlobalMaxPerWindow}
          step={60}
          min={60}
          max={20000}
          onChange={(v) => patch("limits", { askGlobalMaxPerWindow: v })}
        />
        <NumberField
          label="Combined window (seconds)"
          value={settings.limits.askGlobalWindowSeconds}
          step={10}
          min={10}
          max={3600}
          onChange={(v) => patch("limits", { askGlobalWindowSeconds: v })}
        />
        <NumberField
          label="Feedback submissions per window"
          value={settings.limits.learnMaxPerWindow}
          step={1}
          min={1}
          max={50}
          onChange={(v) => patch("limits", { learnMaxPerWindow: v })}
        />
        <NumberField
          label="Feedback window (seconds)"
          value={settings.limits.learnWindowSeconds}
          step={60}
          min={60}
          max={86400}
          onChange={(v) => patch("limits", { learnWindowSeconds: v })}
        />
      </Section>

      <Section
        title="Capabilities"
        blurb="Switch a question type off and BEAM stops routing to it, stops suggesting it, and stops advertising it in the examples. Takes effect on the next question."
      >
        <ul role="list" className="sm:col-span-2 space-y-2">
          {capabilities.map((capability) => {
            const enabled = !settings.capabilities.disabled.includes(capability.id);
            return (
              <li key={capability.id}>
                <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-card border border-line bg-base px-3 py-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleCapability(capability.id, e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#22D3EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-ink">
                      {capability.label}
                    </span>
                    <span className="block text-xs leading-relaxed text-ink-muted">
                      {capability.description}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Question log"
        blurb="Every question is recorded so the unanswered list has something to count. No raw IPs are stored, and rows are pruned automatically."
      >
        <label className="flex min-h-[44px] items-center gap-3 rounded-card border border-line bg-base px-3 sm:col-span-2">
          <input
            type="checkbox"
            checked={settings.logging.enabled}
            onChange={(e) => patch("logging", { enabled: e.target.checked })}
            className="h-4 w-4 accent-[#22D3EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          <span className="text-sm font-semibold text-ink">Log questions</span>
        </label>
        <NumberField
          label="Retention (days)"
          help="Enforced by cleanup_beam_queries in the database."
          value={settings.logging.retentionDays}
          step={30}
          min={7}
          max={1095}
          onChange={(v) => patch("logging", { retentionDays: v })}
        />
      </Section>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
      >
        <Save aria-hidden="true" className="h-4 w-4" />
        {pending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface/40 p-4 sm:p-5">
      <h2 id={id} className="text-base font-semibold text-ink">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{blurb}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function NumberField({
  label,
  help,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        aria-describedby={help ? helpId : undefined}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      {help && (
        <p id={helpId} className="text-xs leading-relaxed text-ink-muted">
          {help}
        </p>
      )}
    </div>
  );
}
