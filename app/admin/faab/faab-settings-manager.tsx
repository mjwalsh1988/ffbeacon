"use client";

import { cloneElement, isValidElement, useEffect, useId, useState, useTransition } from "react";
import { ChevronDown, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type {
  BidBand,
  BidStyle,
  CalendarBand,
  FaabSettings,
  GoalKey,
  NeedLevel,
  PctRange,
} from "@/lib/faab/types";
import { DEFAULT_FAAB_SETTINGS } from "@/lib/faab/default-settings";
import type { ReplayBucket, ReplaySummary } from "@/lib/faab/replay";
import { formatEastern } from "@/lib/datetime";
import { rebuildFaabPriors, runFaabReplay, saveFaabSettings } from "./actions";

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
  max,
  "aria-describedby": describedBy,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
  min?: number;
  max?: number;
  "aria-describedby"?: string;
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
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // The hint carries the range and the meaning, so it is wired to the control
  // rather than left as text that only a sighted reader is sure to find. Done
  // by cloning the single child so every existing field gains it without a
  // call-site change; a child that already names its own description keeps it.
  const hintId = `${htmlFor}-hint`;
  const described =
    hint && isValidElement(children)
      ? cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby":
            (children as React.ReactElement<{ "aria-describedby"?: string }>).props[
              "aria-describedby"
            ] ?? hintId,
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

/**
 * The zod rules the server enforces, said out loud while the admin types.
 *
 * Every message here mirrors a refinement in lib/faab/settings.ts. Server-side
 * validation still governs: this exists so a save that would be rejected is
 * visible before the button is pressed, not instead of the check.
 */
function ValidationNotes({ problems }: { problems: string[] }) {
  return (
    <div aria-live="polite" className="mt-3">
      {problems.length > 0 && (
        <ul className="space-y-1 rounded-card border border-signal-danger/50 bg-signal-danger/10 p-3 text-xs leading-relaxed text-signal-danger">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Contiguity, in the same terms the schema puts it. */
function calendarProblems(bands: CalendarBand[]): string[] {
  const problems: string[] = [];
  if (bands.length === 0) return ["Add at least one band."];
  if (bands[0].fromWeek !== 1) {
    problems.push("The first band must start at week 1.");
  }
  if (bands[bands.length - 1].toWeek !== null) {
    problems.push(
      "The last band must run to the end of the season. Tick its end-of-season box.",
    );
  }
  bands.forEach((band, i) => {
    if (i === bands.length - 1) return;
    if (band.toWeek === null) {
      problems.push(`Band ${i + 1} ends the season, so nothing may follow it.`);
      return;
    }
    if (bands[i + 1].fromWeek !== band.toWeek + 1) {
      problems.push(
        `Band ${i + 2} must start at week ${band.toWeek + 1}, where band ${i + 1} ends.`,
      );
    }
  });
  return problems;
}

function aliveFractionProblems(
  rows: FaabSettings["chopped"]["priceByAliveFraction"],
): string[] {
  const problems: string[] = [];
  if (rows.length === 0) return ["Add at least one alive-fraction band."];
  rows.forEach((row, i) => {
    if (i > 0 && rows[i - 1].minFraction <= row.minFraction) {
      problems.push(
        `Row ${i + 1} must start below row ${i}. These run from the fullest field down.`,
      );
    }
  });
  if (rows[rows.length - 1].minFraction !== 0) {
    problems.push("The last row must start at 0, so every league is covered.");
  }
  return problems;
}

/** A share, 0 to 1, as a percent with one decimal. */
function sharePct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Median overpay, with the win count it was measured over. */
function overpayCell(value: number | null, wins: number): string {
  if (value === null) return "No wins to measure";
  return `${value.toFixed(2)}% over ${wins} wins`;
}

/** One row of the replay table. Scored on the SAME figures the script prints. */
function ReplayRow({ bucket }: { bucket: ReplayBucket }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
        {bucket.label}
      </th>
      <td className="py-2 pr-3 tabular-nums text-ink-muted">{bucket.sampleSize}</td>
      <td className="py-2 pr-3 tabular-nums text-ink-muted">
        {sharePct(bucket.valueWinShare)}
      </td>
      <td className="py-2 pr-3 tabular-nums text-ink-muted">
        {sharePct(bucket.sureWinShare)}
      </td>
      <td className="py-2 pr-3 tabular-nums text-ink-muted">
        {overpayCell(bucket.valueMedianOverpayPct, bucket.valueWins)}
      </td>
      <td className="py-2 tabular-nums text-ink-muted">
        {overpayCell(bucket.sureMedianOverpayPct, bucket.sureWins)}
      </td>
    </tr>
  );
}

function ReplayTable({ summary }: { summary: ReplaySummary }) {
  return (
    <div
      role="region"
      aria-label="Replay results by bucket"
      tabIndex={0}
      className="mt-3 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
        <caption className="px-3 pt-3 text-left text-xs text-ink-subtle">
          Every bucket, with the number of auctions behind it. Win share counts
          a bid over the real winner as a win and a bid level with it as half.
          Overpay is the median of our bid minus the winning bid, as a share of
          the league&apos;s full budget, over the auctions we strictly won.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold text-ink">
              Bucket
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold text-ink">
              Auctions
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold text-ink">
              Good value wins
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold text-ink">
              Make sure wins
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold text-ink">
              Good value overpay
            </th>
            <th scope="col" className="py-2 font-semibold text-ink">
              Make sure overpay
            </th>
          </tr>
        </thead>
        <tbody className="[&_th]:px-3 [&_td:first-of-type]:pl-0">
          <ReplayRow bucket={summary.overall} />
          {summary.standard.length > 0 && (
            <tr className="border-t border-line">
              <th
                scope="colgroup"
                colSpan={6}
                className="py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle"
              >
                Standard leagues, by time of season
              </th>
            </tr>
          )}
          {summary.standard.map((bucket) => (
            <ReplayRow key={bucket.key} bucket={bucket} />
          ))}
          {summary.chopped.length > 0 && (
            <tr className="border-t border-line">
              <th
                scope="colgroup"
                colSpan={6}
                className="py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle"
              >
                Chopped leagues, by how much of the field is left
              </th>
            </tr>
          )}
          {summary.chopped.map((bucket) => (
            <ReplayRow key={bucket.key} bucket={bucket} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function paceProblems(rows: FaabSettings["chopped"]["paceTargets"]): string[] {
  const problems: string[] = [];
  if (rows.length === 0) return ["Add at least one pace target."];
  rows.forEach((row, i) => {
    if (i > 0 && rows[i - 1].throughWeek >= row.throughWeek) {
      problems.push(`Row ${i + 1} must be a later week than row ${i}.`);
    }
  });
  return problems;
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

/** What the market priors table holds right now, read server-side. */
export type PriorsStatus = {
  /** ISO timestamp of the newest cell, or null when nothing is built. */
  builtAt: string | null;
  cells: number;
  leagues: number;
};

export function FaabSettingsManager({
  initialSettings,
  initialPriorsStatus,
}: {
  initialSettings: FaabSettings;
  initialPriorsStatus: PriorsStatus;
}) {
  const [settings, setSettings] = useState<FaabSettings>(initialSettings);
  const [priorsStatus, setPriorsStatus] = useState<PriorsStatus>(initialPriorsStatus);
  const [priorsMessage, setPriorsMessage] = useState("");
  const [isRebuilding, startRebuild] = useTransition();
  const [replay, setReplay] = useState<ReplaySummary | null>(null);
  const [replayMessage, setReplayMessage] = useState("");
  const [isReplaying, startReplay] = useTransition();
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

  // ---- the groups added by the overhaul ----
  const patchAuction = (next: Partial<FaabSettings["auction"]>) =>
    setSettings((s) => ({ ...s, auction: { ...s.auction, ...next } }));
  const patchGoal = (next: Partial<FaabSettings["goal"]>) =>
    setSettings((s) => ({ ...s, goal: { ...s.goal, ...next } }));
  const patchPriors = (next: Partial<FaabSettings["priors"]>) =>
    setSettings((s) => ({ ...s, priors: { ...s.priors, ...next } }));
  const patchStyleMultiplier = (style: BidStyle, multiplier: number) =>
    setSettings((s) => ({
      ...s,
      priors: {
        ...s.priors,
        styleMultipliers: { ...s.priors.styleMultipliers, [style]: multiplier },
      },
    }));
  const patchPlayoffValue = (next: Partial<FaabSettings["playoffValue"]>) =>
    setSettings((s) => ({ ...s, playoffValue: { ...s.playoffValue, ...next } }));
  const patchDynastyValue = (next: Partial<FaabSettings["dynastyValue"]>) =>
    setSettings((s) => ({ ...s, dynastyValue: { ...s.dynastyValue, ...next } }));
  const patchDynastyBlend = (
    status: keyof FaabSettings["dynastyValue"]["blendByStatus"],
    weight: number,
  ) =>
    setSettings((s) => ({
      ...s,
      dynastyValue: {
        ...s.dynastyValue,
        blendByStatus: { ...s.dynastyValue.blendByStatus, [status]: weight },
      },
    }));
  const patchInjury = (next: Partial<FaabSettings["injury"]>) =>
    setSettings((s) => ({ ...s, injury: { ...s.injury, ...next } }));
  const patchBreakout = (next: Partial<FaabSettings["breakout"]>) =>
    setSettings((s) => ({ ...s, breakout: { ...s.breakout, ...next } }));
  const patchChopped = (next: Partial<FaabSettings["chopped"]>) =>
    setSettings((s) => ({ ...s, chopped: { ...s.chopped, ...next } }));
  const patchChoppedWeight = (
    key: keyof FaabSettings["chopped"]["strengthWeights"],
    weight: number,
  ) =>
    setSettings((s) => ({
      ...s,
      chopped: {
        ...s.chopped,
        strengthWeights: { ...s.chopped.strengthWeights, [key]: weight },
      },
    }));
  const patchChoppedDanger = (
    key: keyof FaabSettings["chopped"]["manualDangerMultipliers"],
    multiplier: number,
  ) =>
    setSettings((s) => ({
      ...s,
      chopped: {
        ...s.chopped,
        manualDangerMultipliers: {
          ...s.chopped.manualDangerMultipliers,
          [key]: multiplier,
        },
      },
    }));

  // ---- calendar bands ----
  const updateCalendarBand = (idx: number, next: Partial<CalendarBand>) =>
    setSettings((s) => ({
      ...s,
      market: {
        ...s.market,
        calendar: {
          ...s.market.calendar,
          bands: s.market.calendar.bands.map((b, i) =>
            i === idx ? { ...b, ...next } : b,
          ),
        },
      },
    }));
  const addCalendarBand = () =>
    setSettings((s) => {
      const bands = [...s.market.calendar.bands];
      const last = bands[bands.length - 1];
      // The new band starts where the old last one ended, and the old last one
      // gives up its open end, so the list stays contiguous by construction.
      const startAt = last ? Math.min(18, (last.toWeek ?? last.fromWeek) + 1) : 1;
      if (last && last.toWeek === null) {
        bands[bands.length - 1] = { ...last, toWeek: Math.max(1, startAt - 1) };
      }
      bands.push({ fromWeek: startAt, toWeek: null, multiplier: 1 });
      return {
        ...s,
        market: { ...s.market, calendar: { ...s.market.calendar, bands } },
      };
    });
  const removeCalendarBand = (idx: number) =>
    setSettings((s) => {
      const bands = s.market.calendar.bands.filter((_, i) => i !== idx);
      // Whatever is left has to end the season, or nothing prices the last weeks.
      if (bands.length > 0) {
        bands[bands.length - 1] = { ...bands[bands.length - 1], toWeek: null };
      }
      return {
        ...s,
        market: { ...s.market, calendar: { ...s.market.calendar, bands } },
      };
    });

  // ---- chopped tables ----
  const updateAliveRow = (
    idx: number,
    next: Partial<FaabSettings["chopped"]["priceByAliveFraction"][number]>,
  ) =>
    setSettings((s) => ({
      ...s,
      chopped: {
        ...s.chopped,
        priceByAliveFraction: s.chopped.priceByAliveFraction.map((r, i) =>
          i === idx ? { ...r, ...next } : r,
        ),
      },
    }));
  const addAliveRow = () =>
    setSettings((s) => ({
      ...s,
      chopped: {
        ...s.chopped,
        priceByAliveFraction: [
          ...s.chopped.priceByAliveFraction,
          { minFraction: 0, multiplier: 1 },
        ],
      },
    }));
  const removeAliveRow = (idx: number) =>
    setSettings((s) => ({
      ...s,
      chopped: {
        ...s.chopped,
        priceByAliveFraction: s.chopped.priceByAliveFraction.filter((_, i) => i !== idx),
      },
    }));
  const updatePaceRow = (
    idx: number,
    next: Partial<FaabSettings["chopped"]["paceTargets"][number]>,
  ) =>
    setSettings((s) => ({
      ...s,
      chopped: {
        ...s.chopped,
        paceTargets: s.chopped.paceTargets.map((r, i) =>
          i === idx ? { ...r, ...next } : r,
        ),
      },
    }));
  const addPaceRow = () =>
    setSettings((s) => {
      const rows = s.chopped.paceTargets;
      const last = rows[rows.length - 1];
      return {
        ...s,
        chopped: {
          ...s.chopped,
          paceTargets: [
            ...rows,
            { throughWeek: Math.min(18, (last?.throughWeek ?? 0) + 1), holdPct: 0 },
          ],
        },
      };
    });
  const removePaceRow = (idx: number) =>
    setSettings((s) => ({
      ...s,
      chopped: {
        ...s.chopped,
        paceTargets: s.chopped.paceTargets.filter((_, i) => i !== idx),
      },
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

  function rebuildPriors() {
    setPriorsMessage("");
    startRebuild(async () => {
      const res = await rebuildFaabPriors();
      if (res.ok) {
        setPriorsStatus({
          builtAt: res.builtAt,
          cells: res.cells,
          leagues: res.leagues,
        });
        setPriorsMessage(
          `Rebuilt ${res.cells} cells from ${res.auctions} auctions across ${res.leagues} leagues. ${res.deleted} stale cells removed.`,
        );
      } else {
        setPriorsMessage(`Rebuild failed: ${res.error}`);
      }
    });
  }

  function runReplay() {
    setReplayMessage("");
    startReplay(async () => {
      const res = await runFaabReplay();
      if (res.ok) {
        setReplay(res.summary);
        setReplayMessage(
          `Graded ${res.summary.graded} of ${res.auctions} auctions across ${res.summary.leagues} leagues against ${res.cells} market cells in ${(res.ms / 1000).toFixed(1)} seconds. ${res.summary.skipped} skipped, ${res.summary.unpriced} had no cell to price from.`,
        );
      } else {
        setReplay(null);
        setReplayMessage(`Replay failed: ${res.error}`);
      }
    });
  }

  const calendarIssues = calendarProblems(settings.market.calendar.bands);
  const goalIssues =
    settings.goal.valueTarget < settings.goal.sureTarget
      ? []
      : ["The good-value target must be below the make-sure target."];
  const clampIssues = [
    ...(settings.auction.heatClamp[0] < settings.auction.heatClamp[1]
      ? []
      : ["The lower league-heat clamp must be below the upper one."]),
    ...(settings.auction.tendencyClamp[0] < settings.auction.tendencyClamp[1]
      ? []
      : ["The lower manager-tendency clamp must be below the upper one."]),
  ];
  const choppedWeightSum =
    settings.chopped.strengthWeights.surviveThisWeek +
    settings.chopped.strengthWeights.winLeague +
    settings.chopped.strengthWeights.weeksAlive;
  const choppedWeightIssues =
    choppedWeightSum >= 0.99 && choppedWeightSum <= 1.01
      ? []
      : [
          `The three survival weights must sum to 1. They currently sum to ${choppedWeightSum.toFixed(2)}.`,
        ];
  const aliveIssues = aliveFractionProblems(settings.chopped.priceByAliveFraction);
  const paceIssues = paceProblems(settings.chopped.paceTargets);

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
          <Field
            label="League's full FAAB allowance"
            htmlFor={`${ids}-defleaguebudget`}
            hint="What every team started the season with, not what the reader has left. Every price in the model is a share of this."
          >
            <NumberInput
              id={`${ids}-defleaguebudget`}
              value={settings.userDefaults.defaultLeagueBudget}
              onChange={(n) => patchUserDefaults({ defaultLeagueBudget: Math.round(n) })}
              step="1"
              min={1}
            />
          </Field>
          <Field
            label="Last regular season week"
            htmlFor={`${ids}-deflastweek`}
            hint="What manual mode assumes when there is no league to read a playoff start from. 10 to 18."
          >
            <NumberInput
              id={`${ids}-deflastweek`}
              value={settings.userDefaults.defaultLastRegularWeek}
              onChange={(n) =>
                patchUserDefaults({ defaultLastRegularWeek: Math.round(n) })
              }
              step="1"
              min={10}
              max={18}
            />
          </Field>
          <Field
            label="Default room aggression"
            htmlFor={`${ids}-defstyle`}
            hint="How hard the reader's league is assumed to bid when no league is connected."
          >
            <select
              id={`${ids}-defstyle`}
              value={settings.userDefaults.defaultStyle}
              onChange={(e) =>
                patchUserDefaults({ defaultStyle: e.target.value as BidStyle })
              }
              className={inputCls}
            >
              <option value="tight">Tight, the room holds its money</option>
              <option value="typical">Typical</option>
              <option value="wild">Wild, the room overpays</option>
            </select>
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
                  max={100}
                />
              </Field>
              <Field
                label="Rivals who would start him that triggers it"
                htmlFor={`${ids}-lds-contested`}
                hint="A crowded claim is itself a reason to spend. Our auction data turns brutal at four bidders. 1 to 32."
              >
                <NumberInput
                  id={`${ids}-lds-contested`}
                  value={settings.leagueDump.contestedRivals}
                  onChange={(n) => patchLeagueDump({ contestedRivals: Math.round(n) })}
                  step="1"
                  min={1}
                  max={32}
                />
              </Field>
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.leagueDump.superflexQbStarterOut}
                onChange={(e) =>
                  patchLeagueDump({ superflexQbStarterOut: e.target.checked })
                }
                className="h-4 w-4"
              />
              In superflex, treat a starting quarterback going out as an emergency
            </label>
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
          <Field
            label="Quarterbacks started per team in superflex"
            htmlFor={`${ids}-mr-sfqb`}
            hint="Not 2: the second starter is optional and in practice some teams run a flex instead. 1 to 2."
          >
            <NumberInput
              id={`${ids}-mr-sfqb`}
              value={settings.manualReplacement.superflexQbPerTeam}
              onChange={(n) =>
                setSettings((s) => ({
                  ...s,
                  manualReplacement: { ...s.manualReplacement, superflexQbPerTeam: n },
                }))
              }
              step="0.05"
              min={1}
              max={2}
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
              Blend the recommendation toward the league&apos;s own winning
              bids (superseded)
            </label>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
              SUPERSEDED, and the blend no longer runs. It pulled every
              recommendation toward the median of every priced claim the league
              had ever made, including the dollar cleanup adds and, in dynasty
              leagues, the offseason rookie claims, which is how a
              season-changing running back came out at five dollars. What the
              league pays now enters as league heat, measured against the same
              situation in other leagues rather than against every claim ever
              filed here. Only the lookback in seasons below is still read, and
              it decides how far back the auction history goes.
            </p>
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

          <p className="rounded-card border border-line bg-base/40 p-3 text-xs leading-relaxed text-ink-subtle">
            Time of season moved out of this list. It is now the calendar bands
            under Time of season, further down the page.
          </p>
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

      {/* 7. The rival auction */}
      <SectionCard
        title="Auction model"
        badge={{ tone: "strategy", label: "League mode" }}
        blurb="Price is not worth. What it takes to win a player is set by how many other teams file a claim and how hard they bid, so the price side of the answer is a simulation of the other wallets in the room rather than a multiplier on the reader's own valuation."
      >
        <div className="space-y-5">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.auction.enabled}
              onChange={(e) => patchAuction({ enabled: e.target.checked })}
              className="h-4 w-4"
            />
            Simulate the rival auction
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Simulation runs"
              htmlFor={`${ids}-auc-runs`}
              hint="Seeded, so the same league gets the same answer twice. 500 to 20000."
            >
              <NumberInput
                id={`${ids}-auc-runs`}
                value={settings.auction.runs}
                onChange={(n) => patchAuction({ runs: Math.round(n) })}
                step="100"
                min={500}
                max={20000}
              />
            </Field>
            <Field
              label="Chance an interested rival files a claim"
              htmlFor={`${ids}-auc-part`}
              hint="0 to 1. Wanting a player and actually bidding on him are not the same thing."
            >
              <NumberInput
                id={`${ids}-auc-part`}
                value={settings.auction.participation}
                onChange={(n) => patchAuction({ participation: n })}
                step="0.01"
                min={0}
                max={1}
              />
            </Field>
            <Field
              label="Chance a rival who does not need him bids anyway"
              htmlFor={`${ids}-auc-stray`}
              hint="0 to 1. Stray bids are why a claim nobody wanted still costs a dollar."
            >
              <NumberInput
                id={`${ids}-auc-stray`}
                value={settings.auction.strayBidRate}
                onChange={(n) => patchAuction({ strayBidRate: n })}
                step="0.01"
                min={0}
                max={1}
              />
            </Field>
            <Field
              label="Bid spread"
              htmlFor={`${ids}-auc-sigma`}
              hint="How widely a rival's bid scatters around its centre. Higher means a noisier room. 0.1 to 1.5."
            >
              <NumberInput
                id={`${ids}-auc-sigma`}
                value={settings.auction.bidSigma}
                onChange={(n) => patchAuction({ bidSigma: n })}
                step="0.05"
                min={0.1}
                max={1.5}
              />
            </Field>
            <Field
              label="Samples before league heat is trusted"
              htmlFor={`${ids}-auc-heatshrink`}
              hint="A league's own price level gets half weight at this many past auctions. Higher means we lean on the wider market for longer."
            >
              <NumberInput
                id={`${ids}-auc-heatshrink`}
                value={settings.auction.heatShrink}
                onChange={(n) => patchAuction({ heatShrink: n })}
                step="1"
                min={0}
                max={500}
              />
            </Field>
            <Field
              label="Samples before a manager's habit is trusted"
              htmlFor={`${ids}-auc-tendshrink`}
              hint="The same, for one manager rather than a whole league. One person bids far less often, so this is lower."
            >
              <NumberInput
                id={`${ids}-auc-tendshrink`}
                value={settings.auction.tendencyShrink}
                onChange={(n) => patchAuction({ tendencyShrink: n })}
                step="1"
                min={0}
                max={500}
              />
            </Field>
            <Field
              label="Earliest week counted"
              htmlFor={`${ids}-auc-minweek`}
              hint="Auctions before this week are ignored. Week 1 is a different market: budgets are full and half the room bids on everything. 1 to 18."
            >
              <NumberInput
                id={`${ids}-auc-minweek`}
                value={settings.auction.minContestedWeek}
                onChange={(n) => patchAuction({ minContestedWeek: Math.round(n) })}
                step="1"
                min={1}
                max={18}
              />
            </Field>
          </div>

          <fieldset className="rounded-card border border-line bg-base/40 p-3">
            <legend className="px-1 text-xs font-semibold text-ink">
              How far heat and habit may move a price
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              Both are multipliers on a rival's bid, and both are clamped so a
              handful of loud auctions cannot double or halve a whole room.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="League heat, lowest" htmlFor={`${ids}-auc-heat-min`}>
                <NumberInput
                  id={`${ids}-auc-heat-min`}
                  value={settings.auction.heatClamp[0]}
                  onChange={(n) =>
                    patchAuction({ heatClamp: [n, settings.auction.heatClamp[1]] })
                  }
                  step="0.05"
                  min={0}
                  max={10}
                />
              </Field>
              <Field label="League heat, highest" htmlFor={`${ids}-auc-heat-max`}>
                <NumberInput
                  id={`${ids}-auc-heat-max`}
                  value={settings.auction.heatClamp[1]}
                  onChange={(n) =>
                    patchAuction({ heatClamp: [settings.auction.heatClamp[0], n] })
                  }
                  step="0.05"
                  min={0}
                  max={10}
                />
              </Field>
              <Field label="Manager habit, lowest" htmlFor={`${ids}-auc-tend-min`}>
                <NumberInput
                  id={`${ids}-auc-tend-min`}
                  value={settings.auction.tendencyClamp[0]}
                  onChange={(n) =>
                    patchAuction({
                      tendencyClamp: [n, settings.auction.tendencyClamp[1]],
                    })
                  }
                  step="0.05"
                  min={0}
                  max={10}
                />
              </Field>
              <Field label="Manager habit, highest" htmlFor={`${ids}-auc-tend-max`}>
                <NumberInput
                  id={`${ids}-auc-tend-max`}
                  value={settings.auction.tendencyClamp[1]}
                  onChange={(n) =>
                    patchAuction({
                      tendencyClamp: [settings.auction.tendencyClamp[0], n],
                    })
                  }
                  step="0.05"
                  min={0}
                  max={10}
                />
              </Field>
            </div>
            <ValidationNotes problems={clampIssues} />
          </fieldset>

          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.auction.oddNudge}
              onChange={(e) => patchAuction({ oddNudge: e.target.checked })}
              className="h-4 w-4"
            />
            Nudge a round recommended bid up by one dollar
          </label>
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            Ties are common on round numbers, and in most leagues a tie is
            settled by waiver order rather than by money.
          </p>
        </div>
      </SectionCard>

      {/* 8. Which question the reader is asking */}
      <SectionCard
        title="Goals"
        badge={{ tone: "strategy", label: "League mode" }}
        blurb="Two different questions about the same player: what is he worth, and what does it take to be sure of him. Each goal is a win chance the recommended bid aims at."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Goal the page opens on"
            htmlFor={`${ids}-goal-default`}
            hint="A chopped league in danger can still flip this for that reader."
          >
            <select
              id={`${ids}-goal-default`}
              value={settings.goal.defaultGoal}
              onChange={(e) => patchGoal({ defaultGoal: e.target.value as GoalKey })}
              className={inputCls}
            >
              <option value="value">Good value</option>
              <option value="sure">Make sure I win him</option>
            </select>
          </Field>
          <Field
            label="Most the sure bid may exceed his worth"
            htmlFor={`${ids}-goal-over`}
            hint="Percent. The page labels the bid when it does. 0 to 200."
          >
            <NumberInput
              id={`${ids}-goal-over`}
              value={settings.goal.sureMaxOverWorthPct}
              onChange={(n) => patchGoal({ sureMaxOverWorthPct: n })}
              step="1"
              min={0}
              max={200}
            />
          </Field>
          <Field
            label="Win chance the good-value bid aims at"
            htmlFor={`${ids}-goal-value`}
            hint="0 to 1. Must be below the make-sure target."
          >
            <NumberInput
              id={`${ids}-goal-value`}
              value={settings.goal.valueTarget}
              onChange={(n) => patchGoal({ valueTarget: n })}
              step="0.01"
              min={0}
              max={1}
            />
          </Field>
          <Field
            label="Win chance the make-sure bid aims at"
            htmlFor={`${ids}-goal-sure`}
            hint="0 to 1. Must be above the good-value target."
          >
            <NumberInput
              id={`${ids}-goal-sure`}
              value={settings.goal.sureTarget}
              onChange={(n) => patchGoal({ sureTarget: n })}
              step="0.01"
              min={0}
              max={1}
            />
          </Field>
        </div>
        <ValidationNotes problems={goalIssues} />
      </SectionCard>

      {/* 9. Time of season, as measured bands */}
      <SectionCard
        title="Time of season"
        badge={{ tone: "strategy", label: "Strategy" }}
        blurb="What each stretch of the season does to prices, measured rather than assumed. Our own priced winning bids say weeks 2 to 6 are the most expensive run of the regular season, the middle is the cheapest, and week 14 on is dearer than anything, because leftover budget buys nothing in January."
      >
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={settings.market.calendar.enabled}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                market: {
                  ...s.market,
                  calendar: { ...s.market.calendar, enabled: e.target.checked },
                },
              }))
            }
            className="h-4 w-4"
          />
          Apply the calendar multiplier
        </label>

        <p className="mt-3 rounded-card border border-line bg-base/40 p-3 text-xs leading-relaxed text-ink-muted">
          The bands must cover every week with no gap and no overlap: they start
          at week 1, each one picks up where the last ended, and the final band
          runs to the end of the season. A multiplier of 1 leaves prices alone.
        </p>

        <div className="mt-3 space-y-3">
          {settings.market.calendar.bands.map((band, i) => {
            const runsToEnd = band.toWeek === null;
            return (
              <div
                key={`calendar-${i}`}
                className="rounded-card border border-line bg-base/40 p-3"
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="From week" htmlFor={`${ids}-cal-${i}-from`}>
                    <NumberInput
                      id={`${ids}-cal-${i}-from`}
                      value={band.fromWeek}
                      onChange={(n) =>
                        updateCalendarBand(i, { fromWeek: Math.round(n) })
                      }
                      step="1"
                      min={1}
                      max={18}
                    />
                  </Field>
                  <Field
                    label="Through week"
                    htmlFor={`${ids}-cal-${i}-to`}
                    hint={runsToEnd ? "Runs to the end of the season." : undefined}
                  >
                    <NumberInput
                      id={`${ids}-cal-${i}-to`}
                      value={band.toWeek ?? band.fromWeek}
                      onChange={(n) => updateCalendarBand(i, { toWeek: Math.round(n) })}
                      step="1"
                      min={1}
                      max={18}
                    />
                  </Field>
                  <Field
                    label="Price multiplier"
                    htmlFor={`${ids}-cal-${i}-mult`}
                    hint="0.1 to 5."
                  >
                    <NumberInput
                      id={`${ids}-cal-${i}-mult`}
                      value={band.multiplier}
                      onChange={(n) => updateCalendarBand(i, { multiplier: n })}
                      step="0.05"
                      min={0.1}
                      max={5}
                    />
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex min-h-11 items-center gap-2 text-[11px] text-ink-subtle">
                    <input
                      type="checkbox"
                      checked={runsToEnd}
                      onChange={(e) =>
                        updateCalendarBand(i, {
                          toWeek: e.target.checked ? null : band.fromWeek,
                        })
                      }
                      className="h-4 w-4"
                    />
                    Runs to the end of the season
                  </label>
                  <button
                    type="button"
                    onClick={() => removeCalendarBand(i)}
                    aria-label={`Remove the band starting at week ${band.fromWeek}`}
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
            onClick={addCalendarBand}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add band
          </button>
        </div>
        <ValidationNotes problems={calendarIssues} />

        <details className="mt-4 rounded-card border border-line bg-base/40">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 p-3 text-xs font-semibold text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            Superseded: the old urgency settings
          </summary>
          <div className="border-t border-line p-3">
            <p className="text-xs leading-relaxed text-ink-subtle">
              These four fields no longer affect the bid. The calendar bands
              above replaced them. They are still stored and still editable only
              so an older saved row keeps loading; nothing reads them, and they
              will be deleted once every stored row has been rewritten.
            </p>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.market.urgency.enabled}
                onChange={(e) => patchMarket("urgency", { enabled: e.target.checked })}
                className="h-4 w-4"
              />
              Enabled (has no effect)
            </label>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Early-season discount applies through week"
                htmlFor={`${ids}-mkt-urg-ew`}
                hint="No longer read. 0 to 18."
              >
                <NumberInput
                  id={`${ids}-mkt-urg-ew`}
                  value={settings.market.urgency.earlySeasonWeek}
                  onChange={(n) =>
                    patchMarket("urgency", { earlySeasonWeek: Math.round(n) })
                  }
                  step="1"
                  min={0}
                  max={18}
                />
              </Field>
              <Field
                label="Size of that discount"
                htmlFor={`${ids}-mkt-urg-ed`}
                hint="Percent. No longer read. 0 to 100."
              >
                <NumberInput
                  id={`${ids}-mkt-urg-ed`}
                  value={settings.market.urgency.maxEarlyDiscountPct}
                  onChange={(n) => patchMarket("urgency", { maxEarlyDiscountPct: n })}
                  min={0}
                  max={100}
                />
              </Field>
              <Field
                label="Late-season boost is full from week"
                htmlFor={`${ids}-mkt-urg-lw`}
                hint="No longer read. Must be after the early-season week. 1 to 18."
              >
                <NumberInput
                  id={`${ids}-mkt-urg-lw`}
                  value={settings.market.urgency.lateSeasonWeek}
                  onChange={(n) =>
                    patchMarket("urgency", { lateSeasonWeek: Math.round(n) })
                  }
                  step="1"
                  min={1}
                  max={18}
                />
              </Field>
              <Field
                label="Size of that boost"
                htmlFor={`${ids}-mkt-urg-lb`}
                hint="Percent. No longer read. 0 to 300."
              >
                <NumberInput
                  id={`${ids}-mkt-urg-lb`}
                  value={settings.market.urgency.maxLateBoostPct}
                  onChange={(n) => patchMarket("urgency", { maxLateBoostPct: n })}
                  min={0}
                  max={300}
                />
              </Field>
            </div>
            <ValidationNotes
              problems={
                settings.market.urgency.earlySeasonWeek <
                settings.market.urgency.lateSeasonWeek
                  ? []
                  : [
                      "The early-season week must still be before the late-season week, or the save is rejected.",
                    ]
              }
            />
          </div>
        </details>
      </SectionCard>

      {/* 10. The anonymous clearing-price cells */}
      <SectionCard
        title="Market data"
        badge={{ tone: "strategy", label: "Strategy" }}
        blurb="What a waiver claim actually costs, measured across every league we hold and stored as anonymous quantiles by situation. The nightly derived-data job rebuilds these when they go stale; this is the same work on demand."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Minimum samples per cell"
            htmlFor={`${ids}-pri-min`}
            hint="A cell thinner than this falls back to a coarser one instead of being trusted."
          >
            <NumberInput
              id={`${ids}-pri-min`}
              value={settings.priors.minCellSamples}
              onChange={(n) => patchPriors({ minCellSamples: Math.round(n) })}
              step="1"
              min={1}
              max={10000}
            />
          </Field>
          <Field
            label="Rebuild after this many days"
            htmlFor={`${ids}-pri-stale`}
            hint="The nightly job rebuilds only when the newest cell is older than this. 1 to 60."
          >
            <NumberInput
              id={`${ids}-pri-stale`}
              value={settings.priors.staleAfterDays}
              onChange={(n) => patchPriors({ staleAfterDays: Math.round(n) })}
              step="1"
              min={1}
              max={60}
            />
          </Field>
        </div>

        <fieldset className="mt-5 rounded-card border border-line bg-base/40 p-3">
          <legend className="px-1 text-xs font-semibold text-ink">
            How hard the room bids
          </legend>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
            Applied to the measured price when the reader has no league connected
            and has told us what kind of room they are in. 0.1 to 3.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Tight room"
              htmlFor={`${ids}-pri-tight`}
              hint="Below 1: this league holds its money."
            >
              <NumberInput
                id={`${ids}-pri-tight`}
                value={settings.priors.styleMultipliers.tight}
                onChange={(n) => patchStyleMultiplier("tight", n)}
                step="0.05"
                min={0.1}
                max={3}
              />
            </Field>
            <Field
              label="Typical room"
              htmlFor={`${ids}-pri-typical`}
              hint="Usually 1, the measured market as it is."
            >
              <NumberInput
                id={`${ids}-pri-typical`}
                value={settings.priors.styleMultipliers.typical}
                onChange={(n) => patchStyleMultiplier("typical", n)}
                step="0.05"
                min={0.1}
                max={3}
              />
            </Field>
            <Field
              label="Wild room"
              htmlFor={`${ids}-pri-wild`}
              hint="Above 1: this league overpays."
            >
              <NumberInput
                id={`${ids}-pri-wild`}
                value={settings.priors.styleMultipliers.wild}
                onChange={(n) => patchStyleMultiplier("wild", n)}
                step="0.05"
                min={0.1}
                max={3}
              />
            </Field>
          </div>
        </fieldset>

        <div className="mt-5 rounded-card border border-line bg-base/60 p-3">
          <p className="text-sm text-ink-muted">
            {priorsStatus.builtAt
              ? `Last built ${formatEastern(priorsStatus.builtAt)}, ${priorsStatus.cells} cells from ${priorsStatus.leagues} leagues.`
              : "Not built yet. No cells are stored, so the calculator is pricing without measured market data."}
          </p>
          <button
            type="button"
            onClick={rebuildPriors}
            disabled={isRebuilding}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {isRebuilding ? "Rebuilding..." : "Rebuild now"}
          </button>
          <p aria-live="polite" className="mt-2 text-sm text-ink-muted">
            {isRebuilding
              ? "Rebuilding the market cells. This reads every auction we hold, so it can take a minute."
              : priorsMessage}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
            A rebuild uses the minimum sample size already saved, so save this
            page first if you have just changed it.
          </p>
        </div>
      </SectionCard>

      {/* 11. Playoffs and title */}
      <CollapsibleSection
        title="Playoffs and title"
        badge={{ tone: "advanced", label: "Advanced" }}
        blurb="A week in the bracket is not the same purchase as a week in November. These decide how much of a player's worth comes from the games that decide the season."
      >
        <div className="space-y-4">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.playoffValue.enabled}
              onChange={(e) => patchPlayoffValue({ enabled: e.target.checked })}
              className="h-4 w-4"
            />
            Weigh playoff weeks and title odds
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="What a playoff week is worth"
              htmlFor={`${ids}-pv-week`}
              hint="Counted this much, times the chance of actually playing it. 1 means a playoff week counts the same as a regular one. 0 to 3."
            >
              <NumberInput
                id={`${ids}-pv-week`}
                value={settings.playoffValue.playoffWeekWeight}
                onChange={(n) => patchPlayoffValue({ playoffWeekWeight: n })}
                step="0.05"
                min={0}
                max={3}
              />
            </Field>
            <Field
              label="Share of strength from title odds"
              htmlFor={`${ids}-pv-title`}
              hint="0 to 1. The rest comes from points and playoff odds."
            >
              <NumberInput
                id={`${ids}-pv-title`}
                value={settings.playoffValue.titleOddsWeight}
                onChange={(n) => patchPlayoffValue({ titleOddsWeight: n })}
                step="0.01"
                min={0}
                max={1}
              />
            </Field>
            <Field
              label="Title odds gain that is full strength"
              htmlFor={`${ids}-pv-big`}
              hint="In percentage points. Titles move far less than playoff berths do, so this is a smaller number. 0.1 to 100."
            >
              <NumberInput
                id={`${ids}-pv-big`}
                value={settings.playoffValue.bigTitleOddsPoints}
                onChange={(n) => patchPlayoffValue({ bigTitleOddsPoints: n })}
                step="0.1"
                min={0.1}
                max={100}
              />
            </Field>
          </div>
        </div>
      </CollapsibleSection>

      {/* 12. Dynasty */}
      <CollapsibleSection
        title="Dynasty value"
        badge={{ tone: "advanced", label: "Advanced" }}
        blurb="A contender is buying weeks and a rebuilder is buying an asset. The blend is the one number that separates those two answers about the same player."
      >
        <div className="space-y-4">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.dynastyValue.enabled}
              onChange={(e) => patchDynastyValue({ enabled: e.target.checked })}
              className="h-4 w-4"
            />
            Blend market value into the bid in dynasty and keeper leagues
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Weight on market value, by team status
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              0 prices purely on lineup points this season, 1 purely on what the
              market says he is worth.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Contender" htmlFor={`${ids}-dv-comp`}>
                <NumberInput
                  id={`${ids}-dv-comp`}
                  value={settings.dynastyValue.blendByStatus.competitor}
                  onChange={(n) => patchDynastyBlend("competitor", n)}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
              <Field label="Loaded" htmlFor={`${ids}-dv-loaded`}>
                <NumberInput
                  id={`${ids}-dv-loaded`}
                  value={settings.dynastyValue.blendByStatus.loaded}
                  onChange={(n) => patchDynastyBlend("loaded", n)}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
              <Field label="Middle" htmlFor={`${ids}-dv-middle`}>
                <NumberInput
                  id={`${ids}-dv-middle`}
                  value={settings.dynastyValue.blendByStatus.middle}
                  onChange={(n) => patchDynastyBlend("middle", n)}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
              <Field label="Rebuilder" htmlFor={`${ids}-dv-rebuild`}>
                <NumberInput
                  id={`${ids}-dv-rebuild`}
                  value={settings.dynastyValue.blendByStatus.rebuilder}
                  onChange={(n) => patchDynastyBlend("rebuilder", n)}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
            </div>
          </fieldset>
          <Field
            label="Where elite dynasty value sits"
            htmlFor={`${ids}-dv-elite`}
            hint="Elite value is read at the rank teams x starters x this. 0.25 means the top quarter of the weekly starter pool. 0.01 to 2."
          >
            <NumberInput
              id={`${ids}-dv-elite`}
              value={settings.dynastyValue.eliteRankFactor}
              onChange={(n) => patchDynastyValue({ eliteRankFactor: n })}
              step="0.01"
              min={0.01}
              max={2}
            />
          </Field>
        </div>
      </CollapsibleSection>

      {/* 13. Injuries and roles */}
      <CollapsibleSection
        title="Injuries and roles"
        badge={{ tone: "advanced", label: "Advanced" }}
        blurb="Why a player is suddenly available usually matters more than what he did last Sunday. These control how an injury ahead of him, and a role that has just grown, move the bid."
      >
        <div className="space-y-5">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.injury.carryOutFromSource}
              onChange={(e) => patchInjury({ carryOutFromSource: e.target.checked })}
              className="h-4 w-4"
            />
            Carry an OUT week forward into weeks the source published nothing
            for (not active yet)
          </label>
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            NOT ACTIVE YET. This switch is saved but nothing reads it. Carrying
            an injury forward means changing the shared projection path that
            Power Pulse, Lineups, Schedules and the Manager Ledger all run on,
            which is a decision of its own rather than part of the FAAB work.
            The intent, when it lands: a player ruled out for the season should
            not read as available again the moment the feed stops mentioning
            him.
          </p>

          <SignalRow
            id={`${ids}-inj-teammate`}
            title="The man ahead of him is hurt"
            hint="A back-up whose starter is out is a different player this week from the one he was last week."
            enabled={settings.injury.teammateSignal.enabled}
            onToggle={(enabled) =>
              patchInjury({
                teammateSignal: { ...settings.injury.teammateSignal, enabled },
              })
            }
            maxAdjustPct={settings.injury.teammateSignal.maxAdjustPct}
            onMax={(maxAdjustPct) =>
              patchInjury({
                teammateSignal: { ...settings.injury.teammateSignal, maxAdjustPct },
              })
            }
          />

          <fieldset className="rounded-card border border-line bg-base/40 p-3">
            <legend className="px-1 text-xs font-semibold text-ink">
              A role that has just grown
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              A projection built on last month's usage understates a player who
              took over the job two weeks ago.
            </p>
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={settings.breakout.enabled}
                onChange={(e) => patchBreakout({ enabled: e.target.checked })}
                className="h-4 w-4"
              />
              Blend recent usage into the projection
            </label>
            <Field
              label="How far to pull toward recent usage"
              htmlFor={`${ids}-brk-weight`}
              hint="0 keeps the published projection, 1 replaces it with what recent usage implies. 0 to 1."
            >
              <NumberInput
                id={`${ids}-brk-weight`}
                value={settings.breakout.blendWeight}
                onChange={(n) => patchBreakout({ blendWeight: n })}
                step="0.05"
                min={0}
                max={1}
              />
            </Field>
          </fieldset>
        </div>
      </CollapsibleSection>

      {/* 14. Chopped, guillotine, death and knockout */}
      <CollapsibleSection
        title="Chopped leagues"
        badge={{ tone: "advanced", label: "Advanced" }}
        blurb="A different game with the same currency. There are no playoffs and no opponent: the whole league is the opponent, the lowest score each week is eliminated, and that whole roster returns to waivers. Worth is measured in survival, and price falls as the field shrinks."
      >
        <div className="space-y-6">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.chopped.enabled}
              onChange={(e) => patchChopped({ enabled: e.target.checked })}
              className="h-4 w-4"
            />
            Price chopped and guillotine leagues with their own model
          </label>

          <Field
            label="Survival simulation runs"
            htmlFor={`${ids}-ch-runs`}
            hint="Seeded, like every other simulation here. 500 to 20000."
          >
            <NumberInput
              id={`${ids}-ch-runs`}
              value={settings.chopped.runs}
              onChange={(n) => patchChopped({ runs: Math.round(n) })}
              step="100"
              min={500}
              max={20000}
            />
          </Field>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              What survival is made of
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              The three weights must sum to 1. Surviving this week is the
              immediate question, winning the league is the whole one, and
              expected weeks alive is the ground between them.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Surviving this week"
                htmlFor={`${ids}-ch-w-survive`}
                hint="0 to 1."
              >
                <NumberInput
                  id={`${ids}-ch-w-survive`}
                  value={settings.chopped.strengthWeights.surviveThisWeek}
                  onChange={(n) => patchChoppedWeight("surviveThisWeek", n)}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
              <Field
                label="Winning the league"
                htmlFor={`${ids}-ch-w-win`}
                hint="0 to 1."
              >
                <NumberInput
                  id={`${ids}-ch-w-win`}
                  value={settings.chopped.strengthWeights.winLeague}
                  onChange={(n) => patchChoppedWeight("winLeague", n)}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
              <Field
                label="Expected weeks alive"
                htmlFor={`${ids}-ch-w-weeks`}
                hint="0 to 1."
              >
                <NumberInput
                  id={`${ids}-ch-w-weeks`}
                  value={settings.chopped.strengthWeights.weeksAlive}
                  onChange={(n) => patchChoppedWeight("weeksAlive", n)}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
            </div>
            <ValidationNotes problems={choppedWeightIssues} />
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              What counts as a full-strength add
            </legend>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Survival gain that is full strength"
                htmlFor={`${ids}-ch-bigsurvive`}
                hint="In percentage points on the chance of surviving this week. 0.1 to 100."
              >
                <NumberInput
                  id={`${ids}-ch-bigsurvive`}
                  value={settings.chopped.bigSurvivePoints}
                  onChange={(n) => patchChopped({ bigSurvivePoints: n })}
                  step="0.5"
                  min={0.1}
                  max={100}
                />
              </Field>
              <Field
                label="Win-the-league gain that is full strength"
                htmlFor={`${ids}-ch-bigwin`}
                hint="In percentage points. 0.1 to 100."
              >
                <NumberInput
                  id={`${ids}-ch-bigwin`}
                  value={settings.chopped.bigWinPoints}
                  onChange={(n) => patchChopped({ bigWinPoints: n })}
                  step="0.5"
                  min={0.1}
                  max={100}
                />
              </Field>
              <Field
                label="Weeks-alive gain that is full strength"
                htmlFor={`${ids}-ch-bigweeks`}
                hint="In weeks. 0.1 to 18."
              >
                <NumberInput
                  id={`${ids}-ch-bigweeks`}
                  value={settings.chopped.bigWeeksAlive}
                  onChange={(n) => patchChopped({ bigWeeksAlive: n })}
                  step="0.1"
                  min={0.1}
                  max={18}
                />
              </Field>
              <Field
                label="Most of budget an upgrade can justify"
                htmlFor={`${ids}-ch-maxpct`}
                hint="Percent. Lower than the standard league ceiling, because money in a shrinking field is worth less every week. 0 to 100."
              >
                <NumberInput
                  id={`${ids}-ch-maxpct`}
                  value={settings.chopped.maxPctFromUpgrade}
                  onChange={(n) => patchChopped({ maxPctFromUpgrade: n })}
                  step="1"
                  min={0}
                  max={100}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Price as the field shrinks
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              Rows run from the fullest field down, and the last row must start
              at 0 so every league is covered. The multiplier is applied to the
              measured price.
            </p>
            <div className="mt-3 space-y-3">
              {settings.chopped.priceByAliveFraction.map((row, i) => (
                <div
                  key={`alive-${i}`}
                  className="grid grid-cols-2 gap-3 rounded-card border border-line bg-base/40 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                >
                  <Field
                    label="Share of teams still alive, from"
                    htmlFor={`${ids}-ch-alive-${i}-frac`}
                    hint="0 to 1."
                  >
                    <NumberInput
                      id={`${ids}-ch-alive-${i}-frac`}
                      value={row.minFraction}
                      onChange={(n) => updateAliveRow(i, { minFraction: n })}
                      step="0.05"
                      min={0}
                      max={1}
                    />
                  </Field>
                  <Field
                    label="Price multiplier"
                    htmlFor={`${ids}-ch-alive-${i}-mult`}
                    hint="0 to 3."
                  >
                    <NumberInput
                      id={`${ids}-ch-alive-${i}-mult`}
                      value={row.multiplier}
                      onChange={(n) => updateAliveRow(i, { multiplier: n })}
                      step="0.05"
                      min={0}
                      max={3}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => removeAliveRow(i)}
                    aria-label={`Remove the alive-fraction band starting at ${row.minFraction}`}
                    className="col-span-2 inline-flex h-11 items-center justify-center gap-1.5 rounded-card border border-line px-3 text-sm text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan sm:col-span-1"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addAliveRow}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add alive-fraction band
              </button>
            </div>
            <ValidationNotes problems={aliveIssues} />
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              How much budget to still be holding
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              Rows run in week order. The page tells a reader whether they are
              ahead of, on, or behind this pace.
            </p>
            <div className="mt-3 space-y-3">
              {settings.chopped.paceTargets.map((row, i) => (
                <div
                  key={`pace-${i}`}
                  className="grid grid-cols-2 gap-3 rounded-card border border-line bg-base/40 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                >
                  <Field
                    label="Through week"
                    htmlFor={`${ids}-ch-pace-${i}-week`}
                    hint="1 to 18."
                  >
                    <NumberInput
                      id={`${ids}-ch-pace-${i}-week`}
                      value={row.throughWeek}
                      onChange={(n) => updatePaceRow(i, { throughWeek: Math.round(n) })}
                      step="1"
                      min={1}
                      max={18}
                    />
                  </Field>
                  <Field
                    label="Budget still held"
                    htmlFor={`${ids}-ch-pace-${i}-hold`}
                    hint="Percent. 0 to 100."
                  >
                    <NumberInput
                      id={`${ids}-ch-pace-${i}-hold`}
                      value={row.holdPct}
                      onChange={(n) => updatePaceRow(i, { holdPct: n })}
                      step="1"
                      min={0}
                      max={100}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => removePaceRow(i)}
                    aria-label={`Remove the pace target through week ${row.throughWeek}`}
                    className="col-span-2 inline-flex h-11 items-center justify-center gap-1.5 rounded-card border border-line px-3 text-sm text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan sm:col-span-1"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addPaceRow}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add pace target
              </button>
            </div>
            <ValidationNotes problems={paceIssues} />
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Danger, rivals and substitutes
            </legend>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Danger that flips the goal to make-sure"
                htmlFor={`${ids}-ch-danger`}
                hint="Chance of being chopped this week, 0 to 1. Above this the page opens on the make-sure bid."
              >
                <NumberInput
                  id={`${ids}-ch-danger`}
                  value={settings.chopped.dangerThreshold}
                  onChange={(n) => patchChopped({ dangerThreshold: n })}
                  step="0.01"
                  min={0}
                  max={1}
                />
              </Field>
              <Field
                label="How much a rival's own danger raises their bid"
                htmlFor={`${ids}-ch-dangerw`}
                hint="0 leaves rivals unmoved by their own position, higher makes a desperate team bid harder. 0 to 3."
              >
                <NumberInput
                  id={`${ids}-ch-dangerw`}
                  value={settings.chopped.dangerWeight}
                  onChange={(n) => patchChopped({ dangerWeight: n })}
                  step="0.05"
                  min={0}
                  max={3}
                />
              </Field>
              <Field
                label="What counts as a substitute"
                htmlFor={`${ids}-ch-subshare`}
                hint="A free agent projecting at least this share of the candidate is a substitute for him. 0 to 1."
              >
                <NumberInput
                  id={`${ids}-ch-subshare`}
                  value={settings.chopped.substituteShare}
                  onChange={(n) => patchChopped({ substituteShare: n })}
                  step="0.05"
                  min={0}
                  max={1}
                />
              </Field>
              <Field
                label="What each substitute does to rival interest"
                htmlFor={`${ids}-ch-subdisc`}
                hint="Each substitute divides rival participation by 1 plus this. 0 to 3."
              >
                <NumberInput
                  id={`${ids}-ch-subdisc`}
                  value={settings.chopped.substituteDiscount}
                  onChange={(n) => patchChopped({ substituteDiscount: n })}
                  step="0.05"
                  min={0}
                  max={3}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Danger the reader tells us, with no league connected
            </legend>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              Manual mode has no roster to read, so the reader says how much
              trouble they are in and these multiply the bid. 0.1 to 3.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Bottom two" htmlFor={`${ids}-ch-md-bottom`}>
                <NumberInput
                  id={`${ids}-ch-md-bottom`}
                  value={settings.chopped.manualDangerMultipliers.bottomTwo}
                  onChange={(n) => patchChoppedDanger("bottomTwo", n)}
                  step="0.05"
                  min={0.1}
                  max={3}
                />
              </Field>
              <Field label="Near the cut" htmlFor={`${ids}-ch-md-near`}>
                <NumberInput
                  id={`${ids}-ch-md-near`}
                  value={settings.chopped.manualDangerMultipliers.nearCut}
                  onChange={(n) => patchChoppedDanger("nearCut", n)}
                  step="0.05"
                  min={0.1}
                  max={3}
                />
              </Field>
              <Field label="Mid pack" htmlFor={`${ids}-ch-md-mid`}>
                <NumberInput
                  id={`${ids}-ch-md-mid`}
                  value={settings.chopped.manualDangerMultipliers.midPack}
                  onChange={(n) => patchChoppedDanger("midPack", n)}
                  step="0.05"
                  min={0.1}
                  max={3}
                />
              </Field>
              <Field label="Safe" htmlFor={`${ids}-ch-md-safe`}>
                <NumberInput
                  id={`${ids}-ch-md-safe`}
                  value={settings.chopped.manualDangerMultipliers.safe}
                  onChange={(n) => patchChoppedDanger("safe", n)}
                  step="0.05"
                  min={0.1}
                  max={3}
                />
              </Field>
            </div>
          </fieldset>
        </div>
      </CollapsibleSection>

      {/* 15. Replay the model against everything we hold */}
      <SectionCard
        title="Replay"
        badge={{ tone: "advanced", label: "Advanced" }}
        blurb="Run the price model against every settled auction in the database and see how often its recommended bid would have won. Reads only: nothing is written, nothing is synced, and no reader sees anything change."
      >
        <p className="rounded-card border border-line bg-base/40 p-3 text-xs leading-relaxed text-ink-muted">
          Historical rosters are not stored, so the replay cannot apply the
          worth cap and does not know what the bidder had left to spend. The win
          shares below are an upper bound on the real ones. Read them as a
          direction, not a score. The targets are reported and never enforced:
          the good-value goal should win 55 to 75 percent, the make-sure goal 85
          to 95 percent, and the median overpay should sit under 2 percent of
          budget.
        </p>

        <button
          type="button"
          onClick={runReplay}
          disabled={isReplaying}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {isReplaying ? "Replaying..." : "Run replay"}
        </button>
        <p aria-live="polite" className="mt-2 text-sm text-ink-muted">
          {isReplaying
            ? "Replaying every settled auction we hold. This can take a minute."
            : replayMessage}
        </p>

        {replay && (
          <>
            <ReplayTable summary={replay} />
            {(replay.valueAtBudgetCap > 0 || replay.sureAtBudgetCap > 0) && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
                The target was out of reach at the whole budget on{" "}
                {replay.valueAtBudgetCap} good-value bids and{" "}
                {replay.sureAtBudgetCap} make-sure bids.
              </p>
            )}
          </>
        )}
      </SectionCard>

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
