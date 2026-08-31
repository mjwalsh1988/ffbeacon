"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
  useTransition,
  type ReactElement,
} from "react";
import { ChevronDown, Lock, RotateCcw } from "lucide-react";
import type {
  OnTheClockSettings,
  TeamNeedAggressiveness,
  DstkRecommendBehavior,
} from "@/lib/on-the-clock/types";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "@/lib/on-the-clock/default-settings";
import { formatEastern } from "@/lib/datetime";
import { saveOnTheClockSettings, resetOnTheClockSettings } from "./actions";
import type { AwardId } from "@/lib/on-the-clock/awards";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const labelCls = "block text-xs font-medium text-ink-subtle";

/* Controlled number input with a local text buffer (lets decimals be typed without
   the parsed value fighting the keystrokes). Same pattern as the FAAB manager. */
/**
 * Every award the room can hand out, for the on/off grid.
 *
 * TYPED AS AwardId, not as string. It was `string`, so the compiler happily let
 * this list keep an award that no longer exists and miss seven that do: a
 * retired id rendered a toggle that controlled nothing, and every new award was
 * unswitchable from the admin panel because it had no row here. Typing it means
 * the next award that lands without a toggle is a build error.
 */
const AWARD_TOGGLES: { id: AwardId; label: string }[] = [
  { id: "most-active-trader", label: "Most Active Trader" },
  { id: "most-successful-trader", label: "Most Successful Trader" },
  { id: "most-boring", label: "Most Boring League Mate" },
  { id: "best-drafter", label: "Best Drafter" },
  { id: "worst-drafter", label: "Worst Drafter" },
  { id: "best-starting-lineup", label: "Best Starting Lineup" },
  { id: "long-game", label: "Best Long-Term Build (dynasty only)" },
  { id: "most-reliable", label: "Most Reliable Roster" },
  { id: "boom-bust", label: "Most Volatile Roster" },
  { id: "iron-man", label: "Most Available Roster" },
  { id: "steal-of-draft", label: "Steal of the Draft" },
  { id: "reach-of-draft", label: "Reach of the Draft" },
  { id: "round-steals", label: "Most Rounds Won" },
  { id: "most-balanced", label: "Most Balanced Roster" },
  { id: "most-top-heavy", label: "Most Top Heavy Roster" },
  { id: "bye-week-nightmare", label: "Bye Week Nightmare" },
  { id: "against-the-room", label: "Zigged When They Zagged" },
  { id: "late-round-haul", label: "Best Late Round Haul" },
  { id: "toughest-schedule", label: "Toughest Schedule Drafted" },
  { id: "scarcity-read", label: "Best Scarcity Read" },
];

const GRADE_WEIGHTS: {
  key: keyof OnTheClockSettings["grades"]["weights"];
  label: string;
}[] = [
  { key: "market", label: "Value vs market" },
  { key: "lineup", label: "Starting lineup" },
  { key: "construction", label: "Roster construction" },
  { key: "reliability", label: "Starter reliability" },
  { key: "future", label: "Future assets" },
  { key: "trades", label: "Trades" },
];

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
  /** Renders the native ceiling. The server clamps again; this is a courtesy. */
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
  // The hint is rendered with an id but nothing referenced it, so every one of
  // these fields announced its label and then stopped, including the ones whose
  // hint carries a hard constraint. Cloning the control is the smallest fix that
  // covers all of them at once, rather than threading describedBy through forty
  // call sites and relying on nobody forgetting it.
  const described =
    hint && isValidElement(children)
      ? cloneElement(children as ReactElement<{ describedBy?: string }>, {
          describedBy: hintId,
        })
      : children;
  return (
    <div>
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {described}
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
      {/* The whole row is the label, so the 44px floor is met by the row rather
          than by growing the box itself: min-h-11 on the label plus generous
          padding, with the checkbox at a size that still reads as a checkbox. */}
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 py-1.5 text-sm text-ink"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-brand-purple"
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
      {/* The h2 is the summary's ONLY child, which is the one shape HTML's
          content model blesses (summary takes phrasing content OR a single
          heading) and the one browsers reliably expose as a heading. Wrapping it
          in a span alongside the blurb claimed neither, and it also made the
          disclosure's accessible name the title plus three sentences of blurb.
          The blurb moved into the body, where it is read once, on open. */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:p-5">
        <h2 className="min-w-0 text-lg font-semibold text-ink">{title}</h2>
        <ChevronDown
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line p-4 sm:p-5">
        <p className="mb-4 text-sm text-ink-muted">{blurb}</p>
        {children}
      </div>
    </details>
  );
}

