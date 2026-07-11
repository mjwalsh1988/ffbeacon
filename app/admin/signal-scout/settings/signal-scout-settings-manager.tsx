"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import type { EligiblePosition, SignalScoutSettings, SignalTier } from "@/lib/signal-scout/types";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "@/lib/signal-scout/default-settings";
import { CLUE_DEFINITIONS } from "@/lib/signal-scout/clues";
import { formatEastern } from "@/lib/datetime";
import { saveSignalScoutSettings, resetSignalScoutSettings } from "../actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const labelCls = "block text-xs font-medium text-ink-subtle";

const ALL_POSITIONS: EligiblePosition[] = ["QB", "RB", "WR", "TE"];
const TIER_ORDER: SignalTier[] = ["weak", "clear", "ping", "scan"];
const TIER_LABELS: Record<SignalTier, string> = {
  weak: "Weak Signal",
  clear: "Clear Signal",
  ping: "Beacon Ping",
  scan: "Full Scan",
};

/* Controlled number input with a local text buffer (lets typing happen
   without the parsed value fighting the keystrokes). Same pattern as the
   On The Clock and FAAB managers. */
function NumberInput({
  id,
  value,
  onChange,
  step = "1",
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
      inputMode="numeric"
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
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
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
        <div className="min-w-0">
          {/* Real heading so screen-reader heading navigation reaches these
              sections; visually identical to the SectionCard h2s. */}
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{blurb}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="mt-1 h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line p-4 sm:p-5">{children}</div>
    </details>
  );
}

