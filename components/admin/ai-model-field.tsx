"use client";

import { useId, useState, useTransition } from "react";
import { updateBeaconSetting } from "@/app/admin/beacon/actions";
import type { SettingRow } from "./setting-field";

/**
 * Model picker for the beacon_settings `ai_model` row. A dropdown of the three
 * current Anthropic tiers (each pinned to the latest version alias) plus a
 * "Custom model ID" choice that reveals a free-text input, so a future version
 * string can be entered without a code change. Whatever is chosen is saved
 * verbatim to beacon_settings and sent straight to the API in ai-adjust.ts.
 */

const MODEL_PRESETS: Array<{ value: string; label: string }> = [
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (fastest, lowest cost)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (balanced speed and quality)" },
  { value: "claude-opus-4-8", label: "Opus 4.8 (most capable, highest cost)" },
];
const CUSTOM = "__custom__";

export function AiModelField({ setting }: { setting: SettingRow }) {
  const id = useId();
  const customId = useId();
  const initial = String(setting.value ?? "").trim();
  const initialIsPreset = MODEL_PRESETS.some((m) => m.value === initial);

  const [choice, setChoice] = useState(initialIsPreset ? initial : CUSTOM);
  const [custom, setCustom] = useState(initialIsPreset ? "" : initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const effective = (choice === CUSTOM ? custom : choice).trim();
  const dirty = effective.length > 0 && effective !== initial;

  const save = () =>
    startTransition(async () => {
      setStatus(null);
      const res = await updateBeaconSetting(setting.key, effective);
      setStatus(res.ok ? "Saved." : `Failed: ${res.error}`);
    });

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {setting.label}
      </label>
      {setting.description && (
        <p id={`${id}-desc`} className="mt-1 text-xs leading-relaxed text-ink-muted">
          {setting.description}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <select
          id={id}
          aria-describedby={setting.description ? `${id}-desc` : undefined}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        >
          {MODEL_PRESETS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom model ID...</option>
        </select>

        {choice === CUSTOM && (
          <div className="flex flex-col gap-1">
            <label htmlFor={customId} className="text-xs font-semibold text-ink">
              Custom model ID
            </label>
            <input
              id={customId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. claude-opus-4-8 or a future version id"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="min-h-[44px] rounded-card border border-line bg-base px-3 font-mono text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
            />
            <p className="text-xs leading-relaxed text-ink-muted">
              Enter the exact Anthropic model id. It is saved as-is and sent
              straight to the API, so a typo will make AI calls fail until fixed.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={save}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <span className="text-xs text-ink-muted">
            Active model:{" "}
            <code className="font-mono text-ink">{initial || "(unset)"}</code>
          </span>
          <span aria-live="polite" className="text-xs text-ink-muted">
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
