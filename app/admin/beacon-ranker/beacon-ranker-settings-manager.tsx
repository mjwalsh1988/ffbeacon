"use client";

/**
 * Beacon Ranker settings form.
 *
 * Every threshold the builder and the community build read is editable here,
 * grouped by what it does, and each group states the consequence of changing
 * it. Every input has a real label tied by id, every hint is linked with
 * aria-describedby, every group is a fieldset with a legend, and the save
 * result is announced through a polite live region. No field is hidden at any
 * breakpoint.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import {
  DEFAULT_RANKING_BUILDER_SETTINGS,
  RANKING_BUILDER_SETTING_BOUNDS as B,
  type RankingBuilderSettings,
} from "@/lib/ranking-boards/default-settings";
import { saveBeaconRankerSettingsAction } from "./actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function Field({
  label,
  value,
  onChange,
  hint,
  step = "1",
  bound,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint: string;
  step?: string;
  bound: { min: number; max: number };
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={bound.min}
        max={bound.max}
        value={text}
        aria-describedby={hintId}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = Number(text);
          if (Number.isFinite(n)) onChange(step === "1" ? Math.trunc(n) : n);
          else setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) {
            onChange(step === "1" ? Math.trunc(n) : n);
          }
        }}
        className={inputCls}
      />
      <p id={hintId} className="mt-1 text-[11px] leading-tight text-ink-subtle">
        {hint} Allowed {bound.min} to {bound.max}.
      </p>
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

export function BeaconRankerSettingsManager({
  initialSettings,
}: {
  initialSettings: RankingBuilderSettings;
}) {
  const [settings, setSettings] = useState<RankingBuilderSettings>(initialSettings);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const sourceHintId = useId();

  const patch = <K extends keyof RankingBuilderSettings>(
    key: K,
    value: Partial<RankingBuilderSettings[K]>,
  ) => {
    setSettings((s) => ({ ...s, [key]: { ...s[key], ...value } }));
  };

  const save = () => {
    setStatus("");
    startTransition(async () => {
      const result = await saveBeaconRankerSettingsAction(settings);
      setStatus(
        result.ok
          ? "Saved. New runs and the next nightly community build use these values. Runs already in progress keep the depth and cap they started with."
          : `Could not save. ${result.error}`,
      );
    });
  };

  const s = settings;
  return (
    <div className="mt-6 space-y-5">
      <Group
        title="The builder"
        description="How a run asks its questions and how deep it goes by default."
      >
        <Field
          label="Straight wins before the prompt"
          value={s.builder.winsBeforePrompt}
          onChange={(v) => patch("builder", { winsBeforePrompt: v })}
          hint="After this many wins in a row the reader is asked to place the player at a rank or keep comparing."
          bound={B.builder.winsBeforePrompt}
        />
        <Field
          label="Default depth, several positions"
          value={s.builder.defaultDepthMulti}
          onChange={(v) => patch("builder", { defaultDepthMulti: v })}
          hint="Starting depth for an overall or all-defenders board. A signed-in reader can raise it."
          bound={B.builder.defaultDepthMulti}
        />
        <Field
          label="Default depth, one position"
          value={s.builder.defaultDepthSingle}
          onChange={(v) => patch("builder", { defaultDepthSingle: v })}
          hint="Starting depth for a one-position board."
          bound={B.builder.defaultDepthSingle}
        />
        <Field
          label="Keep going adds"
          value={s.builder.keepGoingStep}
          onChange={(v) => patch("builder", { keepGoingStep: v })}
          hint="Players added each time a reader presses Keep going at the end of a run."
          bound={B.builder.keepGoingStep}
        />
        <Field
          label="Maximum depth"
          value={s.builder.maxDepth}
          onChange={(v) => patch("builder", { maxDepth: v })}
          hint="The deepest one run may aim for."
          bound={B.builder.maxDepth}
        />
        <Field
          label="Defenders in the second pass"
          value={s.builder.defenderSecondPass}
          onChange={(v) => patch("builder", { defenderSecondPass: v })}
          hint="How many defenders join an overall board with defenders switched on, after the offensive run."
          bound={B.builder.defenderSecondPass}
        />
        <Field
          label="Checkpoint every"
          value={s.builder.checkpointEvery}
          onChange={(v) => patch("builder", { checkpointEvery: v })}
          hint="Answers between board saves during a run. A crash loses at most this many; a resume rebuilds them."
          bound={B.builder.checkpointEvery}
        />
      </Group>

      <Group
        title="Guests"
        description="What a signed-out reader can do. The page states the retention time, so changing it changes the copy."
      >
        <Field
          label="Guest cap, several positions"
          value={s.guests.capMulti}
          onChange={(v) => patch("guests", { capMulti: v })}
          hint="Most players a guest can rank on an overall, all offense or all defense board."
          bound={B.guests.capMulti}
        />
        <Field
          label="Guest cap, one position"
          value={s.guests.capSingle}
          onChange={(v) => patch("guests", { capSingle: v })}
          hint="Most players a guest can rank on a one-position board."
          bound={B.guests.capSingle}
        />
        <Field
          label="Guest board lifetime, hours"
          value={s.guests.retentionHours}
          onChange={(v) => patch("guests", { retentionHours: v })}
          hint="A guest board is deleted this long after its last change."
          bound={B.guests.retentionHours}
        />
      </Group>

      <Group
        title="Rate limits"
        description="Per reader: the user id when signed in, a salted hash of the address when not."
      >
        <Field
          label="Seed lists per hour"
          value={s.limits.seedLoadsPerHour}
          onChange={(v) => patch("limits", { seedLoadsPerHour: v })}
          hint="Starting a run loads a seed list of up to a thousand players."
          bound={B.limits.seedLoadsPerHour}
        />
        <Field
          label="Answers per minute"
          value={s.limits.answersPerMinute}
          onChange={(v) => patch("limits", { answersPerMinute: v })}
          hint="A fast reader answers about one a second."
          bound={B.limits.answersPerMinute}
        />
      </Group>

      <Group
        title="Community rankings"
        description="Which boards count, when a format publishes, and how the merge weighs what each board says."
      >
        <Field
          label="Players for a multi-position board to count"
          value={s.community.minPlayersMulti}
          onChange={(v) => patch("community", { minPlayersMulti: v })}
          hint="An overall, all offense or all defense board counts once it ranks this many."
          bound={B.community.minPlayersMulti}
        />
        <Field
          label="Players for a one-position board to count"
          value={s.community.minPlayersSingle}
          onChange={(v) => patch("community", { minPlayersSingle: v })}
          hint="A one-position board counts once it ranks this many."
          bound={B.community.minPlayersSingle}
        />
        <Field
          label="Boards before a player is listed"
          value={s.community.minBoardsPerPlayer}
          onChange={(v) => patch("community", { minBoardsPerPlayer: v })}
          hint="A player appears once this many counted boards rank him."
          bound={B.community.minBoardsPerPlayer}
        />
        <Field
          label="Boards before a format publishes"
          value={s.community.minBoardsToPublish}
          onChange={(v) => patch("community", { minBoardsToPublish: v })}
          hint="Below this, the format's page says how many more are needed and is not indexed."
          bound={B.community.minBoardsToPublish}
        />
        <Field
          label="Pool margin"
          value={s.community.poolMargin}
          onChange={(v) => patch("community", { poolMargin: v })}
          hint="How far past its depth a board speaks about unranked players, as a share of its depth. 1 means a 50 player board speaks about seed ranks 51 to 100."
          step="0.05"
          bound={B.community.poolMargin}
        />
        <Field
          label="Within-board share"
          value={s.community.withinBoardShare}
          onChange={(v) => patch("community", { withinBoardShare: v })}
          hint="Share of each board's weight on the comparisons the reader actually made; the rest is on the pool."
          step="0.05"
          bound={B.community.withinBoardShare}
        />
        <Field
          label="Shrinkage"
          value={s.community.shrinkage}
          onChange={(v) => patch("community", { shrinkage: v })}
          hint="Pull toward the middle, in comparisons against an average player. Higher is more cautious about thinly ranked players."
          step="0.1"
          bound={B.community.shrinkage}
        />
        <Field
          label="Agreement window, spots"
          value={s.community.agreementWindow}
          onChange={(v) => patch("community", { agreementWindow: v })}
          hint="Agreement with FF Beacon means within this many spots."
          bound={B.community.agreementWindow}
        />
        <div>
          <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium text-ink-muted">
            <input
              type="checkbox"
              checked={s.community.sourceEnabled}
              disabled
              aria-describedby={sourceHintId}
              className="h-5 w-5 shrink-0 rounded border-line bg-base"
            />
            Offer community rankings as a data source (sourceEnabled)
          </label>
          <p id={sourceHintId} className="mt-1 text-[11px] leading-tight text-ink-subtle">
            Off at launch and cannot be turned on yet: the source half is a separate build (a
            registry row, supported formats, the rankings copy and the pairwise audit). The
            nightly build already writes rows shaped for it.
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
            setSettings(DEFAULT_RANKING_BUILDER_SETTINGS);
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
