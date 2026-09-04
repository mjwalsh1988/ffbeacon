"use client";

/**
 * Manager Pulse settings form.
 *
 * Every limit, cooldown and sample floor the engine reads is editable here so
 * it can be adjusted without a deploy. Grouped by what the setting actually
 * does rather than by the shape of the JSON, and each group states the
 * consequence of changing it.
 *
 * Accessibility: every input has a real label tied by id, every hint is linked
 * with aria-describedby, the save result is announced through a polite live
 * region, and the reset control is a button rather than a link so it never
 * navigates. Every group is a fieldset with a legend. No field is hidden at
 * any breakpoint.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import type { ManagerPulseSettings } from "@/lib/manager-pulse/default-settings";
import {
  DEFAULT_MANAGER_PULSE_SETTINGS,
  MANAGER_PULSE_SETTING_BOUNDS,
} from "@/lib/manager-pulse/default-settings";
import { saveManagerPulseSettingsAction } from "./actions";

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

function Checkbox({
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
  // The box itself stays 20px because a 44px checkbox looks wrong next to
  // 20px ones elsewhere, so the LABEL carries the target instead: it wraps the
  // whole row, is min-h-11, and a native label click toggles the input. That
  // gives a full-width 44px tall hit area.
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

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold tracking-tight text-ink">{title}</legend>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function ManagerPulseSettingsManager({
  initialSettings,
}: {
  initialSettings: ManagerPulseSettings;
}) {
  const [settings, setSettings] = useState<ManagerPulseSettings>(initialSettings);
  const [status, setStatus] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const patch = <K extends Exclude<keyof ManagerPulseSettings, "modelVersion">>(
    key: K,
    value: Partial<ManagerPulseSettings[K]>,
  ) => {
    setSettings((s) => ({ ...s, [key]: { ...(s[key] as object), ...value } }));
  };

  const save = () => {
    setStatus("");
    startTransition(async () => {
      const result = await saveManagerPulseSettingsAction(settings);
      setStatus(
        result.ok
          ? "Saved. Reports and tendency rows rebuild on their next view once the cache goes stale."
          : `Could not save. ${result.error}`,
      );
    });
  };

  return (
    <div className="mt-6 space-y-5">
      <Group
        title="Capture"
        description="How far back we look and how much work one lookup may queue."
      >
        <Field
          label="Default season window"
          value={settings.capture.seasonWindowDefault}
          onChange={(v) => patch("capture", { seasonWindowDefault: Math.trunc(v) })}
          hint="How many past seasons a report covers when the reader does not choose."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.seasonWindowDefault.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.seasonWindowDefault.max}
        />
        <Field
          label="Maximum season window"
          value={settings.capture.seasonWindowMax}
          onChange={(v) => patch("capture", { seasonWindowMax: Math.trunc(v) })}
          hint="The most seasons a reader may ask for."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.seasonWindowMax.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.seasonWindowMax.max}
        />
        <Field
          label="Minimum season window"
          value={settings.capture.seasonWindowMin}
          onChange={(v) => patch("capture", { seasonWindowMin: Math.trunc(v) })}
          hint="The fewest seasons a reader may ask for."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.seasonWindowMin.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.seasonWindowMin.max}
        />
        <Field
          label="Max leagues per run"
          value={settings.capture.maxLeaguesPerRun}
          onChange={(v) => patch("capture", { maxLeaguesPerRun: Math.trunc(v) })}
          hint="League-seasons one run may queue."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.maxLeaguesPerRun.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.maxLeaguesPerRun.max}
        />
        <Field
          label="Max leagues per season"
          value={settings.capture.maxLeaguesPerSeason}
          onChange={(v) => patch("capture", { maxLeaguesPerSeason: Math.trunc(v) })}
          hint="Caps a handle in many leagues from queuing all of them for one season."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.maxLeaguesPerSeason.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.maxLeaguesPerSeason.max}
        />
        <Field
          label="Run cooldown, seconds"
          value={settings.capture.runCooldownSeconds}
          onChange={(v) => patch("capture", { runCooldownSeconds: Math.trunc(v) })}
          hint="Seconds one user must wait between runs."
          step="60"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.runCooldownSeconds.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.runCooldownSeconds.max}
        />
        <Field
          label="Report TTL, hours"
          value={settings.capture.reportTtlHours}
          onChange={(v) => patch("capture", { reportTtlHours: Math.trunc(v) })}
          hint="Hours a computed report stays fresh before it rebuilds."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.reportTtlHours.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.reportTtlHours.max}
        />
        <Field
          label="Tendency TTL, hours"
          value={settings.capture.tendencyTtlHours}
          onChange={(v) => patch("capture", { tendencyTtlHours: Math.trunc(v) })}
          hint="Hours a tendency row stays fresh before it rebuilds."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.tendencyTtlHours.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.tendencyTtlHours.max}
        />
        <Field
          label="Capture TTL, minutes"
          value={settings.capture.captureTtlMinutes}
          onChange={(v) => patch("capture", { captureTtlMinutes: Math.trunc(v) })}
          hint="Minutes before the footprint sync fetches from Sleeper again."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.captureTtlMinutes.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.captureTtlMinutes.max}
        />
        <Field
          label="Job max attempts"
          value={settings.capture.jobMaxAttempts}
          onChange={(v) => patch("capture", { jobMaxAttempts: Math.trunc(v) })}
          hint="How many times a failed capture job retries before it gives up. Governs both Manager Pulse footprint jobs and Sync all bulk-sync jobs, since they share one queue."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.capture.jobMaxAttempts.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.capture.jobMaxAttempts.max}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <Checkbox
            label="Include best ball leagues"
            checked={settings.capture.includeBestBall}
            onChange={(v) => patch("capture", { includeBestBall: v })}
            hint="Off leaves best ball leagues out of the report entirely."
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Checkbox
            label="Admins skip the cooldown and the lookup limit"
            checked={settings.capture.adminBypassThrottle}
            onChange={(v) => patch("capture", { adminBypassThrottle: v })}
            hint="On lets an admin look up as many managers as they like, as often as they like, which is what makes the tool testable. It skips throttling only: no extra data, no larger league cap, and no change to what a report says. Turn it off to feel exactly what a reader feels."
          />
        </div>
      </Group>

      <Group
        title="Lookup"
        description="How often one user may look up a Sleeper handle."
      >
        <Field
          label="Handle lookups per minute"
          value={settings.lookup.handleLookupPerMinute}
          onChange={(v) => patch("lookup", { handleLookupPerMinute: Math.trunc(v) })}
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.lookup.handleLookupPerMinute.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.lookup.handleLookupPerMinute.max}
        />
        <Field
          label="Handle lookups per day"
          value={settings.lookup.handleLookupPerDay}
          onChange={(v) => patch("lookup", { handleLookupPerDay: Math.trunc(v) })}
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.lookup.handleLookupPerDay.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.lookup.handleLookupPerDay.max}
        />
      </Group>

      <Group
        title="Samples"
        description="How much evidence a claim needs before the report will make it. Raise these to say less and be surer."
      >
        <Field
          label="Trades for average margin"
          value={settings.samples.minTradesForMargin}
          onChange={(v) => patch("samples", { minTradesForMargin: Math.trunc(v) })}
          hint="Trades needed before an average trade margin is shown."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minTradesForMargin.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minTradesForMargin.max}
        />
        <Field
          label="Trades for position lean"
          value={settings.samples.minTradesForPositionLean}
          onChange={(v) => patch("samples", { minTradesForPositionLean: Math.trunc(v) })}
          hint="Trades needed before a position lean is shown."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minTradesForPositionLean.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minTradesForPositionLean.max}
        />
        <Field
          label="Trades for age lean"
          value={settings.samples.minTradesForAgeLean}
          onChange={(v) => patch("samples", { minTradesForAgeLean: Math.trunc(v) })}
          hint="Trades needed before an age lean is shown."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minTradesForAgeLean.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minTradesForAgeLean.max}
        />
        <Field
          label="Overpay sample"
          value={settings.samples.minOverpaySample}
          onChange={(v) => patch("samples", { minOverpaySample: Math.trunc(v) })}
          hint="Times a manager paid up before we call it a habit."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minOverpaySample.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minOverpaySample.max}
        />
        <Field
          label="Drafts for reach"
          value={settings.samples.minDraftsForReach}
          onChange={(v) => patch("samples", { minDraftsForReach: Math.trunc(v) })}
          hint="Drafts needed before a reach tendency is shown."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minDraftsForReach.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minDraftsForReach.max}
        />
        <Field
          label="Avoid seasons"
          value={settings.samples.minAvoidSeasons}
          onChange={(v) => patch("samples", { minAvoidSeasons: Math.trunc(v) })}
          hint="Seasons a player was available before an avoid is counted."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minAvoidSeasons.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minAvoidSeasons.max}
        />
        <Field
          label="Avoid roster rate floor"
          value={settings.samples.minAvoidRosterRate}
          onChange={(v) => patch("samples", { minAvoidRosterRate: v })}
          hint="How commonly a player must be rostered league-wide before his absence counts as an avoid, rather than a replacement-level player nobody chases."
          step="0.05"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minAvoidRosterRate.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minAvoidRosterRate.max}
        />
        <Field
          label="Seasons for any tendency"
          value={settings.samples.minSeasonsForTendency}
          onChange={(v) => patch("samples", { minSeasonsForTendency: Math.trunc(v) })}
          hint="Seasons of history needed before any tendency is shown at all."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minSeasonsForTendency.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minSeasonsForTendency.max}
        />
        <Field
          label="League-seasons for a rate"
          value={settings.samples.minLeagueSeasonsForRate}
          onChange={(v) => patch("samples", { minLeagueSeasonsForRate: Math.trunc(v) })}
          hint="Below this, a win rate shows as a raw count instead of a percentage."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.samples.minLeagueSeasonsForRate.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.samples.minLeagueSeasonsForRate.max}
        />
      </Group>

      <Group
        title="Draft"
        description="What counts as a reach and an early pick. There is no poll-gap setting here: per-pick timing is measured, not configured, off the live draft clock capture."
      >
        <Field
          label="Reach threshold, rounds"
          value={settings.draft.reachRoundsThreshold}
          onChange={(v) => patch("draft", { reachRoundsThreshold: v })}
          hint="Rounds early a pick must be before it counts as a reach. Below this, the reach index reports null rather than a number too small to mean anything."
          step="0.05"
          min={MANAGER_PULSE_SETTING_BOUNDS.draft.reachRoundsThreshold.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.draft.reachRoundsThreshold.max}
        />
        <Field
          label="Early round cutoff"
          value={settings.draft.earlyRoundCutoff}
          onChange={(v) => patch("draft", { earlyRoundCutoff: Math.trunc(v) })}
          hint="The last round that counts as an early pick for draft affinity."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.draft.earlyRoundCutoff.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.draft.earlyRoundCutoff.max}
        />
      </Group>

      <Group
        title="Display"
        description="How many rows each section shows. Changes what is rendered, not what is measured."
      >
        <Field
          label="Favourites shown"
          value={settings.display.favouritesShown}
          onChange={(v) => patch("display", { favouritesShown: Math.trunc(v) })}
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.display.favouritesShown.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.display.favouritesShown.max}
        />
        <Field
          label="Avoids shown"
          value={settings.display.avoidsShown}
          onChange={(v) => patch("display", { avoidsShown: Math.trunc(v) })}
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.display.avoidsShown.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.display.avoidsShown.max}
        />
        <Field
          label="Trades shown"
          value={settings.display.tradesShown}
          onChange={(v) => patch("display", { tradesShown: Math.trunc(v) })}
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.display.tradesShown.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.display.tradesShown.max}
        />
        <Field
          label="League rows shown"
          value={settings.display.leagueRowsShown}
          onChange={(v) => patch("display", { leagueRowsShown: Math.trunc(v) })}
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.display.leagueRowsShown.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.display.leagueRowsShown.max}
        />
        <Field
          label="Narrative sentences, max"
          value={settings.display.narrativeSentencesMax}
          onChange={(v) => patch("display", { narrativeSentencesMax: Math.trunc(v) })}
          hint="The most sentences the narrative summary may use."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.display.narrativeSentencesMax.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.display.narrativeSentencesMax.max}
        />
      </Group>

      <Group
        title="Tendency"
        description="How a tendency can shift Signal Check's acceptance bands on League Pulse Trade Ideas."
      >
        <Field
          label="Band step, max"
          value={settings.tendency.bandStepMax}
          onChange={(v) => patch("tendency", { bandStepMax: v })}
          hint="The most an acceptance band may move because of a tendency."
          step="0.1"
          min={MANAGER_PULSE_SETTING_BOUNDS.tendency.bandStepMax.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.tendency.bandStepMax.max}
        />
        <Field
          label="Low confidence, max sample"
          value={settings.tendency.confidenceLowMax}
          onChange={(v) => patch("tendency", { confidenceLowMax: Math.trunc(v) })}
          hint="A sample size at or below this counts as low confidence."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.tendency.confidenceLowMax.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.tendency.confidenceLowMax.max}
        />
        <Field
          label="Medium confidence, max sample"
          value={settings.tendency.confidenceMediumMax}
          onChange={(v) => patch("tendency", { confidenceMediumMax: Math.trunc(v) })}
          hint="A sample size at or below this counts as medium confidence. Above it counts as high."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.tendency.confidenceMediumMax.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.tendency.confidenceMediumMax.max}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <Checkbox
            label="Enabled for Trade Ideas"
            checked={settings.tendency.enabledForTradeIdeas}
            onChange={(v) => patch("tendency", { enabledForTradeIdeas: v })}
            hint="The kill switch. Off makes League Pulse Trade Ideas behave exactly as it did before this feature existed."
          />
        </div>
      </Group>

      <Group
        title="Behaviour"
        description="The thresholds behind the words we use for how a manager runs a season."
      >
        <Field
          label="Move shape, minimum moves"
          value={settings.behaviour.moveShapeMinMoves}
          onChange={(v) => patch("behaviour", { moveShapeMinMoves: Math.trunc(v) })}
          hint="Below this many moves, no shape is claimed at all."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.behaviour.moveShapeMinMoves.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.behaviour.moveShapeMinMoves.max}
        />
        <Field
          label="Front-loaded threshold"
          value={settings.behaviour.moveShapeFrontLoaded}
          onChange={(v) => patch("behaviour", { moveShapeFrontLoaded: v })}
          hint="Share of moves in the first half of the season above which we call it front-loaded."
          step="0.05"
          min={MANAGER_PULSE_SETTING_BOUNDS.behaviour.moveShapeFrontLoaded.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.behaviour.moveShapeFrontLoaded.max}
        />
        <Field
          label="Faded threshold"
          value={settings.behaviour.moveShapeFaded}
          onChange={(v) => patch("behaviour", { moveShapeFaded: v })}
          hint="Share below which we call it faded. Between the two it is steady. Must stay below the front-loaded threshold."
          step="0.05"
          min={MANAGER_PULSE_SETTING_BOUNDS.behaviour.moveShapeFaded.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.behaviour.moveShapeFaded.max}
        />
        <Field
          label="Abandonment, quiet weeks"
          value={settings.behaviour.abandonmentQuietWeeks}
          onChange={(v) => patch("behaviour", { abandonmentQuietWeeks: Math.trunc(v) })}
          hint="Consecutive quiet weeks at the end of a season before it can count as walked away from. An incomplete lineup is also required."
          step="1"
          min={MANAGER_PULSE_SETTING_BOUNDS.behaviour.abandonmentQuietWeeks.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.behaviour.abandonmentQuietWeeks.max}
        />
      </Group>

      <Group
        title="Wording"
        description="Where the line falls between one word and another. These change what we say, never what we measured."
      >
        <Field
          label="Trades a lot, per season"
          value={settings.wording.tradesOftenPerSeason}
          onChange={(v) => patch("wording", { tradesOftenPerSeason: v })}
          hint="Trades a season at or above which we say they trade a lot."
          step="0.5"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.tradesOftenPerSeason.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.tradesOftenPerSeason.max}
        />
        <Field
          label="Barely trades, per season"
          value={settings.wording.tradesRarePerSeason}
          onChange={(v) => patch("wording", { tradesRarePerSeason: v })}
          hint="Trades a season at or below which we say they barely trade. Must stay below the line above."
          step="0.1"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.tradesRarePerSeason.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.tradesRarePerSeason.max}
        />
        <Field
          label="Margin dead zone"
          value={settings.wording.marginDeadzone}
          onChange={(v) => patch("wording", { marginDeadzone: v })}
          hint="Margins smaller than this are treated as noise, so we say neither pays up nor gets value."
          step="0.01"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.marginDeadzone.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.marginDeadzone.max}
        />
        <Field
          label="Age lean dead zone"
          value={settings.wording.ageLeanDeadzone}
          onChange={(v) => patch("wording", { ageLeanDeadzone: v })}
          hint="Age leans smaller than this are treated as noise, so we call them neither a youth buyer nor a production buyer."
          step="0.01"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.ageLeanDeadzone.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.ageLeanDeadzone.max}
        />
        <Field
          label="Good lineup, efficiency"
          value={settings.wording.lineupGood}
          onChange={(v) => patch("wording", { lineupGood: v })}
          hint="Lineup efficiency at or above which we say they set a good lineup."
          step="0.01"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.lineupGood.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.lineupGood.max}
        />
        <Field
          label="Poor lineup, efficiency"
          value={settings.wording.lineupPoor}
          onChange={(v) => patch("wording", { lineupPoor: v })}
          hint="Efficiency at or below which we say they leave points on the bench. Must stay below the line above."
          step="0.01"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.lineupPoor.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.lineupPoor.max}
        />
        <Field
          label="Drafts early, rounds"
          value={settings.wording.draftEarlyRounds}
          onChange={(v) => patch("wording", { draftEarlyRounds: v })}
          hint="Rounds ahead of the market before we call it drafting early."
          step="0.1"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.draftEarlyRounds.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.draftEarlyRounds.max}
        />
        <Field
          label="Unlucky, points against"
          value={settings.wording.unluckyPointsAgainstMax}
          onChange={(v) => patch("wording", { unluckyPointsAgainstMax: v })}
          hint="Points-against rank below which the schedule counts as unkind. 0 is the worst in the league."
          step="0.05"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.unluckyPointsAgainstMax.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.unluckyPointsAgainstMax.max}
        />
        <Field
          label="Middle of the table, from"
          value={settings.wording.unluckyPointsForMin}
          onChange={(v) => patch("wording", { unluckyPointsForMin: v })}
          hint="Bottom of the points-for band that reads as middle of the table."
          step="0.05"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.unluckyPointsForMin.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.unluckyPointsForMin.max}
        />
        <Field
          label="Middle of the table, to"
          value={settings.wording.unluckyPointsForMax}
          onChange={(v) => patch("wording", { unluckyPointsForMax: v })}
          hint="Top of that band. Must stay above the line before it."
          step="0.05"
          min={MANAGER_PULSE_SETTING_BOUNDS.wording.unluckyPointsForMax.min}
          max={MANAGER_PULSE_SETTING_BOUNDS.wording.unluckyPointsForMax.max}
        />
      </Group>

      <Group
        title="Model version"
        description="A label recorded on every stored report and tendency row."
      >
        <div>
          <label htmlFor="mp-model-version" className="block text-xs font-medium text-ink-subtle">
            Model version
          </label>
          <input
            id="mp-model-version"
            type="text"
            value={settings.modelVersion}
            minLength={MANAGER_PULSE_SETTING_BOUNDS.modelVersion.minLength}
            maxLength={MANAGER_PULSE_SETTING_BOUNDS.modelVersion.maxLength}
            aria-describedby="mp-model-version-hint"
            onChange={(e) => setSettings((s) => ({ ...s, modelVersion: e.target.value }))}
            className={inputCls}
          />
          <p id="mp-model-version-hint" className="mt-1 text-[11px] leading-tight text-ink-subtle">
            Change this to force every report and tendency row to rebuild on next view. This is
            how a model change rolls out.
          </p>
        </div>
      </Group>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save settings"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSettings(DEFAULT_MANAGER_PULSE_SETTINGS);
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
