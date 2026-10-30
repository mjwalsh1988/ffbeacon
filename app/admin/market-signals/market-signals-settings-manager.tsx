"use client";

/**
 * Market Signals engine form and the one-partition Run now control.
 * Bounds match lib/market-signals/settings.ts (plan section 13.2).
 */

import { useState, useTransition } from "react";
import {
  DEFAULT_MARKET_SIGNAL_SETTINGS,
  type MarketSignalSettings,
} from "@/lib/market-signals/default-settings";
import {
  CheckboxField,
  NumberField,
  SettingsSaveBar,
  SettingsSection,
  settingsInputCls,
} from "@/components/admin/settings-form-kit";
import { runPartitionNowAction, saveMarketSignalSettingsAction } from "./actions";

type S = MarketSignalSettings;

export function MarketSignalsSettingsManager({
  initialSettings,
  partitions,
}: {
  initialSettings: S;
  partitions: Array<{ key: string; label: string }>;
}) {
  const [settings, setSettings] = useState<S>(initialSettings);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const [runKey, setRunKey] = useState(partitions[0]?.key ?? "");
  const [runStatus, setRunStatus] = useState("");
  const [running, startRun] = useTransition();

  const set = (value: Partial<S>) => setSettings((s) => ({ ...s, ...value }));

  const save = () => {
    setStatus("");
    startTransition(async () => {
      const result = await saveMarketSignalSettingsAction(settings);
      setStatus(result.ok ? "Saved. The next run uses these settings." : `Could not save. ${result.error}`);
    });
  };

  const runNow = () => {
    setRunStatus("Running...");
    startRun(async () => {
      const result = await runPartitionNowAction(runKey);
      setRunStatus(result.ok ? (result.message ?? "Done.") : `Could not run. ${result.error}`);
    });
  };

  return (
    <div className="mt-6 space-y-5">
      <SettingsSection
        title="Band"
        description="Changing the window or the multiplier changes every signal on the next run, because every band is rebuilt from the history."
      >
        <NumberField
          label="Window, days"
          value={settings.windowDays}
          onChange={(v) => set({ windowDays: Math.trunc(v) })}
          hint="10 to 90. Changes every row on the next run."
          step="1"
          min={10}
          max={90}
        />
        <NumberField
          label="Band multiplier (k)"
          value={settings.k}
          onChange={(v) => set({ k: v })}
          hint="1 to 3 standard deviations. Changes every row on the next run."
          min={1}
          max={3}
        />
        <NumberField
          label="Days required for a call"
          value={settings.minPoints}
          onChange={(v) => set({ minPoints: Math.trunc(v) })}
          hint="At least 5 and no more than the window. Below it a player reads Building baseline."
          step="1"
          min={5}
        />
        <NumberField
          label="History read, days"
          value={settings.lookbackDays}
          onChange={(v) => set({ lookbackDays: Math.trunc(v) })}
          hint="At least the window; the extra days cover gaps."
          step="1"
          min={10}
        />
      </SettingsSection>

      <SettingsSection
        title="Calls"
        description="The watch zone is how close to a band edge counts as near a buy or sell window. Hold back is how far back inside the band a value must fall before a buy or sell clears, which stops a call flipping daily at the edge."
      >
        <NumberField
          label="Watch zone"
          value={settings.watchPct}
          onChange={(v) => set({ watchPct: v })}
          hint="0 to 0.2 of the band width."
          min={0}
          max={0.2}
        />
        <NumberField
          label="Hold back"
          value={settings.holdBackPct}
          onChange={(v) => set({ holdBackPct: v })}
          hint="0 to 0.3 of the band width."
          min={0}
          max={0.3}
        />
        <NumberField
          label="Thin market floor"
          value={settings.floorPct}
          onChange={(v) => set({ floorPct: v })}
          hint="0 to 0.2 of the top value in the format and source. Below it a player reads Thin market."
          min={0}
          max={0.2}
        />
        <NumberField
          label="Stale after, days"
          value={settings.staleDays}
          onChange={(v) => set({ staleDays: Math.trunc(v) })}
          hint="1 to 7. A player with no value this recent keeps yesterday's row."
          step="1"
          min={1}
          max={7}
        />
        <NumberField
          label="Model version"
          value={settings.modelVersion}
          onChange={(v) => set({ modelVersion: Math.trunc(v) })}
          hint="Stored on every row; raise it when the method changes."
          step="1"
          min={1}
        />
        <CheckboxField
          label="Engine on"
          checked={settings.enabled}
          onChange={(v) => set({ enabled: v })}
          hint="Off, the nightly runs record a run and write nothing."
        />
      </SettingsSection>

      <SettingsSaveBar
        onSave={save}
        onReset={() => {
          setSettings(DEFAULT_MARKET_SIGNAL_SETTINGS);
          setStatus("Reset to code defaults. Not saved yet.");
        }}
        pending={pending}
        status={status}
        saveLabel="Save settings"
      />

      <section className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Run one partition now</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Runs the nightly computation for one source and format with the saved settings. It
          takes about 5 to 15 seconds.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <label htmlFor="ms-run-partition" className="block text-xs font-medium text-ink-subtle">
              Partition
            </label>
            <select
              id="ms-run-partition"
              value={runKey}
              onChange={(e) => setRunKey(e.target.value)}
              className={settingsInputCls}
            >
              {partitions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={runNow}
            disabled={running || !runKey}
            className="inline-flex min-h-11 items-center rounded-card border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
          >
            {running ? "Running..." : "Run now"}
          </button>
          <p role="status" aria-live="polite" className="text-sm text-ink-muted">
            {runStatus}
          </p>
        </div>
      </section>
    </div>
  );
}