/* Read-only "this is locked by design" note for behavior the admin cannot change
   this phase (FF Beacon source lock, DST/K always in the room). */
function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-card border border-line bg-base/50 px-3 py-2 text-sm text-ink-muted">
      <Lock
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle"
      />
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
    setSettings((s) => ({
      ...s,
      recommendation: { ...s.recommendation, ...next },
    }));
  const patchWeights = (
    next: Partial<OnTheClockSettings["recommendation"]["weights"]>,
  ) =>
    setSettings((s) => ({
      ...s,
      recommendation: {
        ...s.recommendation,
        weights: { ...s.recommendation.weights, ...next },
      },
    }));
  const patchDstk = (next: Partial<OnTheClockSettings["dstk"]>) =>
    setSettings((s) => ({ ...s, dstk: { ...s.dstk, ...next } }));
  const patchPosAdjust = (
    next: Partial<OnTheClockSettings["positionAdjust"]>,
  ) =>
    setSettings((s) => ({
      ...s,
      positionAdjust: { ...s.positionAdjust, ...next },
    }));
  const patchTargets = (
    next: Partial<OnTheClockSettings["positionFallbackTargets"]>,
  ) =>
    setSettings((s) => ({
      ...s,
      positionFallbackTargets: { ...s.positionFallbackTargets, ...next },
    }));
  const patchBuildMode = (next: Partial<OnTheClockSettings["buildMode"]>) =>
    setSettings((s) => ({ ...s, buildMode: { ...s.buildMode, ...next } }));
  const patchMarginal = (next: Partial<OnTheClockSettings["marginal"]>) =>
    setSettings((s) => ({ ...s, marginal: { ...s.marginal, ...next } }));
  const patchAwards = (next: Partial<OnTheClockSettings["awards"]>) =>
    setSettings((s) => ({ ...s, awards: { ...s.awards, ...next } }));
  const patchGrades = (next: Partial<OnTheClockSettings["grades"]>) =>
    setSettings((s) => ({ ...s, grades: { ...s.grades, ...next } }));
  const patchGradeWeights = (
    next: Partial<OnTheClockSettings["grades"]["weights"]>,
  ) =>
    setSettings((s) => ({
      ...s,
      grades: { ...s.grades, weights: { ...s.grades.weights, ...next } },
    }));
  const patchAlerts = (next: Partial<OnTheClockSettings["alerts"]>) =>
    setSettings((s) => ({ ...s, alerts: { ...s.alerts, ...next } }));
  const toggleAward = (id: string, enabled: boolean) =>
    setSettings((s) => ({
      ...s,
      awards: { ...s.awards, enabled: { ...s.awards.enabled, [id]: enabled } },
    }));

  const patchValueIndicators = (
    next: Partial<OnTheClockSettings["valueIndicators"]>,
  ) =>
    setSettings((s) => ({
      ...s,
      valueIndicators: { ...s.valueIndicators, ...next },
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
          weights: {
            ...s.recommendation.weights,
            need,
            value: Math.round((1 - need) * 100) / 100,
          },
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
      feature: {
        ...DEFAULT_ON_THE_CLOCK_SETTINGS.feature,
        enabled: s.feature.enabled,
      },
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
        blurb="How often a room pulls fresh picks from Sleeper, on its own and when someone presses Sync, and how many drafting leagues a user can load at once."
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
            label="Automatic refresh (seconds)"
            htmlFor={`${ids}-autorefresh`}
            hint="How often an open draft room pulls Sleeper on its own, shared by everyone watching that draft. At 60, one draft costs one Sleeper fetch a minute however many people have it open. Anything below the sync cooldown is raised to match it on save."
          >
            <NumberInput
              id={`${ids}-autorefresh`}
              value={settings.sync.autoRefreshSeconds}
              onChange={(n) => patchSync({ autoRefreshSeconds: Math.round(n) })}
              step="1"
              min={settings.sync.cooldownSeconds}
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              id={`${ids}-autorefresh-on`}
              checked={settings.sync.autoRefreshEnabled}
              onChange={(v) => patchSync({ autoRefreshEnabled: v })}
              label="Refresh open draft rooms automatically"
              hint="When on, a room updates itself on the interval above and nobody has to press Sync. When off, the room only updates when someone presses it. Rooms stop refreshing on their own once a draft is complete either way."
            />
          </div>
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
            Player values always come from{" "}
            <span className="font-medium text-ink">FF Beacon</span>. The draft
            room does not use the global source toggle.
          </LockedNote>
          <LockedNote>
            The scoring format is detected automatically from each Sleeper
            league (the closest FF Beacon format is used when there is no exact
            match).
          </LockedNote>
          <LockedNote>
            Defenses and kickers always appear in the board, lists, and picks.
            Whether they can be recommended is controlled under Recommendation
            engine below.
          </LockedNote>
          <LockedNote>
            The player pool (all players vs rookies only) is inferred
            automatically: redraft leagues always show everyone; dynasty drafts
            with 6 rounds or fewer are treated as rookie drafts. There is no
            manual toggle.
          </LockedNote>
        </div>
      </SectionCard>

      {/* 3b. ADP value indicators */}
      <SectionCard
        title="ADP value indicators"
        blurb="How far from Sleeper ADP a pick must land before the board and list call it good value or a reach. Applies to live rooms and to new completed-draft snapshots (already-finalized snapshots keep the threshold they were graded with)."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Neutral band (picks)"
            htmlFor={`${ids}-adpthreshold`}
            hint="A pick is flagged only when it lands at least this many picks after (good value) or before (reach) its Sleeper ADP. 6 is about half a round in a 12-team league."
          >
            <NumberInput
              id={`${ids}-adpthreshold`}
              value={settings.valueIndicators.thresholdPicks}
              onChange={(n) =>
                patchValueIndicators({ thresholdPicks: Math.round(n) })
              }
              step="1"
              min={1}
            />
          </Field>
        </div>
      </SectionCard>

      {/* Build mode, marginal engine, awards, grades, alerts */}
      <SectionCard
        title="Build mode"
        blurb="Compete, balanced, or rebuild. The selector is only offered in a dynasty startup: a redraft team is competing by definition, and a rookie draft sits on top of a team whose direction is already set."
      >
        <div className="space-y-4">
          <Toggle
            id={`${ids}-buildmode-enabled`}
            checked={settings.buildMode.enabled}
            onChange={(v) => patchBuildMode({ enabled: v })}
            label="Offer the compete / rebuild selector"
            hint="Off hides the control everywhere and treats every room as balanced."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Default mode"
              htmlFor={`${ids}-buildmode-default`}
              hint="Where a dynasty startup starts before the drafter chooses."
            >
              <select
                id={`${ids}-buildmode-default`}
                value={settings.buildMode.defaultMode}
                onChange={(e) =>
                  patchBuildMode({
                    defaultMode: e.target
                      .value as OnTheClockSettings["buildMode"]["defaultMode"],
                  })
                }
                className={inputCls}
              >
                <option value="compete">Compete</option>
                <option value="balanced">Balanced</option>
                <option value="rebuild">Rebuild</option>
              </select>
            </Field>
            <Field
              label="Points weight, empty lineup"
              htmlFor={`${ids}-buildmode-pwe`}
              hint="How much of Team Need rides on this season's points when no starting slot is filled. An empty lineup is almost entirely a points question."
            >
              <NumberInput
                id={`${ids}-buildmode-pwe`}
                value={settings.buildMode.pointsWeightEmpty}
                onChange={(n) => patchBuildMode({ pointsWeightEmpty: n })}
                step="0.05"
                min={0}
                max={1}
              />
            </Field>
            <Field
              label="Points weight, full lineup"
              htmlFor={`${ids}-buildmode-pwf`}
              hint="And when every starting slot is filled. Lower, because the next pick is a bench player and ranking bench players by points added to a lineup they cannot crack is a wall of zeroes."
            >
              <NumberInput
                id={`${ids}-buildmode-pwf`}
                value={settings.buildMode.pointsWeightFull}
                onChange={(n) => patchBuildMode({ pointsWeightFull: n })}
                step="0.05"
                min={0}
                max={1}
              />
            </Field>
            <Field
              label="Compete boost"
              htmlFor={`${ids}-buildmode-boost`}
              hint="Multiplier on both weights in compete mode. Above 1 leans win-now harder."
            >
              <NumberInput
                id={`${ids}-buildmode-boost`}
                value={settings.buildMode.competePointsBoost}
                onChange={(n) => patchBuildMode({ competePointsBoost: n })}
                step="0.05"
                min={0.5}
                max={3}
              />
            </Field>
            <Field
              label="Rebuild points cap"
              htmlFor={`${ids}-buildmode-cap`}
              hint="Ceiling on the points weight in rebuild mode, so the long game stays in charge however empty the lineup is."
            >
              <NumberInput
                id={`${ids}-buildmode-cap`}
                value={settings.buildMode.rebuildPointsCap}
                onChange={(n) => patchBuildMode({ rebuildPointsCap: n })}
                step="0.05"
                min={0}
                max={1}
              />
            </Field>
            <Field
              label="Youth weight"
              htmlFor={`${ids}-buildmode-youth`}
              hint="Credit for youth in rebuild scoring. Age is position-adjusted, so a 26-year-old back and a 26-year-old quarterback are not treated alike."
            >
              <NumberInput
                id={`${ids}-buildmode-youth`}
                value={settings.buildMode.youthWeight}
                onChange={(n) => patchBuildMode({ youthWeight: n })}
                step="0.05"
                min={0}
                max={2}
              />
            </Field>
            <Field
              label="Upside weight"
              htmlFor={`${ids}-buildmode-upside`}
              hint="Credit when the projections like a player more than the market price does."
            >
              <NumberInput
                id={`${ids}-buildmode-upside`}
                value={settings.buildMode.upsideWeight}
                onChange={(n) => patchBuildMode({ upsideWeight: n })}
                step="0.05"
                min={0}
                max={2}
              />
            </Field>
            <Field
              label="Best Value tilt, compete"
              htmlFor={`${ids}-buildmode-ctilt`}
              hint="How hard the Best Value card tilts toward this season's production. FF Beacon value stays the base, so the tilt can shade the winner but never invent one."
            >
              <NumberInput
                id={`${ids}-buildmode-ctilt`}
                value={settings.buildMode.competeValueTilt}
                onChange={(n) => patchBuildMode({ competeValueTilt: n })}
                step="0.05"
                min={0}
                max={2}
              />
            </Field>
            <Field
              label="Best Value tilt, rebuild"
              htmlFor={`${ids}-buildmode-rtilt`}
              hint="The same, toward youth and upside."
            >
              <NumberInput
                id={`${ids}-buildmode-rtilt`}
                value={settings.buildMode.rebuildValueTilt}
                onChange={(n) => patchBuildMode({ rebuildValueTilt: n })}
                step="0.05"
                min={0}
                max={2}
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Marginal value engine"
        blurb="How Team Need prices a player in points: what he adds to the optimal starting lineup, what waiting costs, and what he is worth if the starter ahead of him misses time."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Insurance weight"
            htmlFor={`${ids}-marg-ins`}
            hint="Credit for what a player is worth with the starter ahead of him removed, scaled by that starter's real availability."
          >
            <NumberInput
              id={`${ids}-marg-ins`}
              value={settings.marginal.insuranceWeight}
              onChange={(n) => patchMarginal({ insuranceWeight: n })}
              step="0.05"
              min={0}
              max={2}
            />
          </Field>
          <Field
            label="Dropoff weight"
            htmlFor={`${ids}-marg-drop`}
            hint="Credit for the cost of waiting: how much better he is than the best player at his position expected to survive to the drafter's next pick."
          >
            <NumberInput
              id={`${ids}-marg-drop`}
              value={settings.marginal.dropoffWeight}
              onChange={(n) => patchMarginal({ dropoffWeight: n })}
              step="0.05"
              min={0}
              max={2}
            />
          </Field>
          <Field
            label="Minimum starter injury risk"
            htmlFor={`${ids}-marg-risk`}
            hint="Floor on the risk used to weight insurance. Even a starter who has never missed a week leaves his backup some credit, because the accuracy table only knows the seasons it has seen."
          >
            <NumberInput
              id={`${ids}-marg-risk`}
              value={settings.marginal.minStarterRisk}
              onChange={(n) => patchMarginal({ minStarterRisk: n })}
              step="0.01"
              min={0}
              max={1}
            />
          </Field>
          <Field
            label="Candidates priced per request"
            htmlFor={`${ids}-marg-cap`}
            hint="Each candidate costs a full lineup rebuild for every remaining week on the server, so this is the real cost control. 160 covers far more of the board than anyone reads."
          >
            <NumberInput
              id={`${ids}-marg-cap`}
              value={settings.marginal.maxCandidates}
              onChange={(n) => patchMarginal({ maxCandidates: Math.round(n) })}
              step="10"
              min={10}
              max={300}
            />
          </Field>
        </div>
      </SectionCard>

      <CollapsibleSection
        title="Awards"
        blurb="Which awards the room hands out, and how much evidence each one needs before it can be earned. An award that cannot be earned honestly stays up for grabs rather than being given to the least bad team."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Minimum trades for the trade-quality award"
              htmlFor={`${ids}-aw-trades`}
              hint="Below this a single lopsided deal could take it."
            >
              <NumberInput
                id={`${ids}-aw-trades`}
                value={settings.awards.minSuccessfulTraderTrades}
                onChange={(n) =>
                  patchAwards({ minSuccessfulTraderTrades: Math.round(n) })
                }
                step="1"
                min={1}
              />
            </Field>
            <Field
              label="Minimum priced picks for the drafting awards"
              htmlFor={`${ids}-aw-picks`}
              hint="How many picks with a known market price a team needs before it can be called the best or worst drafter."
            >
              <NumberInput
                id={`${ids}-aw-picks`}
                value={settings.awards.minAdpPicks}
                onChange={(n) => patchAwards({ minAdpPicks: Math.round(n) })}
                step="1"
                min={1}
              />
            </Field>
            <Field
              label="Minimum weeks of history for reliability"
              htmlFor={`${ids}-aw-weeks`}
              hint="Shown in the pending copy for the reliability awards."
            >
              <NumberInput
                id={`${ids}-aw-weeks`}
                value={settings.awards.minAccuracyWeeks}
                onChange={(n) =>
                  patchAwards({ minAccuracyWeeks: Math.round(n) })
                }
                step="1"
                min={0}
              />
            </Field>
            <Field
              label="Minimum projected players for the lineup awards"
              htmlFor={`${ids}-aw-players`}
              hint="A team with two projected players has not built a lineup worth grading."
            >
              <NumberInput
                id={`${ids}-aw-players`}
                value={settings.awards.minPlayersForLineupAwards}
                onChange={(n) =>
                  patchAwards({ minPlayersForLineupAwards: Math.round(n) })
                }
                step="1"
                min={1}
              />
            </Field>
          </div>
          <fieldset className="rounded-card border border-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Awards on or off
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AWARD_TOGGLES.map((a) => (
                <Toggle
                  key={a.id}
                  id={`${ids}-aw-${a.id}`}
                  checked={settings.awards.enabled[a.id] !== false}
                  onChange={(v) => toggleAward(a.id, v)}
                  label={a.label}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Draft grades"
        blurb="Per-team letter grades. Components are scored against the rest of the league, because every team in a startup drafts from one pool; the absolute blend pulls part of the way back so a strong room is not forced to produce an F."
      >
        <div className="space-y-4">
          <Toggle
            id={`${ids}-gr-enabled`}
            checked={settings.grades.enabled}
            onChange={(v) => patchGrades({ enabled: v })}
            label="Grade drafts"
            hint="Off hides the Grades tab and writes no grades into new snapshots."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Absolute blend"
              htmlFor={`${ids}-gr-blend`}
              hint="0 is a pure curve, which guarantees somebody gets an F. 1 ignores the league entirely. The default leans on the curve, because the curve is the honest part."
            >
              <NumberInput
                id={`${ids}-gr-blend`}
                value={settings.grades.absoluteBlend}
                onChange={(n) => patchGrades({ absoluteBlend: n })}
                step="0.05"
                min={0}
                max={1}
              />
            </Field>
          </div>
          <fieldset className="rounded-card border border-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Component weights
            </legend>
            <p className="mb-3 text-[11px] text-ink-subtle">
              They do not have to sum to one. A component with no data for a
              team is dropped and the rest are renormalized, so a redraft league
              simply has no future-assets component.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {GRADE_WEIGHTS.map((w) => (
                <Field
                  key={w.key}
                  label={w.label}
                  htmlFor={`${ids}-gw-${w.key}`}
                >
                  <NumberInput
                    id={`${ids}-gw-${w.key}`}
                    value={settings.grades.weights[w.key]}
                    onChange={(n) => patchGradeWeights({ [w.key]: n })}
                    step="0.02"
                    min={0}
                    max={1}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Draft radar alerts"
        blurb="Positional runs, tier cliffs, and the list of players expected to go before the drafter is back on the clock."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Run window (picks)"
            htmlFor={`${ids}-al-window`}
            hint="How many recent picks a run looks at."
          >
            <NumberInput
              id={`${ids}-al-window`}
              value={settings.alerts.runWindow}
              onChange={(n) => patchAlerts({ runWindow: Math.round(n) })}
              step="1"
              min={2}
            />
          </Field>
          <Field
            label="Run threshold"
            htmlFor={`${ids}-al-threshold`}
            hint="How many of those must share a position. Kept at or below the window."
          >
            <NumberInput
              id={`${ids}-al-threshold`}
              value={settings.alerts.runThreshold}
              onChange={(n) => patchAlerts({ runThreshold: Math.round(n) })}
              step="1"
              min={2}
            />
          </Field>
          <Field
            label="Tier cliff threshold"
            htmlFor={`${ids}-al-tier`}
            hint="Warn when a position's current top tier is down to this many players or fewer."
          >
            <NumberInput
              id={`${ids}-al-tier`}
              value={settings.alerts.tierCliffRemaining}
              onChange={(n) =>
                patchAlerts({ tierCliffRemaining: Math.round(n) })
              }
              step="1"
              min={1}
            />
          </Field>
          <Field
            label="Gone-before list length"
            htmlFor={`${ids}-al-gone`}
            hint="How many players to list as likely gone before the drafter's next pick."
          >
            <NumberInput
              id={`${ids}-al-gone`}
              value={settings.alerts.maxGoneBefore}
              onChange={(n) => patchAlerts({ maxGoneBefore: Math.round(n) })}
              step="1"
              min={1}
            />
          </Field>
        </div>
      </CollapsibleSection>

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
            <legend className="text-sm font-semibold text-ink">
              How aggressive Team Need is
            </legend>
            <p className="mt-1 text-xs text-ink-subtle">
              Picking a preset sets the value and need weights below. You can
              still fine-tune them after.
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
                  <option value="conservative">
                    Conservative (lean toward best value)
                  </option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">
                    Aggressive (lean toward filling needs)
                  </option>
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
            <legend className="text-sm font-semibold text-ink">
              Format priority boosts
            </legend>
            <p className="mt-1 text-xs text-ink-subtle">
              Extra weight for positions that matter more in certain league
              types.
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
            <legend className="text-sm font-semibold text-ink">
              Defense and kicker recommendations
            </legend>
            <p className="mt-1 text-xs text-ink-subtle">
              DEF and K always appear in the room. These control whether and
              when they can be the Team Need pick.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="When to recommend DEF/K"
                htmlFor={`${ids}-dstkbehav`}
              >
                <select
                  id={`${ids}-dstkbehav`}
                  value={settings.dstk.recommendBehavior}
                  onChange={(e) =>
                    patchDstk({
                      recommendBehavior: e.target
                        .value as DstkRecommendBehavior,
                    })
                  }
                  className={inputCls}
                >
                  <option value="suppress_until_need">
                    Only late, when the roster needs one
                  </option>
                  <option value="never">Never recommend DEF/K</option>
                  <option value="always_allowed">
                    Treat like any other position
                  </option>
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

      {/* 5. Trade Builder (informational) */}
      <SectionCard
        title="Trade Builder"
        blurb="The in-draft Trade Builder compares the value of two sides of a deal."
      >
        <LockedNote>
          Trade values are read from the same FF Beacon board. Draft pick values
          are projected from the board and shown as estimates. The projection
          settings (discounts and caps) are fixed in code for now and are not
          adjustable here.
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
            <legend className="text-sm font-semibold text-ink">
              Cache cleanup window
            </legend>
            <p className="mt-1 text-xs text-ink-subtle">
              Drafts and their picks are kept permanently. They are what this
              tool watched happen, a finished draft can still be opened and
              locked later, and re-syncing cannot recover the moment a pick
              landed. The nightly cleanup only clears the projection cache,
              which is rebuilt from data we still hold.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Projection cache (hours)"
                htmlFor={`${ids}-projectionretention`}
                hint="How long a cached weekly-projection sweep is kept after it was built. It stops being served after 24 hours, so anything above that is headroom before it is deleted and rebuilt. 72 hours is the default."
              >
                <NumberInput
                  id={`${ids}-projectionretention`}
                  value={settings.cache.projectionRetentionHours}
                  onChange={(n) =>
                    patchCache({ projectionRetentionHours: Math.round(n) })
                  }
                  step="1"
                  min={24}
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
            <p className="text-sm font-semibold text-ink">
              Current settings (read-only)
            </p>
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
