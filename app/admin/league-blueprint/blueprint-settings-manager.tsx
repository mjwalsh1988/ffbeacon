"use client";

/**
 * Team Blueprint tuning form. Every threshold and weight the Blueprint reads
 * (plan section 13.1), grouped by what it changes. Saving rebuilds nothing;
 * the version field is the rebuild switch and says so.
 */

import { useState, useTransition } from "react";
import {
  DEFAULT_LEAGUE_BLUEPRINT_SETTINGS,
  type LeagueBlueprintSettings,
} from "@/lib/league-blueprint/default-settings";
import {
  NumberField,
  SettingsSaveBar,
  SettingsSection,
  settingsInputCls,
} from "@/components/admin/settings-form-kit";
import { saveLeagueBlueprintSettingsAction } from "./actions";

type S = LeagueBlueprintSettings;

export function BlueprintSettingsManager({ initialSettings }: { initialSettings: S }) {
  const [settings, setSettings] = useState<S>(initialSettings);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();

  const patch = <K extends keyof S>(key: K, value: Partial<S[K]>) =>
    setSettings((s) => ({ ...s, [key]: { ...(s[key] as object), ...value } }));
  const patchOverall = (value: Partial<S["grades"]["overall"]>) =>
    setSettings((s) => ({
      ...s,
      grades: { ...s.grades, overall: { ...s.grades.overall, ...value } },
    }));
  const patchCutoff = (value: Partial<S["calls"]["ageCutoff"]>) =>
    setSettings((s) => ({
      ...s,
      calls: { ...s.calls, ageCutoff: { ...s.calls.ageCutoff, ...value } },
    }));

  const activityTotal =
    settings.activity.sellWeight + settings.activity.needWeight + settings.activity.divergenceWeight;

  const save = () => {
    setStatus("");
    startTransition(async () => {
      const result = await saveLeagueBlueprintSettingsAction(settings);
      setStatus(
        result.ok
          ? "Saved. Blueprints rebuild on their next view once their cache lapses, or at once if you changed the version."
          : `Could not save. ${result.error}`,
      );
    });
  };

  return (
    <div className="mt-6 space-y-5">
      <SettingsSection
        title="Rebuilds and cache"
        description="The version is part of every stored blueprint's fingerprint. Bump it to rebuild every blueprint on its next view; saving anything else here rebuilds nothing on its own."
      >
        <NumberField
          label="Version"
          value={settings.version}
          onChange={(v) => setSettings((s) => ({ ...s, version: Math.trunc(v) }))}
          hint="Raise by one to force every blueprint to rebuild on its next view."
          step="1"
          min={1}
        />
        <NumberField
          label="Cache lifetime, hours"
          value={settings.cache.ttlHours}
          onChange={(v) => patch("cache", { ttlHours: v })}
          hint="A stored blueprint older than this rebuilds on its next view even when nothing changed."
          min={1}
          max={168}
        />
      </SettingsSection>

      <SettingsSection
        title="Grades"
        description="A positional grade blends the league rank in value with the league rank in projected points. The overall grade is a weighted mean of the six grades; the superflex quarterback weight replaces the normal one in superflex leagues."
      >
        <NumberField
          label="Value weight"
          value={settings.grades.valueWeight}
          onChange={(v) => patch("grades", { valueWeight: v })}
          hint="0 to 1. Value weight and points weight should sum to 1."
          min={0}
          max={1}
        />
        <NumberField
          label="Projected points weight"
          value={settings.grades.pointsWeight}
          onChange={(v) => patch("grades", { pointsWeight: v })}
          hint="0 to 1. Used only when the league's Power Pulse has run."
          min={0}
          max={1}
        />
        <NumberField label="Overall: QB" value={settings.grades.overall.qb} onChange={(v) => patchOverall({ qb: v })} min={0} />
        <NumberField
          label="Overall: QB in superflex"
          value={settings.grades.overall.qbSuperflex}
          onChange={(v) => patchOverall({ qbSuperflex: v })}
          min={0}
        />
        <NumberField label="Overall: RB" value={settings.grades.overall.rb} onChange={(v) => patchOverall({ rb: v })} min={0} />
        <NumberField label="Overall: WR" value={settings.grades.overall.wr} onChange={(v) => patchOverall({ wr: v })} min={0} />
        <NumberField label="Overall: TE" value={settings.grades.overall.te} onChange={(v) => patchOverall({ te: v })} min={0} />
        <NumberField
          label="Overall: bench"
          value={settings.grades.overall.bench}
          onChange={(v) => patchOverall({ bench: v })}
          min={0}
        />
        <NumberField
          label="Overall: draft capital"
          value={settings.grades.overall.picks}
          onChange={(v) => patchOverall({ picks: v })}
          hint="Dynasty and keeper only; redraft leagues weight picks at 0."
          min={0}
        />
      </SettingsSection>

      <SettingsSection
        title="Archetypes and outlook"
        description="Starter share is starter value over starter plus bench value. Age gap is the league's value-weighted mean age minus this roster's, so a positive gap means younger than the league."
      >
        <NumberField
          label="Top heavy at starter share"
          value={settings.archetype.topHeavyShare}
          onChange={(v) => patch("archetype", { topHeavyShare: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Deep at starter share"
          value={settings.archetype.deepShare}
          onChange={(v) => patch("archetype", { deepShare: v })}
          hint="Must be below the top heavy share."
          min={0}
          max={1}
        />
        <NumberField
          label="Reload: minimum age gap"
          value={settings.archetype.reloadAgeGap}
          onChange={(v) => patch("archetype", { reloadAgeGap: v })}
        />
        <NumberField
          label="Reload: minimum picks grade"
          value={settings.archetype.reloadPicksGrade}
          onChange={(v) => patch("archetype", { reloadPicksGrade: Math.trunc(v) })}
          step="1"
          min={1}
          max={10}
        />
        <NumberField
          label="Contend next year: minimum age gap"
          value={settings.archetype.contendHoldAgeGap}
          onChange={(v) => patch("archetype", { contendHoldAgeGap: v })}
        />
        <NumberField
          label="Rebuild to reload: young core share"
          value={settings.archetype.rebuildYoungShare}
          onChange={(v) => patch("archetype", { rebuildYoungShare: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Rebuild to reload: minimum picks grade"
          value={settings.archetype.rebuildPicksGrade}
          onChange={(v) => patch("archetype", { rebuildPicksGrade: Math.trunc(v) })}
          step="1"
          min={1}
          max={10}
        />
        <NumberField
          label="Young core: age at or under"
          value={settings.archetype.youngAge}
          onChange={(v) => patch("archetype", { youngAge: v })}
          min={20}
          max={35}
        />
      </SettingsSection>

      <SettingsSection
        title="Buy, sell and hold calls"
        description="A rebuilding roster sells a priced player at or above his position's cutoff age. A position is a need when the lineup is at least the minimum points a week short there. Buy targets sit inside a value window around the reader's best surplus player."
      >
        <NumberField label="Sell age: QB" value={settings.calls.ageCutoff.QB} onChange={(v) => patchCutoff({ QB: v })} min={20} max={45} />
        <NumberField label="Sell age: RB" value={settings.calls.ageCutoff.RB} onChange={(v) => patchCutoff({ RB: v })} min={20} max={45} />
        <NumberField label="Sell age: WR" value={settings.calls.ageCutoff.WR} onChange={(v) => patchCutoff({ WR: v })} min={20} max={45} />
        <NumberField label="Sell age: TE" value={settings.calls.ageCutoff.TE} onChange={(v) => patchCutoff({ TE: v })} min={20} max={45} />
        <NumberField
          label="Need: minimum points a week"
          value={settings.calls.needMinPoints}
          onChange={(v) => patch("calls", { needMinPoints: v })}
          min={0}
        />
        <NumberField
          label="Target value window: low"
          value={settings.calls.targetValueLow}
          onChange={(v) => patch("calls", { targetValueLow: v })}
          hint="Multiple of the best surplus value."
          min={0}
        />
        <NumberField
          label="Target value window: high"
          value={settings.calls.targetValueHigh}
          onChange={(v) => patch("calls", { targetValueHigh: v })}
          min={0}
        />
        <NumberField
          label="Targets per position"
          value={settings.calls.targetsPerPosition}
          onChange={(v) => patch("calls", { targetsPerPosition: Math.trunc(v) })}
          step="1"
          min={1}
          max={5}
        />
        <NumberField
          label="Most positions of need"
          value={settings.calls.maxNeedPositions}
          onChange={(v) => patch("calls", { maxNeedPositions: Math.trunc(v) })}
          step="1"
          min={1}
          max={4}
        />
      </SettingsSection>

      <SettingsSection
        title="Trade activity gauge"
        description={`The gauge is 100 times the weighted sum of the share of players worth selling, the share of positions of need and the gap between value rank and Power Pulse rank. The three weights must sum to 1; they sum to ${activityTotal.toFixed(3)} now.`}
      >
        <NumberField
          label="Sell share weight"
          value={settings.activity.sellWeight}
          onChange={(v) => patch("activity", { sellWeight: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Need share weight"
          value={settings.activity.needWeight}
          onChange={(v) => patch("activity", { needWeight: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Rank gap weight"
          value={settings.activity.divergenceWeight}
          onChange={(v) => patch("activity", { divergenceWeight: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Low below"
          value={settings.activity.lowBelow}
          onChange={(v) => patch("activity", { lowBelow: Math.trunc(v) })}
          step="1"
          min={0}
          max={100}
        />
        <NumberField
          label="High above"
          value={settings.activity.highAbove}
          onChange={(v) => patch("activity", { highAbove: Math.trunc(v) })}
          step="1"
          min={0}
          max={100}
        />
      </SettingsSection>

      <SettingsSection
        title="Movers, trade shapes, partners, priorities"
        description="How many risers and fallers to list and how many of a roster's players must pass the 30-day gate before the 7-day window is used instead; how many trade finder runs one build may make; how trade partners are scored."
      >
        <div>
          <label htmlFor="bp-movers-window" className="block text-xs font-medium text-ink-subtle">
            Movers window
          </label>
          <select
            id="bp-movers-window"
            value={settings.movers.window}
            onChange={(e) => patch("movers", { window: e.target.value as "7d" | "30d" })}
            className={settingsInputCls}
          >
            <option value="30d">30 days</option>
            <option value="7d">7 days</option>
          </select>
        </div>
        <NumberField
          label="Movers listed each way"
          value={settings.movers.limit}
          onChange={(v) => patch("movers", { limit: Math.trunc(v) })}
          step="1"
          min={1}
          max={10}
        />
        <NumberField
          label="Players needed for the 30-day window"
          value={settings.movers.minGated}
          onChange={(v) => patch("movers", { minGated: Math.trunc(v) })}
          step="1"
          min={0}
          max={30}
        />
        <NumberField
          label="Trade finder runs per build"
          value={settings.strategy.maxRuns}
          onChange={(v) => patch("strategy", { maxRuns: Math.trunc(v) })}
          step="1"
          min={1}
          max={3}
        />
        <NumberField
          label="Pivot: largest value gap"
          value={settings.strategy.pivotGapPct}
          onChange={(v) => patch("strategy", { pivotGapPct: v })}
          hint="Share of the outgoing player's value."
          min={0}
          max={1}
        />
        <NumberField
          label="Partners: their surplus fits my need"
          value={settings.partners.needWeight}
          onChange={(v) => patch("partners", { needWeight: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Partners: my surplus fits their need"
          value={settings.partners.giveWeight}
          onChange={(v) => patch("partners", { giveWeight: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Partners: opposite direction"
          value={settings.partners.directionWeight}
          onChange={(v) => patch("partners", { directionWeight: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Partners: trade tendency"
          value={settings.partners.tendencyWeight}
          onChange={(v) => patch("partners", { tendencyWeight: v })}
          min={0}
          max={1}
        />
        <NumberField
          label="Partners named"
          value={settings.partners.count}
          onChange={(v) => patch("partners", { count: Math.trunc(v) })}
          step="1"
          min={1}
          max={5}
        />
        <NumberField
          label="Priorities listed"
          value={settings.priorities.count}
          onChange={(v) => patch("priorities", { count: Math.trunc(v) })}
          step="1"
          min={1}
          max={5}
        />
      </SettingsSection>

      <SettingsSaveBar
        onSave={save}
        onReset={() => {
          setSettings(DEFAULT_LEAGUE_BLUEPRINT_SETTINGS);
          setStatus("Reset to code defaults. Not saved yet.");
        }}
        pending={pending}
        status={status}
        saveLabel="Save settings"
      />
    </div>
  );
}
