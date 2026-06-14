"use client";

import { useId, useState, useTransition } from "react";
import { updateFormatDisplayName } from "@/app/admin/beacon/actions";

export type FormatNameRow = {
  id: string;
  slug: string;
  display_name: string;
};

/**
 * Edit the public display name of each format. The raw slug is shown only as a
 * dimmed reference (never the user-facing label); the editable display_name is
 * what renders across the site. Each row is an independent labeled field with an
 * aria-live save status.
 */
export function FormatNamesEditor({ formats }: { formats: FormatNameRow[] }) {
  return (
    <ul role="list" className="grid gap-3 sm:grid-cols-2">
      {formats.map((f) => (
        <FormatNameField key={f.id} format={f} />
      ))}
    </ul>
  );
}

function FormatNameField({ format }: { format: FormatNameRow }) {
  const id = useId();
  const initial = format.display_name ?? "";
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const dirty = value !== saved;

  const save = () =>
    startTransition(async () => {
      setStatus(null);
      const res = await updateFormatDisplayName(format.id, value);
      if (res.ok) {
        setSaved(value);
        setStatus(`Saved. This format now reads as "${value.trim()}".`);
      } else {
        setStatus(`Failed: ${res.error}`);
      }
    });

  return (
    <li className="rounded-card border border-line bg-surface/60 p-4">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        Display name
      </label>
      <p id={`${id}-slug`} className="mt-0.5 font-mono text-xs text-ink-subtle">
        {format.slug}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={id}
          type="text"
          value={value}
          aria-describedby={`${id}-slug`}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-[44px] w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        />
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="min-h-[44px] shrink-0 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      <span aria-live="polite" className="mt-1 block text-xs text-ink-muted">
        {status}
      </span>
    </li>
  );
}
