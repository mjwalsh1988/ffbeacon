"use client";

import { useId, useState, useTransition } from "react";
import { updateBeaconSetting } from "@/app/admin/beacon/actions";

export interface WebhookOption {
  id: string;
  label: string;
  is_active: boolean;
}

/** The bb_webhook_id setting rendered as a picker of the configured webhooks. */
export function WebhookSelectField({
  currentId,
  label,
  description,
  webhooks,
}: {
  currentId: string;
  label: string;
  description: string | null;
  webhooks: WebhookOption[];
}) {
  const id = useId();
  const [value, setValue] = useState(currentId);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const dirty = value !== currentId;

  const save = () =>
    startTransition(async () => {
      setStatus(null);
      const res = await updateBeaconSetting("bb_webhook_id", value);
      setStatus(res.ok ? "Saved." : `Failed: ${res.error}`);
    });

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:col-span-2">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {description && (
        <p
          id={`${id}-desc`}
          className="mt-1 text-xs leading-relaxed text-ink-muted"
        >
          {description}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          id={id}
          aria-describedby={description ? `${id}-desc` : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        >
          <option value="">None selected</option>
          {webhooks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
              {w.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
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
      {webhooks.length === 0 && (
        <p className="mt-2 text-xs text-signal-warning">
          No webhooks configured yet. Add one under System Settings, Webhooks.
        </p>
      )}
    </div>
  );
}
