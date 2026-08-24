"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { ChevronDown, Plus, RotateCcw, Trash2 } from "lucide-react";
import type {
  BidBand,
  FaabSettings,
  NeedLevel,
  PctRange,
} from "@/lib/faab/types";
import { DEFAULT_FAAB_SETTINGS } from "@/lib/faab/default-settings";
import { saveFaabSettings } from "./actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const labelCls = "block text-xs font-medium text-ink-subtle";

/* Smooth controlled number input: keeps a local text buffer so decimals can be
   typed without the parsed value fighting the keystrokes, and propagates a
   finite number up as soon as one is valid. */
function NumberInput({
  id,
  value,
  onChange,
  step = "any",
  min,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
  min?: number;
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
  return (
    <div>
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

/**
 * One league-mode signal: on/off plus a ceiling on how far it can move a bid.
 * Every signal shares this shape, so they share one control rather than each
 * growing its own slightly different pair of inputs.
 */
function SignalRow({
  id,
  title,
  hint,
  enabled,
  onToggle,
  maxAdjustPct,
  onMax,
}: {
  id: string;
  title: string;
  hint: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  maxAdjustPct: number;
  onMax: (pct: number) => void;
}) {
  return (
    <fieldset className="rounded-card border border-line bg-base/40 p-3">
      <legend className="px-1 text-xs font-semibold text-ink">{title}</legend>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">{hint}</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4"
          />
          Enabled
        </label>
        <Field
          label="Most it can move a bid"
          htmlFor={`${id}-max`}
          hint="Percent, up or down."
        >
          <NumberInput id={`${id}-max`} value={maxAdjustPct} onChange={onMax} min={0} />
        </Field>
      </div>
    </fieldset>
  );
}

type BadgeTone = "most-used" | "strategy" | "advanced" | "public";

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const cls =
    tone === "strategy"
      ? "border-brand-purple/40 bg-brand-purple/10 text-brand-purple"
      : tone === "most-used"
        ? "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
        : "border-line bg-base text-ink-subtle";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${cls}`}
    >
      {children}
    </span>
  );
}

function SectionCard({
  title,
  blurb,
  badge,
  children,
}: {
  title: string;
  blurb: string;
  badge?: { tone: BadgeTone; label: string };
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{blurb}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* Collapsible card (native <details>/<summary> for free keyboard + screen
   reader support). Used to tuck the most technical settings away by default. */
function CollapsibleSection({
  title,
  blurb,
  badge,
  children,
}: {
  title: string;
  blurb: string;
  badge?: { tone: BadgeTone; label: string };
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-card border border-line bg-surface/40">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:p-5">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          </span>
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

/* Plain-English intro + recommended workflow shown at the top of the page. */
function IntroCard() {
  return (
    <div
      className="relative overflow-hidden rounded-card border border-line bg-surface p-4 sm:p-5"
      style={{ boxShadow: "0 0 64px -48px rgba(168, 85, 247, 0.6)" }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-px"
        style={{
          backgroundImage:
            "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <p className="text-sm leading-relaxed text-ink-muted">
        Use this page to tune how the FAAB calculator thinks. Most changes should
        happen in <span className="font-medium text-ink">Quick setup</span> or{" "}
        <span className="font-medium text-ink">Main strategy controls</span>. The
        advanced math settings are available if you want deeper control, but the
        defaults are designed to be safe starting points.
      </p>
      <p className="mt-3 rounded-card border border-line bg-base/60 px-3 py-2 text-sm leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink">Recommended workflow:</span> Start
        with the defaults, test 10-20 real waiver players, then adjust the main
        strategy controls if bids feel too high or too low.
      </p>
    </div>
  );
}

function parseIntList(text: string): number[] {
  return text
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
}

export function FaabSettingsManager({
  initialSettings,
}: {
  initialSettings: FaabSettings;
}) {
  const [settings, setSettings] = useState<FaabSettings>(initialSettings);
  const [teamOptionsText, setTeamOptionsText] = useState(
    initialSettings.userDefaults.teamOptions.join(", "),
  );
  const [starterOptionsText, setStarterOptionsText] = useState(
    initialSettings.userDefaults.starterOptions.join(", "),
  );
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const ids = useId();

  // ---- typed nested updaters ----
  const patchUserDefaults = (next: Partial<FaabSettings["userDefaults"]>) =>
    setSettings((s) => ({ ...s, userDefaults: { ...s.userDefaults, ...next } }));
  const patchDepth = (next: Partial<FaabSettings["depthAdjustments"]>) =>
    setSettings((s) => ({ ...s, depthAdjustments: { ...s.depthAdjustments, ...next } }));
  const patchNeed = (next: Partial<FaabSettings["needMultipliers"]>) =>
    setSettings((s) => ({ ...s, needMultipliers: { ...s.needMultipliers, ...next } }));
  const patchDump = (next: Partial<FaabSettings["dump"]>) =>
    setSettings((s) => ({ ...s, dump: { ...s.dump, ...next } }));
  const patchValue = (next: Partial<FaabSettings["valueNormalization"]>) =>
    setSettings((s) => ({ ...s, valueNormalization: { ...s.valueNormalization, ...next } }));
  const patchCopy = (next: Partial<FaabSettings["copy"]>) =>
    setSettings((s) => ({ ...s, copy: { ...s.copy, ...next } }));

  // ---- league mode ----
  const patchMarginal = (next: Partial<FaabSettings["marginal"]>) =>
    setSettings((s) => ({ ...s, marginal: { ...s.marginal, ...next } }));
  const patchDropGuard = (next: Partial<FaabSettings["dropGuard"]>) =>
    setSettings((s) => ({ ...s, dropGuard: { ...s.dropGuard, ...next } }));
  const patchLadder = (next: Partial<FaabSettings["ladder"]>) =>
    setSettings((s) => ({ ...s, ladder: { ...s.ladder, ...next } }));
  const patchReplacementShape = (position: string, perTeam: number) =>
    setSettings((s) => ({
      ...s,
      manualReplacement: {
        ...s.manualReplacement,
        startersPerTeam: { ...s.manualReplacement.startersPerTeam, [position]: perTeam },
      },
    }));
  const patchLeagueDump = (next: Partial<FaabSettings["leagueDump"]>) =>
    setSettings((s) => ({ ...s, leagueDump: { ...s.leagueDump, ...next } }));
  const updateLeagueDumpRange = (level: NeedLevel, next: Partial<PctRange>) =>
    setSettings((s) => ({
      ...s,
      leagueDump: {
        ...s.leagueDump,
        ranges: {
          ...s.leagueDump.ranges,
          [level]: { ...s.leagueDump.ranges[level], ...next },
        },
      },
    }));
  const patchSignal = <K extends keyof FaabSettings["signals"]>(
    key: K,
    next: Partial<FaabSettings["signals"][K]>,
  ) =>
    setSettings((s) => ({
      ...s,
      signals: { ...s.signals, [key]: { ...s.signals[key], ...next } },
    }));
  const patchMarket = <K extends keyof FaabSettings["market"]>(
    key: K,
    next: Partial<FaabSettings["market"][K]>,
  ) =>
    setSettings((s) => ({
      ...s,
      market: { ...s.market, [key]: { ...s.market[key], ...next } },
    }));

  const updateBand = (idx: number, next: Partial<BidBand>) =>
    setSettings((s) => ({
      ...s,
      bidCurve: s.bidCurve.map((b, i) => (i === idx ? { ...b, ...next } : b)),
    }));
  const addBand = () =>
    setSettings((s) => ({
      ...s,
      bidCurve: [
        ...s.bidCurve,
        {
          id: `band_${Date.now()}`,
          minRatio: 0,
          maxRatio: 1,
          tierLabel: "New tier",
          minPct: 0,
          maxPct: 0,
          capPct: 0,
        },
      ],
    }));
  const removeBand = (idx: number) =>
    setSettings((s) => ({
      ...s,
      bidCurve: s.bidCurve.filter((_, i) => i !== idx),
    }));

  const updateDumpRange = (level: NeedLevel, next: Partial<PctRange>) =>
    setSettings((s) => ({
      ...s,
      dump: {
        ...s.dump,
        ranges: { ...s.dump.ranges, [level]: { ...s.dump.ranges[level], ...next } },
      },
    }));

  function resetDefaults() {
    setSettings(DEFAULT_FAAB_SETTINGS);
    setTeamOptionsText(DEFAULT_FAAB_SETTINGS.userDefaults.teamOptions.join(", "));
    setStarterOptionsText(DEFAULT_FAAB_SETTINGS.userDefaults.starterOptions.join(", "));
    setStatus(
      "FAAB calculator settings reset to recommended defaults in this form. Nothing is saved until you press Save settings.",
    );
  }

  function save() {
    setStatus("");
    const teamOptions = parseIntList(teamOptionsText);
    const starterOptions = parseIntList(starterOptionsText);
    if (teamOptions.length === 0 || starterOptions.length === 0) {
      setStatus("Team options and starter options must each have at least one positive number.");
      return;
    }
    const payload: FaabSettings = {
      ...settings,
      userDefaults: { ...settings.userDefaults, teamOptions, starterOptions },
    };
    startTransition(async () => {
      const res = await saveFaabSettings(payload);
      if (res.ok) {
        setSettings(payload);
        setStatus("Saved.");
      } else {
        setStatus(`Failed: ${res.error}`);
      }
    });
  }

  return (
    <div className="mt-8 space-y-6">
      <IntroCard />

      <p aria-live="polite" className="text-sm text-ink-muted">
        {isPending ? "Saving..." : status}
      </p>

      {/* 1. Quick setup */}
      <SectionCard
        title="Quick setup"
        badge={{ tone: "most-used", label: "Most used" }}
        blurb="These control what the public calculator starts with before a user changes anything."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Default league size" htmlFor={`${ids}-defteams`} hint="Team count pre-selected when the page loads.">
            <NumberInput
              id={`${ids}-defteams`}
              value={settings.userDefaults.defaultTeams}
              onChange={(n) => patchUserDefaults({ defaultTeams: Math.round(n) })}
              step="1"
              min={1}
            />
          </Field>
          <Field
            label="Team options users can pick"
            htmlFor={`${ids}-teamopts`}
            hint="Comma-separated list of selectable team counts."
          >
            <input
              id={`${ids}-teamopts`}
              value={teamOptionsText}
              onChange={(e) => setTeamOptionsText(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Default offensive starters" htmlFor={`${ids}-defstart`} hint="Starter count pre-selected on load. 12 teams x 9 starters is a safe general baseline.">
            <NumberInput
              id={`${ids}-defstart`}
              value={settings.userDefaults.defaultStarters}
              onChange={(n) => patchUserDefaults({ defaultStarters: Math.round(n) })}
              step="1"
              min={1}
            />
          </Field>
          <Field
            label="Starter options users can pick"
            htmlFor={`${ids}-startopts`}
            hint="Comma-separated list of selectable starter counts."
          >
            <input
              id={`${ids}-startopts`}
              value={starterOptionsText}
              onChange={(e) => setStarterOptionsText(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Default need level" htmlFor={`${ids}-defneed`} hint="Which need option is selected by default.">
            <select
              id={`${ids}-defneed`}
              value={settings.userDefaults.defaultNeed}
              onChange={(e) => patchUserDefaults({ defaultNeed: e.target.value as NeedLevel })}
              className={inputCls}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Starting FAAB budget" htmlFor={`${ids}-defbudget`} hint="Budget pre-filled in the box.">
            <NumberInput
              id={`${ids}-defbudget`}
              value={settings.userDefaults.defaultBudget}
              onChange={(n) => patchUserDefaults({ defaultBudget: Math.round(n) })}
              step="1"
              min={1}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field
            label="Public FAAB notice"
            htmlFor={`${ids}-economy-quick`}
            hint="The main disclaimer shown under every result. Also editable under Result copy."
          >
            <textarea
              id={`${ids}-economy-quick`}
              value={settings.copy.economyNotice}
              onChange={(e) => patchCopy({ economyNotice: e.target.value })}
              rows={3}
              className={`${inputCls} py-2`}
            />
          </Field>
        </div>
      </SectionCard>

      {/* 2. Main strategy controls */}
      <SectionCard
        title="Main strategy controls"
        badge={{ tone: "strategy", label: "Strategy" }}
        blurb="These are the main settings to adjust if the calculator feels too aggressive or too conservative."
      >
        <div className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">How much need matters</legend>
            <p className="mt-1 text-xs text-ink-subtle">
              Applied after the base, depth, and value steps, then capped by each tier. Higher high-need boost = users get more aggressive when they badly need the position.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Low need discount" htmlFor={`${ids}-needlow`} hint="Below 1 lowers the bid for low-need adds.">
                <NumberInput id={`${ids}-needlow`} value={settings.needMultipliers.low} onChange={(n) => patchNeed({ low: n })} min={0} />
              </Field>
              <Field label="Medium need baseline" htmlFor={`${ids}-needmed`} hint="Usually 1.0 (no change).">
                <NumberInput id={`${ids}-needmed`} value={settings.needMultipliers.medium} onChange={(n) => patchNeed({ medium: n })} min={0} />
              </Field>
              <Field label="High need boost" htmlFor={`${ids}-needhigh`} hint="Above 1 raises the bid when need is high.">
                <NumberInput id={`${ids}-needhigh`} value={settings.needMultipliers.high} onChange={(n) => patchNeed({ high: n })} min={0} />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">Empty-the-clip mode</legend>
            <p className="mt-1 text-xs text-ink-subtle">
              For rare, league-changing players, suggest spending most of the budget instead of the normal curve.
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.dump.enabled}
                onChange={(e) => patchDump({ enabled: e.target.checked })}
              />
              Enable empty-the-clip mode
            </label>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="How rare a player must be"
                htmlFor={`${ids}-dumpratio`}
                hint="Lower means fewer players trigger this. Higher means more players trigger this."
              >
                <NumberInput id={`${ids}-dumpratio`} value={settings.dump.thresholdRatio} onChange={(n) => patchDump({ thresholdRatio: n })} min={0} />
              </Field>
              <Field
                label="How strong value must be"
                htmlFor={`${ids}-dumpvalue`}
                hint="A player whose value score reaches this also triggers empty-the-clip mode."
              >
                <NumberInput id={`${ids}-dumpvalue`} value={settings.dump.valueScoreThreshold} onChange={(n) => patchDump({ valueScoreThreshold: n })} min={0} />
              </Field>
            </div>
            <div className="mt-3 space-y-3">
              <p className="text-xs font-medium text-ink-subtle">Dump bid ranges (% of remaining budget)</p>
              {(["low", "medium", "high"] as NeedLevel[]).map((level) => (
                <div key={level} className="grid grid-cols-2 gap-3 sm:grid-cols-[160px_1fr_1fr] sm:items-end">
                  <span className="text-sm text-ink">Dump range when need is {level}</span>
                  <Field label="Min %" htmlFor={`${ids}-dump-${level}-min`}>
                    <NumberInput id={`${ids}-dump-${level}-min`} value={settings.dump.ranges[level].minPct} onChange={(n) => updateDumpRange(level, { minPct: n })} min={0} />
                  </Field>
                  <Field label="Max %" htmlFor={`${ids}-dump-${level}-max`}>
                    <NumberInput id={`${ids}-dump-${level}-max`} value={settings.dump.ranges[level].maxPct} onChange={(n) => updateDumpRange(level, { maxPct: n })} min={0} />
                  </Field>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">League depth strength</legend>
            <p className="mt-1 text-xs text-ink-subtle">
              Shallow leagues should punish replaceable depth more. Deep leagues should value usable depth more.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Shallow league elite boost" htmlFor={`${ids}-shallowboost`} hint="Percent boost for stars in shallow leagues.">
                <NumberInput id={`${ids}-shallowboost`} value={settings.depthAdjustments.shallowEliteBoostPct} onChange={(n) => patchDepth({ shallowEliteBoostPct: n })} />
              </Field>
              <Field label="Shallow league depth discount" htmlFor={`${ids}-shallowcut`} hint="Percent cut for replaceable depth in shallow leagues.">
                <NumberInput id={`${ids}-shallowcut`} value={settings.depthAdjustments.shallowDepthCutPct} onChange={(n) => patchDepth({ shallowDepthCutPct: n })} />
              </Field>
              <Field label="Deep league depth boost" htmlFor={`${ids}-deepboost`} hint="Percent boost for usable depth in deep leagues.">
                <NumberInput id={`${ids}-deepboost`} value={settings.depthAdjustments.deepDepthBoostPct} onChange={(n) => patchDepth({ deepDepthBoostPct: n })} />
              </Field>
              <Field label="Deep league elite trim" htmlFor={`${ids}-deepreduce`} hint="Percent the elite emphasis is reduced in deep leagues.">
                <NumberInput id={`${ids}-deepreduce`} value={settings.depthAdjustments.deepEliteBoostReductionPct} onChange={(n) => patchDepth({ deepEliteBoostReductionPct: n })} />
              </Field>
            </div>
          </fieldset>
        </div>
      </SectionCard>

      {/* 3. Bid curve */}
      <SectionCard
        title="Bid curve"
        badge={{ tone: "strategy", label: "Strategy" }}
        blurb="This controls the baseline bid before need, value, and league-depth adjustments are applied."
      >
        <div className="rounded-card border border-line bg-base/40 p-3 text-xs leading-relaxed text-ink-muted">
          <p>
            Each tier covers a range of player importance. Lower numbers mean the
            player ranks closer to the weekly starter range. Higher numbers mean
            the player is more replaceable.
          </p>
          <p className="mt-2">
            <span className="font-medium text-ink">Example:</span> In a 12-team
            league starting 9 offensive players, weekly starter demand is 108. A
            player ranked around 108 is roughly starter-level.
          </p>
        </div>
        <div className="mt-3 space-y-3">
          {settings.bidCurve.map((band, i) => {
            const noMax = band.maxRatio === null;
            return (
              <div
                key={band.id}
                className="rounded-card border border-line bg-base/40 p-3"
              >
                <Field label="Tier name" htmlFor={`${ids}-band-${i}-label`}>
                  <input
                    id={`${ids}-band-${i}-label`}
                    value={band.tierLabel}
                    onChange={(e) => updateBand(i, { tierLabel: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <fieldset className="rounded-card border border-line/60 p-3">
                    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
                      Player importance range
                    </legend>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="From" htmlFor={`${ids}-band-${i}-minratio`}>
                        <NumberInput
                          id={`${ids}-band-${i}-minratio`}
                          value={band.minRatio}
                          onChange={(n) => updateBand(i, { minRatio: n })}
                          min={0}
                        />
                      </Field>
                      <Field label="To" htmlFor={`${ids}-band-${i}-maxratio`}>
                        <NumberInput
                          id={`${ids}-band-${i}-maxratio`}
                          value={band.maxRatio ?? 0}
                          onChange={(n) => updateBand(i, { maxRatio: n })}
                          min={0}
                        />
                      </Field>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-subtle">
                      <input
                        type="checkbox"
                        checked={noMax}
                        onChange={(e) =>
                          updateBand(i, { maxRatio: e.target.checked ? null : 1 })
                        }
                      />
                      Last tier (no upper limit)
                    </label>
                  </fieldset>

                  <fieldset className="rounded-card border border-line/60 p-3">
                    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
                      Starting bid range (% of budget)
                    </legend>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Min %" htmlFor={`${ids}-band-${i}-minpct`}>
                        <NumberInput
                          id={`${ids}-band-${i}-minpct`}
                          value={band.minPct}
                          onChange={(n) => updateBand(i, { minPct: n })}
                          min={0}
                        />
                      </Field>
                      <Field label="Max %" htmlFor={`${ids}-band-${i}-maxpct`}>
                        <NumberInput
                          id={`${ids}-band-${i}-maxpct`}
                          value={band.maxPct}
                          onChange={(n) => updateBand(i, { maxPct: n })}
                          min={0}
                        />
                      </Field>
                    </div>
                  </fieldset>

                  <fieldset className="rounded-card border border-line/60 p-3">
                    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
                      Max bid allowed for this tier
                    </legend>
                    <Field label="Cap %" htmlFor={`${ids}-band-${i}-cap`} hint="The bid can never exceed this, even with high need.">
                      <NumberInput
                        id={`${ids}-band-${i}-cap`}
                        value={band.capPct}
                        onChange={(n) => updateBand(i, { capPct: n })}
                        min={0}
                      />
                    </Field>
                  </fieldset>
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeBand(i)}
                    aria-label={`Remove tier ${band.tierLabel}`}
                    className="inline-flex h-11 items-center gap-1.5 rounded-card border border-line px-3 text-sm text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addBand}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add tier
          </button>
        </div>
      </SectionCard>

      {/* 4. League mode: the connected-roster calculator */}
      <SectionCard
        title="League mode"
        badge={{ tone: "strategy", label: "Connected leagues" }}
        blurb="Controls the optional calculator that prices a bid against a reader's real roster. It projects every remaining week with and without the player, so these settings decide how a lineup upgrade becomes a share of budget."
      >
        <div className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              What counts as a big upgrade
            </legend>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Points a week for a full-strength add"
                htmlFor={`${ids}-mg-points`}
                hint="A player adding this much to the starting lineup every week justifies the top of the scale."
              >
                <NumberInput
                  id={`${ids}-mg-points`}
                  value={settings.marginal.bigUpgradePointsPerWeek}
                  onChange={(n) => patchMarginal({ bigUpgradePointsPerWeek: n })}
                  min={0.1}
                />
              </Field>
              <Field
                label="Playoff odds gain for a full-strength add"
                htmlFor={`${ids}-mg-odds`}
                hint="In percentage points. Moving a team this much is a season-changing claim."
              >
                <NumberInput
                  id={`${ids}-mg-odds`}
                  value={settings.marginal.bigUpgradeOddsPoints}
                  onChange={(n) => patchMarginal({ bigUpgradeOddsPoints: n })}
                  min={0.1}
                />
              </Field>
              <Field
                label="How much playoff odds matter"
                htmlFor={`${ids}-mg-oddsw`}
                hint="0 means price on points alone, 1 means price on odds alone. 0.5 splits it."
              >
                <NumberInput
                  id={`${ids}-mg-oddsw`}
                  value={settings.marginal.oddsWeight}
                  onChange={(n) => patchMarginal({ oddsWeight: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Most of budget an upgrade can justify"
                htmlFor={`${ids}-mg-max`}
                hint="Percent. The ceiling before the empty-the-clip rules take over."
              >
                <NumberInput
                  id={`${ids}-mg-max`}
                  value={settings.marginal.maxPctFromUpgrade}
                  onChange={(n) => patchMarginal({ maxPctFromUpgrade: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Season simulations per answer"
                htmlFor={`${ids}-mg-runs`}
                hint="Runs twice per bid, once with the player and once without. Higher is steadier and slower. 200 to 20000."
              >
                <NumberInput
                  id={`${ids}-mg-runs`}
                  value={settings.marginal.simulationRuns}
                  onChange={(n) => patchMarginal({ simulationRuns: Math.round(n) })}
                  step="100"
                  min={200}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Who we will tell somebody to cut
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              A full roster means a claim costs somebody their place. Ranking that
              cut on projected points alone names whoever is hurt, because an
              injured player projects zero and so looks free to release. These
              rules decide who is off limits.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={settings.dropGuard.enabled}
                  onChange={(e) => patchDropGuard({ enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                Protect players from being suggested as cuts
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={settings.dropGuard.useHealthyBaseline}
                  onChange={(e) =>
                    patchDropGuard({ useHealthyBaseline: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                Rank cuts on what a player is worth when he plays
              </label>
              <Field
                label="Redraft: most a cut may be worth"
                htmlFor={`${ids}-dg-ratio`}
                hint="As a multiple of the player being claimed. 1 means never name somebody the market rates above the claim. 0 to 1."
              >
                <NumberInput
                  id={`${ids}-dg-ratio`}
                  value={settings.dropGuard.maxDropValueRatio}
                  onChange={(n) => patchDropGuard({ maxDropValueRatio: n })}
                  step="0.05"
                  min={0}
                />
              </Field>
              <Field
                label="Keeper: cuts come from this bottom share"
                htmlFor={`${ids}-dg-share`}
                hint="0.4 means only the bottom 40% of the roster by value is ever named. Dynasty and keeper leagues only, where a cut gives up the asset itself. 0.05 to 0.9."
              >
                <NumberInput
                  id={`${ids}-dg-share`}
                  value={settings.dropGuard.keeperBottomShare}
                  onChange={(n) => patchDropGuard({ keeperBottomShare: n })}
                  step="0.05"
                  min={0.05}
                />
              </Field>
              <Field
                label="Priced players needed before these rules run"
                htmlFor={`${ids}-dg-min`}
                hint="Below this many rostered players with a market value, the rules stand down rather than sort noise."
              >
                <NumberInput
                  id={`${ids}-dg-min`}
                  value={settings.dropGuard.minValuedPlayers}
                  onChange={(n) => patchDropGuard({ minValuedPlayers: Math.round(n) })}
                  min={0}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">The bid ladder</legend>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Aggressive bid sits this % above"
                htmlFor={`${ids}-ld-aggr`}
                hint="How far the confident rung sits above the recommended bid."
              >
                <NumberInput
                  id={`${ids}-ld-aggr`}
                  value={settings.ladder.aggressiveAbovePct}
                  onChange={(n) => patchLadder({ aggressiveAbovePct: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Safety margin on walk-away"
                htmlFor={`${ids}-ld-trim`}
                hint="Percent trimmed off the walk-away ceiling. 0 means walk away exactly where value runs out."
              >
                <NumberInput
                  id={`${ids}-ld-trim`}
                  value={settings.ladder.walkAwayTrimPct}
                  onChange={(n) => patchLadder({ walkAwayTrimPct: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Minimum bid for a starter"
                htmlFor={`${ids}-ld-min`}
                hint="A player who cracks the lineup is never recommended below this."
              >
                <NumberInput
                  id={`${ids}-ld-min`}
                  value={settings.ladder.minStartableBid}
                  onChange={(n) => patchLadder({ minStartableBid: Math.round(n) })}
                  step="1"
                  min={0}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Empty the clip, in a real league
            </legend>
            <p className="mt-1 text-xs text-ink-subtle">
              League mode triggers a dump on measured impact rather than on ranking. A team
              already out of the race is told to sit it out instead.
            </p>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.leagueDump.enabled}
                onChange={(e) => patchLeagueDump({ enabled: e.target.checked })}
                className="h-4 w-4"
              />
              Allow empty-the-clip recommendations in league mode
            </label>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Playoff odds swing that triggers it"
                htmlFor={`${ids}-lds-odds`}
                hint="Percentage points gained."
              >
                <NumberInput
                  id={`${ids}-lds-odds`}
                  value={settings.leagueDump.oddsPointsThreshold}
                  onChange={(n) => patchLeagueDump({ oddsPointsThreshold: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Points a week that triggers it"
                htmlFor={`${ids}-lds-pts`}
                hint="An upgrade this big justifies it on its own."
              >
                <NumberInput
                  id={`${ids}-lds-pts`}
                  value={settings.leagueDump.pointsPerWeekThreshold}
                  onChange={(n) => patchLeagueDump({ pointsPerWeekThreshold: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Do not tell a team below this to spend"
                htmlFor={`${ids}-lds-loser`}
                hint="Playoff odds percent. Below this, one claim does not save the season."
              >
                <NumberInput
                  id={`${ids}-lds-loser`}
                  value={settings.leagueDump.loserOddsCeiling}
                  onChange={(n) => patchLeagueDump({ loserOddsCeiling: n })}
                  min={0}
                />
              </Field>
            </div>
            <div className="mt-3 space-y-3">
              {(["low", "medium", "high"] as NeedLevel[]).map((level) => (
                <div key={level} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <p className="self-center text-xs font-medium capitalize text-ink">
                    {level} need
                  </p>
                  <Field label="Min %" htmlFor={`${ids}-ldr-${level}-min`}>
                    <NumberInput
                      id={`${ids}-ldr-${level}-min`}
                      value={settings.leagueDump.ranges[level].minPct}
                      onChange={(n) => updateLeagueDumpRange(level, { minPct: n })}
                      min={0}
                    />
                  </Field>
                  <Field label="Max %" htmlFor={`${ids}-ldr-${level}-max`}>
                    <NumberInput
                      id={`${ids}-ldr-${level}-max`}
                      value={settings.leagueDump.ranges[level].maxPct}
                      onChange={(n) => updateLeagueDumpRange(level, { maxPct: n })}
                      min={0}
                    />
                  </Field>
                </div>
              ))}
            </div>
          </fieldset>
        </div>
      </SectionCard>

      {/* 4b. Replacement level for the calculator with no league connected */}
      <SectionCard
        title="No-league replacement level"
        badge={{ tone: "strategy", label: "Manual mode" }}
        blurb="Without a roster we price a player against the last one you could already start at his position. These numbers decide where that line sits. They scale with the starter count the reader enters, so a deeper league gets a deeper replacement level."
      >
        <div className="space-y-4">
          <Field
            label="Starter count these are measured against"
            htmlFor={`${ids}-mr-baseline`}
            hint="The numbers below should add up to roughly this. Everything scales from here."
          >
            <NumberInput
              id={`${ids}-mr-baseline`}
              value={settings.manualReplacement.baselineStarters}
              onChange={(n) =>
                setSettings((s) => ({
                  ...s,
                  manualReplacement: { ...s.manualReplacement, baselineStarters: n },
                }))
              }
              min={1}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Object.keys(settings.manualReplacement.startersPerTeam)
              .sort()
              .map((position) => (
                <Field
                  key={position}
                  label={`${position} per team`}
                  htmlFor={`${ids}-mr-${position}`}
                  hint={
                    settings.manualReplacement.flatPositions.includes(position)
                      ? "Does not scale"
                      : undefined
                  }
                >
                  <NumberInput
                    id={`${ids}-mr-${position}`}
                    value={settings.manualReplacement.startersPerTeam[position]}
                    onChange={(n) => patchReplacementShape(position, n)}
                    min={0}
                  />
                </Field>
              ))}
          </div>
        </div>
      </SectionCard>

      {/* 5. Signals and market (collapsed: one row per read) */}
      <CollapsibleSection
        title="League mode signals"
        badge={{ tone: "advanced", label: "Advanced" }}
        blurb="Each of these is one read the calculator makes about a player or about the competition. Turn any of them off, or cap how far it can move a bid."
      >
        <div className="space-y-5">
          <SignalRow
            id={`${ids}-sig-opportunity`}
            title="Snap share and role change"
            hint="The strongest waiver signal there is: a jump in snap share means a real job, not one loud box score."
            enabled={settings.signals.opportunity.enabled}
            onToggle={(enabled) => patchSignal("opportunity", { enabled })}
            maxAdjustPct={settings.signals.opportunity.maxAdjustPct}
            onMax={(maxAdjustPct) => patchSignal("opportunity", { maxAdjustPct })}
          />
          <SignalRow
            id={`${ids}-sig-beat`}
            title="Beats his projection"
            hint="How often he meets or beats his own weekly number, weighted to this season."
            enabled={settings.signals.beatRate.enabled}
            onToggle={(enabled) => patchSignal("beatRate", { enabled })}
            maxAdjustPct={settings.signals.beatRate.maxAdjustPct}
            onMax={(maxAdjustPct) => patchSignal("beatRate", { maxAdjustPct })}
          />
          <SignalRow
            id={`${ids}-sig-avail`}
            title="Availability"
            hint="Points you cannot start are points you did not buy. Downside only."
            enabled={settings.signals.availability.enabled}
            onToggle={(enabled) => patchSignal("availability", { enabled })}
            maxAdjustPct={settings.signals.availability.maxAdjustPct}
            onMax={(maxAdjustPct) => patchSignal("availability", { maxAdjustPct })}
          />
          <SignalRow
            id={`${ids}-sig-matchup`}
            title="Remaining matchups"
            hint="Built from our own defense-versus-position table, weighted to the weeks he would actually start."
            enabled={settings.signals.matchup.enabled}
            onToggle={(enabled) => patchSignal("matchup", { enabled })}
            maxAdjustPct={settings.signals.matchup.maxAdjustPct}
            onMax={(maxAdjustPct) => patchSignal("matchup", { maxAdjustPct })}
          />

          <fieldset className="rounded-card border border-line bg-base/40 p-3">
            <legend className="px-1 text-xs font-semibold text-ink">
              Boom or bust (widens the range instead of moving it)
            </legend>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.signals.volatility.enabled}
                onChange={(e) => patchSignal("volatility", { enabled: e.target.checked })}
                className="h-4 w-4"
              />
              Enabled
            </label>
            <Field
              label="Most it can widen the range"
              htmlFor={`${ids}-sig-vol-max`}
              hint="Percent. An unpredictable player deserves a less confident number, not a smaller one."
            >
              <NumberInput
                id={`${ids}-sig-vol-max`}
                value={settings.signals.volatility.maxSpreadPct}
                onChange={(n) => patchSignal("volatility", { maxSpreadPct: n })}
                min={0}
              />
            </Field>
          </fieldset>

          <SignalRow
            id={`${ids}-mkt-budget`}
            title="What your rivals can spend"
            hint="Derived from each team's FAAB already used. Broke opponents mean cheap wins."
            enabled={settings.market.rivalBudget.enabled}
            onToggle={(enabled) => patchMarket("rivalBudget", { enabled })}
            maxAdjustPct={settings.market.rivalBudget.maxAdjustPct}
            onMax={(maxAdjustPct) => patchMarket("rivalBudget", { maxAdjustPct })}
          />
          <SignalRow
            id={`${ids}-mkt-need`}
            title="How many rivals want him"
            hint="Runs the same lineup test against every other roster. Costs a little time per bid."
            enabled={settings.market.rivalNeed.enabled}
            onToggle={(enabled) => patchMarket("rivalNeed", { enabled })}
            maxAdjustPct={settings.market.rivalNeed.maxAdjustPct}
            onMax={(maxAdjustPct) => patchMarket("rivalNeed", { maxAdjustPct })}
          />

          <fieldset className="rounded-card border border-line bg-base/40 p-3">
            <legend className="px-1 text-xs font-semibold text-ink">
              What this league actually pays
            </legend>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.market.history.enabled}
                onChange={(e) => patchMarket("history", { enabled: e.target.checked })}
                className="h-4 w-4"
              />
              Blend the recommendation toward the league&apos;s own winning bids
            </label>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="How far to pull toward it"
                htmlFor={`${ids}-mkt-hist-w`}
                hint="0 to 1. The model still leads; history corrects it toward reality."
              >
                <NumberInput
                  id={`${ids}-mkt-hist-w`}
                  value={settings.market.history.blendWeight}
                  onChange={(n) => patchMarket("history", { blendWeight: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Minimum past bids required"
                htmlFor={`${ids}-mkt-hist-n`}
                hint="Below this the history is ignored rather than trusted."
              >
                <NumberInput
                  id={`${ids}-mkt-hist-n`}
                  value={settings.market.history.minSamples}
                  onChange={(n) => patchMarket("history", { minSamples: Math.round(n) })}
                  step="1"
                  min={1}
                />
              </Field>
              <Field
                label="Seasons to look back"
                htmlFor={`${ids}-mkt-hist-s`}
                hint="How far back to read winning bids."
              >
                <NumberInput
                  id={`${ids}-mkt-hist-s`}
                  value={settings.market.history.lookbackSeasons}
                  onChange={(n) => patchMarket("history", { lookbackSeasons: Math.round(n) })}
                  step="1"
                  min={1}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="rounded-card border border-line bg-base/40 p-3">
            <legend className="px-1 text-xs font-semibold text-ink">
              Time of season
            </legend>
            <p className="mt-1 text-xs text-ink-subtle">
              FAAB left over when the season ends bought nothing, so the right bid climbs as
              the weeks run out.
            </p>
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.market.urgency.enabled}
                onChange={(e) => patchMarket("urgency", { enabled: e.target.checked })}
                className="h-4 w-4"
              />
              Enabled
            </label>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Early-season discount applies through week"
                htmlFor={`${ids}-mkt-urg-ew`}
              >
                <NumberInput
                  id={`${ids}-mkt-urg-ew`}
                  value={settings.market.urgency.earlySeasonWeek}
                  onChange={(n) => patchMarket("urgency", { earlySeasonWeek: Math.round(n) })}
                  step="1"
                  min={0}
                />
              </Field>
              <Field label="Size of that discount" htmlFor={`${ids}-mkt-urg-ed`} hint="Percent.">
                <NumberInput
                  id={`${ids}-mkt-urg-ed`}
                  value={settings.market.urgency.maxEarlyDiscountPct}
                  onChange={(n) => patchMarket("urgency", { maxEarlyDiscountPct: n })}
                  min={0}
                />
              </Field>
              <Field
                label="Late-season boost is full from week"
                htmlFor={`${ids}-mkt-urg-lw`}
              >
                <NumberInput
                  id={`${ids}-mkt-urg-lw`}
                  value={settings.market.urgency.lateSeasonWeek}
                  onChange={(n) => patchMarket("urgency", { lateSeasonWeek: Math.round(n) })}
                  step="1"
                  min={1}
                />
              </Field>
              <Field label="Size of that boost" htmlFor={`${ids}-mkt-urg-lb`} hint="Percent.">
                <NumberInput
                  id={`${ids}-mkt-urg-lb`}
                  value={settings.market.urgency.maxLateBoostPct}
                  onChange={(n) => patchMarket("urgency", { maxLateBoostPct: n })}
                  min={0}
                />
              </Field>
            </div>
          </fieldset>
        </div>
      </CollapsibleSection>

      {/* 6. Advanced math (collapsed by default) */}
      <CollapsibleSection
        title="Advanced math settings"
        badge={{ tone: "advanced", label: "Advanced" }}
        blurb="Most admins should not need to change these. They control how the calculator interprets rankings, values, and league depth behind the scenes."
      >
        <div className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">How values influence the bid</legend>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Replacement-level benchmark" htmlFor={`${ids}-replmult`} hint="Used to compare a player's value against the type of player usually available near the waiver line.">
                <NumberInput id={`${ids}-replmult`} value={settings.valueNormalization.replacementRankMultiplier} onChange={(n) => patchValue({ replacementRankMultiplier: n })} min={0} />
              </Field>
              <Field label="Elite-player benchmark" htmlFor={`${ids}-elitemult`} hint="Sets which rank counts as elite-level value for comparison.">
                <NumberInput id={`${ids}-elitemult`} value={settings.valueNormalization.eliteRankMultiplier} onChange={(n) => patchValue({ eliteRankMultiplier: n })} min={0} />
              </Field>
              <Field label="Minimum value score" htmlFor={`${ids}-vsmin`} hint="Lowest the value score can reach.">
                <NumberInput id={`${ids}-vsmin`} value={settings.valueNormalization.valueScoreClampMin} onChange={(n) => patchValue({ valueScoreClampMin: n })} />
              </Field>
              <Field label="Maximum value score" htmlFor={`${ids}-vsmax`} hint="Highest the value score can reach.">
                <NumberInput id={`${ids}-vsmax`} value={settings.valueNormalization.valueScoreClampMax} onChange={(n) => patchValue({ valueScoreClampMax: n })} />
              </Field>
              <Field label="No-change value score" htmlFor={`${ids}-vsneutral`} hint="The value score where value neither raises nor lowers the bid.">
                <NumberInput id={`${ids}-vsneutral`} value={settings.valueNormalization.valueScoreNeutral} onChange={(n) => patchValue({ valueScoreNeutral: n })} />
              </Field>
              <Field label="Maximum value boost or cut" htmlFor={`${ids}-vsimpact`} hint="The most a player's value score can raise or lower the bid.">
                <NumberInput id={`${ids}-vsimpact`} value={settings.valueNormalization.valueAdjustmentMaxPct} onChange={(n) => patchValue({ valueAdjustmentMaxPct: n })} min={0} />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">League depth cutoffs</legend>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Elite cutoff" htmlFor={`${ids}-eliteratio`} hint="Players at or below this importance ratio count as elite for depth tweaks.">
                <NumberInput id={`${ids}-eliteratio`} value={settings.depthAdjustments.eliteRatioMax} onChange={(n) => patchDepth({ eliteRatioMax: n })} min={0} />
              </Field>
              <Field label="Depth cutoff" htmlFor={`${ids}-depthratio`} hint="Players at or above this importance ratio count as fringe/depth.">
                <NumberInput id={`${ids}-depthratio`} value={settings.depthAdjustments.depthRatioMin} onChange={(n) => patchDepth({ depthRatioMin: n })} min={0} />
              </Field>
              <Field label="Shallow league cutoff" htmlFor={`${ids}-shallowmax`} hint="Teams x starters at or below this is treated as a shallow league.">
                <NumberInput id={`${ids}-shallowmax`} value={settings.depthAdjustments.shallowMaxDemand} onChange={(n) => patchDepth({ shallowMaxDemand: n })} min={0} />
              </Field>
              <Field label="Deep league starts after" htmlFor={`${ids}-standardmax`} hint="Above this teams x starters, a league is treated as deep.">
                <NumberInput id={`${ids}-standardmax`} value={settings.depthAdjustments.standardMaxDemand} onChange={(n) => patchDepth({ standardMaxDemand: n })} min={0} />
              </Field>
            </div>
          </fieldset>
        </div>
      </CollapsibleSection>

      {/* 5. Result copy */}
      <SectionCard
        title="Result copy"
        badge={{ tone: "public", label: "Public copy" }}
        blurb="These are the explanations users see on the public FAAB calculator."
      >
        <div className="space-y-4">
          <Field label="Public FAAB notice" htmlFor={`${ids}-economy`} hint="The main disclaimer under every result (same field as in Quick setup).">
            <textarea id={`${ids}-economy`} value={settings.copy.economyNotice} onChange={(e) => patchCopy({ economyNotice: e.target.value })} rows={3} className={`${inputCls} py-2`} />
          </Field>
          <Field label="Missing value data note" htmlFor={`${ids}-missing`} hint="Shown when value data is unavailable and the bid is rank-only.">
            <textarea id={`${ids}-missing`} value={settings.copy.missingValueNote} onChange={(e) => patchCopy({ missingValueNote: e.target.value })} rows={2} className={`${inputCls} py-2`} />
          </Field>
          <Field label="Empty-the-clip note" htmlFor={`${ids}-dumpcopy`} hint="Shown when a player triggers dump mode.">
            <textarea id={`${ids}-dumpcopy`} value={settings.copy.dumpNote} onChange={(e) => patchCopy({ dumpNote: e.target.value })} rows={3} className={`${inputCls} py-2`} />
          </Field>
          <Field label="League mode notice" htmlFor={`${ids}-leaguemode`} hint="Shown above a connected-league result. League mode makes a different promise from the general calculator, so it gets its own wording.">
            <textarea id={`${ids}-leaguemode`} value={settings.copy.leagueModeNotice} onChange={(e) => patchCopy({ leagueModeNotice: e.target.value })} rows={3} className={`${inputCls} py-2`} />
          </Field>
          <Field label="Thin data note" htmlFor={`${ids}-thindata`} hint="Shown when league mode runs but the history behind it is too thin to be confident.">
            <textarea id={`${ids}-thindata`} value={settings.copy.thinDataNote} onChange={(e) => patchCopy({ thinDataNote: e.target.value })} rows={2} className={`${inputCls} py-2`} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Teams help text" htmlFor={`${ids}-teamshelp`} hint="Help text under the team-count picker.">
              <textarea id={`${ids}-teamshelp`} value={settings.copy.teamsHelp} onChange={(e) => patchCopy({ teamsHelp: e.target.value })} rows={3} className={`${inputCls} py-2`} />
            </Field>
            <Field label="Offensive starters help text" htmlFor={`${ids}-startershelp`} hint="Help text under the starters picker.">
              <textarea id={`${ids}-startershelp`} value={settings.copy.startersHelp} onChange={(e) => patchCopy({ startersHelp: e.target.value })} rows={3} className={`${inputCls} py-2`} />
            </Field>
          </div>
        </div>
      </SectionCard>

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
          onClick={resetDefaults}
          disabled={isPending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset to recommended defaults
        </button>
      </div>
    </div>
  );
}
