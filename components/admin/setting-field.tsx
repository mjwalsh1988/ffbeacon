"use client";

import { useId, useState, useTransition } from "react";
import { updateBeaconSetting } from "@/app/admin/beacon/actions";

export type SettingRow = {
  key: string;
  value: unknown;
  value_type: "number" | "boolean" | "string";
  category: string;
  label: string;
  description: string | null;
};

/** One admin-editable beacon_settings row (number / boolean / string). */
export function SettingField({ setting, options }: { setting: SettingRow; options?: string[] }) {
  const id = useId();
  const initial = String(setting.value ?? "");
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const dirty = value !== initial;
  // Long free-text values (prompts especially) get a multi-line textarea so the
  // full template is visible and editable, never truncated in a single-line box.
  const isLongText =
    setting.value_type === "string" &&
    !options &&
    (setting.key.includes("prompt") || initial.length > 60);

  const save = () =>
    startTransition(async () => {
      setStatus(null);
      const res = await updateBeaconSetting(setting.key, value);
      setStatus(res.ok ? "Saved." : `Failed: ${res.error}`);
    });

  return (
    <div className={`rounded-card border border-line bg-surface/60 p-4${isLongText ? " sm:col-span-2" : ""}`}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {setting.label}
      </label>
      {setting.description && (
        <p id={`${id}-desc`} className="mt-1 text-xs leading-relaxed text-ink-muted">
          {setting.description}
        </p>
      )}
      <div className={`mt-3 ${isLongText ? "flex flex-col gap-2" : "flex items-center gap-2"}`}>
        {isLongText ? (
          <textarea
            id={id}
            rows={8}
            aria-describedby={setting.description ? `${id}-desc` : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-card border border-line bg-base px-3 py-2 font-mono text-sm leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          />
        ) : setting.value_type === "boolean" ? (
          <select
            id={id}
            aria-describedby={setting.description ? `${id}-desc` : undefined}
            value={value === "true" ? "true" : "false"}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        ) : options ? (
          <select
            id={id}
            aria-describedby={setting.description ? `${id}-desc` : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type={setting.value_type === "number" ? "number" : "text"}
            step="any"
            aria-describedby={setting.description ? `${id}-desc` : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-[44px] w-40 rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          />
        )}
        <div className={isLongText ? "flex items-center gap-2" : "contents"}>
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={save}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <span aria-live="polite" className="text-xs text-ink-muted">
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