export function SignalScoutSettingsManager({
  initialSettings,
  lastUpdated,
}: {
  initialSettings: SignalScoutSettings;
  lastUpdated: string | null;
}) {
  const [settings, setSettings] = useState<SignalScoutSettings>(initialSettings);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const ids = useId();

  // ---- typed nested updaters ----
  const patchScoring = (next: Partial<SignalScoutSettings["scoring"]>) =>
    setSettings((s) => ({ ...s, scoring: { ...s.scoring, ...next } }));
  const patchClues = (next: Partial<SignalScoutSettings["clues"]>) =>
    setSettings((s) => ({ ...s, clues: { ...s.clues, ...next } }));
  const patchTierLimits = (next: Partial<SignalScoutSettings["clues"]["tier_limits"]>) =>
    setSettings((s) => ({
      ...s,
      clues: { ...s.clues, tier_limits: { ...s.clues.tier_limits, ...next } },
    }));
  const patchLeaderboards = (next: Partial<SignalScoutSettings["leaderboards"]>) =>
    setSettings((s) => ({ ...s, leaderboards: { ...s.leaderboards, ...next } }));
  const patchReveal = (next: Partial<SignalScoutSettings["reveal"]>) =>
    setSettings((s) => ({ ...s, reveal: { ...s.reveal, ...next } }));
  const patchFuture = (next: Partial<SignalScoutSettings["future"]>) =>
    setSettings((s) => ({ ...s, future: { ...s.future, ...next } }));

  const toggleDisabledClue = (key: string, disabled: boolean) =>
    setSettings((s) => {
      const set = new Set(s.clues.disabled_clue_keys);
      if (disabled) set.add(key);
      else set.delete(key);
      return { ...s, clues: { ...s.clues, disabled_clue_keys: Array.from(set) } };
    });

  const togglePosition = (position: EligiblePosition, checked: boolean) =>
    setSettings((s) => {
      const current = s.pool.eligible_positions;
      if (!checked && current.length <= 1) return s;
      const next = checked
        ? Array.from(new Set([...current, position]))
        : current.filter((p) => p !== position);
      return { ...s, pool: { ...s.pool, eligible_positions: next } };
    });

  function save() {
    setStatus("");
    startTransition(async () => {
      const res = await saveSignalScoutSettings(settings);
      if (res.ok) {
        setStatus("Saved.");
      } else {
        setStatus(`Failed: ${res.error}`);
      }
    });
  }

  function resetForm() {
    setSettings((s) => ({
      ...DEFAULT_SIGNAL_SCOUT_SETTINGS,
      // Keep the current on/off state so a reset never silently launches or
      // pulls the public game offline.
      game_enabled: s.game_enabled,
    }));
    setStatus(
      "Settings reset to recommended defaults in this form (the on/off state is kept). Nothing is saved until you press Save settings.",
    );
  }

  function resetSaved() {
    const ok = window.confirm(
      "Reset Signal Scout settings to recommended defaults and save now? The on/off state is kept. This cannot be undone.",
    );
    if (!ok) return;
    setStatus("");
    startTransition(async () => {
      const res = await resetSignalScoutSettings();
      if (res.ok) {
        setSettings(res.settings);
        setStatus("Reset to defaults and saved.");
      } else {
        setStatus(`Failed: ${res.error}`);
      }
    });
  }

  return (
    <div className="mt-2 space-y-6">
      <p aria-live="polite" className="text-sm text-ink-muted">
        {isPending ? "Saving..." : status}
      </p>

      {/* 1. Game status */}
      <SectionCard
        title="Game"
        blurb="Turn the public Signal Scout game on or off."
      >
        <Toggle
          id={`${ids}-enabled`}
          checked={settings.game_enabled}
          onChange={(v) => setSettings((s) => ({ ...s, game_enabled: v }))}
          label="Signal Scout is live at /games/signal-scout"
          hint="While off, visitors see a friendly Signal offline card and cannot start or play rounds."
        />
      </SectionCard>

      {/* 2. Guests */}
      <SectionCard
        title="Guests"
        blurb="Whether visitors without an account can play, and how many rounds a guest can start per day."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-end">
            <Toggle
              id={`${ids}-guest-play`}
              checked={settings.guest_play_enabled}
              onChange={(v) => setSettings((s) => ({ ...s, guest_play_enabled: v }))}
              label="Allow guest play"
              hint="When off, only signed-in scouts can start a round."
            />
          </div>
          <Field
            label="Guest daily round limit"
            htmlFor={`${ids}-guest-limit`}
            hint="Rounds a guest can start per ET day. 0 blocks all guest rounds (fails closed)."
          >
            <NumberInput
              id={`${ids}-guest-limit`}
              value={settings.guest_daily_round_limit}
              onChange={(n) => setSettings((s) => ({ ...s, guest_daily_round_limit: Math.round(n) }))}
              min={0}
              max={20}
              describedBy={`${ids}-guest-limit-hint`}
            />
          </Field>
        </div>
      </SectionCard>

      {/* 3. Scoring */}
      <SectionCard
        title="Scoring"
        blurb="Starting score, the point cost of each signal tier, and the wrong-guess penalty. Values snapshot onto a round when it starts, so changing them here never affects a round already in progress."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Starting score" htmlFor={`${ids}-starting-score`}>
            <NumberInput
              id={`${ids}-starting-score`}
              value={settings.scoring.starting_score}
              onChange={(n) => patchScoring({ starting_score: Math.round(n) })}
              min={100}
              max={10000}
            />
          </Field>
          <Field label="Max wrong guesses" htmlFor={`${ids}-max-wrong`}>
            <NumberInput
              id={`${ids}-max-wrong`}
              value={settings.scoring.max_wrong_guesses}
              onChange={(n) => patchScoring({ max_wrong_guesses: Math.round(n) })}
              min={1}
              max={10}
            />
          </Field>
          <Field label="Weak Signal cost" htmlFor={`${ids}-weak-cost`}>
            <NumberInput
              id={`${ids}-weak-cost`}
              value={settings.scoring.weak_signal_cost}
              onChange={(n) => patchScoring({ weak_signal_cost: Math.round(n) })}
              min={0}
              max={5000}
            />
          </Field>
          <Field label="Clear Signal cost" htmlFor={`${ids}-clear-cost`}>
            <NumberInput
              id={`${ids}-clear-cost`}
              value={settings.scoring.clear_signal_cost}
              onChange={(n) => patchScoring({ clear_signal_cost: Math.round(n) })}
              min={0}
              max={5000}
            />
          </Field>
          <Field label="Beacon Ping cost" htmlFor={`${ids}-ping-cost`}>
            <NumberInput
              id={`${ids}-ping-cost`}
              value={settings.scoring.beacon_ping_cost}
              onChange={(n) => patchScoring({ beacon_ping_cost: Math.round(n) })}
              min={0}
              max={5000}
            />
          </Field>
          <Field label="Full Scan cost" htmlFor={`${ids}-scan-cost`}>
            <NumberInput
              id={`${ids}-scan-cost`}
              value={settings.scoring.full_scan_cost}
              onChange={(n) => patchScoring({ full_scan_cost: Math.round(n) })}
              min={0}
              max={5000}
            />
          </Field>
          <Field label="Wrong guess penalty" htmlFor={`${ids}-wrong-penalty`}>
            <NumberInput
              id={`${ids}-wrong-penalty`}
              value={settings.scoring.wrong_guess_penalty}
              onChange={(n) => patchScoring({ wrong_guess_penalty: Math.round(n) })}
              min={0}
              max={5000}
            />
          </Field>
        </div>
      </SectionCard>

      {/* 4. Clue limits */}
      <SectionCard
        title="Clue limits"
        blurb="How many free starter clues a round opens with, and the maximum clues purchasable per signal tier."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Starter clue count" htmlFor={`${ids}-starter-count`}>
            <NumberInput
              id={`${ids}-starter-count`}
              value={settings.clues.starter_clue_count}
              onChange={(n) => patchClues({ starter_clue_count: Math.round(n) })}
              min={1}
              max={6}
            />
          </Field>
          <Field label="Weak Signal limit" htmlFor={`${ids}-tier-weak`}>
            <NumberInput
              id={`${ids}-tier-weak`}
              value={settings.clues.tier_limits.weak}
              onChange={(n) => patchTierLimits({ weak: Math.round(n) })}
              min={0}
              max={10}
            />
          </Field>
          <Field label="Clear Signal limit" htmlFor={`${ids}-tier-clear`}>
            <NumberInput
              id={`${ids}-tier-clear`}
              value={settings.clues.tier_limits.clear}
              onChange={(n) => patchTierLimits({ clear: Math.round(n) })}
              min={0}
              max={10}
            />
          </Field>
          <Field label="Beacon Ping limit" htmlFor={`${ids}-tier-ping`}>
            <NumberInput
              id={`${ids}-tier-ping`}
              value={settings.clues.tier_limits.ping}
              onChange={(n) => patchTierLimits({ ping: Math.round(n) })}
              min={0}
              max={10}
            />
          </Field>
          <Field label="Full Scan limit" htmlFor={`${ids}-tier-scan`}>
            <NumberInput
              id={`${ids}-tier-scan`}
              value={settings.clues.tier_limits.scan}
              onChange={(n) => patchTierLimits({ scan: Math.round(n) })}
              min={0}
              max={10}
            />
          </Field>
        </div>
      </SectionCard>

      {/* 5. Disabled clue types */}
      <CollapsibleSection
        title="Disabled clue types"
        blurb="Turn off individual clue types (for example, one that leaks the answer too directly). Checking a box disables that clue everywhere new rounds are generated."
      >
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Clue types (checked = disabled)</legend>
          {TIER_ORDER.map((tier) => {
            const defs = CLUE_DEFINITIONS.filter((def) => def.tier === tier);
            return (
              <div key={tier} className="mt-4 first:mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {TIER_LABELS[tier]}
                </p>
                <div className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                  {defs.map((def) => (
                    <Toggle
                      key={def.key}
                      id={`${ids}-clue-${def.key}`}
                      checked={settings.clues.disabled_clue_keys.includes(def.key)}
                      onChange={(v) => toggleDisabledClue(def.key, v)}
                      label={
                        <>
                          {def.label} <span className="text-ink-subtle">({TIER_LABELS[def.tier]})</span>
                        </>
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </fieldset>
      </CollapsibleSection>

      {/* 6. Player pool */}
      <SectionCard
        title="Player pool"
        blurb="Positions eligible to be selected as the target player for a round."
      >
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Eligible positions</legend>
          <div className="mt-3 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
            {ALL_POSITIONS.map((position) => {
              const checked = settings.pool.eligible_positions.includes(position);
              const isLastChecked = checked && settings.pool.eligible_positions.length === 1;
              return (
                <Toggle
                  key={position}
                  id={`${ids}-pos-${position}`}
                  checked={checked}
                  disabled={isLastChecked}
                  onChange={(v) => togglePosition(position, v)}
                  label={position}
                  hint={isLastChecked ? "At least one position is required." : undefined}
                />
              );
            })}
          </div>
        </fieldset>
      </SectionCard>

      {/* 7. Leaderboards */}
      <SectionCard
        title="Leaderboards"
        blurb="Master and per-board leaderboard visibility, and who is counted."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Toggle
            id={`${ids}-lb-enabled`}
            checked={settings.leaderboards.leaderboard_enabled}
            onChange={(v) => patchLeaderboards({ leaderboard_enabled: v })}
            label="Leaderboards enabled"
            hint="Master switch. When off, none of the boards below are shown, regardless of their own toggle."
          />
          <Toggle
            id={`${ids}-lb-daily`}
            checked={settings.leaderboards.daily_enabled}
            onChange={(v) => patchLeaderboards({ daily_enabled: v })}
            label="Daily leaderboard"
            hint="Ranks scouts by today's ET game day."
          />
          <Toggle
            id={`${ids}-lb-alltime`}
            checked={settings.leaderboards.all_time_enabled}
            onChange={(v) => patchLeaderboards({ all_time_enabled: v })}
            label="All-time leaderboard"
            hint="Ranks scouts across every round ever played."
          />
          <Toggle
            id={`${ids}-lb-streak`}
            checked={settings.leaderboards.streak_enabled}
            onChange={(v) => patchLeaderboards({ streak_enabled: v })}
            label="Streak leaderboard"
            hint="Ranks scouts by consecutive daily rounds solved."
          />
          <Toggle
            id={`${ids}-lb-login`}
            checked={settings.leaderboards.require_login}
            onChange={(v) => patchLeaderboards({ require_login: v })}
            label="Require login to appear"
            hint="When on, guest rounds are never counted on any leaderboard."
          />
          <Toggle
            id={`${ids}-lb-hideadmin`}
            checked={settings.leaderboards.hide_admin_users}
            onChange={(v) => patchLeaderboards({ hide_admin_users: v })}
            label="Hide admin users"
            hint="Keeps admin test rounds from cluttering the public boards."
          />
        </div>
      </SectionCard>

      {/* 8. Reveal */}
      <SectionCard title="Reveal" blurb="What is shown once a round ends.">
        <Toggle
          id={`${ids}-show-images`}
          checked={settings.reveal.show_player_images}
          onChange={(v) => patchReveal({ show_player_images: v })}
          label="Show player images on reveal"
          hint="When off, the reveal shows the player's name and facts without a photo."
        />
      </SectionCard>

      {/* 9. Future modes */}
      <SectionCard
        title="Future modes"
        blurb="Reserved for modes that are not built yet. Toggling these has no effect on the live game today."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Toggle
            id={`${ids}-future-difficulty`}
            checked={settings.future.difficulty_mode_enabled}
            onChange={(v) => patchFuture({ difficulty_mode_enabled: v })}
            label="Difficulty mode"
            hint="Reserved for a future mode; no effect today."
          />
          <Toggle
            id={`${ids}-future-myleague`}
            checked={settings.future.my_league_mode_enabled}
            onChange={(v) => patchFuture({ my_league_mode_enabled: v })}
            label="My League mode"
            hint="Reserved for a future mode; no effect today."
          />
        </div>
      </SectionCard>

      {/* 10. Maintenance / details */}
      <CollapsibleSection
        title="Maintenance and details"
        blurb="When the settings were last saved, and the raw settings for reference."
      >
        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold text-ink">Last saved</p>
            <p className="mt-1 text-sm text-ink-muted">
              {lastUpdated
                ? formatEastern(lastUpdated)
                : "Never saved yet (the game is running on code defaults)."}
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
