"use client";

/**
 * Form pieces for the admin settings managers built with the Team Blueprint
 * (/admin/league-blueprint and /admin/market-signals). Same markup and classes
 * as the local helpers in app/admin/power-pulse/power-pulse-settings-manager.tsx,
 * shared here so those two pages do not each carry another copy.
 *
 * Accessibility: every input has a real label tied by id, hints are wired with
 * aria-describedby, and the save result is announced through a polite live
 * region.
 */

import { useEffect, useId, useState } from "react";
import { RotateCcw } from "lucide-react";

export const settingsInputCls =
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
      className={settingsInputCls}
    />
  );
}

export function NumberField({
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

export function CheckboxField({
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
  const hintId = `${id}-hint`;
  // The label carries the 44px target, the same choice the Power Pulse form
  // makes: a native label click toggles the 20px box.
  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hint ? hintId : undefined}
          className="h-5 w-5 shrink-0 rounded border-line bg-base text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] leading-tight text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SettingsSection({
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

export function SettingsSaveBar({
  onSave,
  onReset,
  pending,
  status,
  saveLabel,
}: {
  onSave: () => void;
  onReset: () => void;
  pending: boolean;
  status: string;
  saveLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
      >
        {pending ? "Saving..." : saveLabel}
      </button>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <RotateCcw aria-hidden="true" className="h-4 w-4" />
        Reset to defaults
      </button>
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {status}
      </p>
    </div>
  );
}
