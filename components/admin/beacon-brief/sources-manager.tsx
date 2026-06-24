"use client";

import { useState, useTransition } from "react";
import {
  createSource,
  deleteSource,
  toggleSource,
  updateSource,
} from "@/app/admin/beacon-brief/actions";

export interface SourceView {
  id: string;
  admin_label: string;
  source_type: string;
  handle: string;
  is_active: boolean;
  last_poll_status: string | null;
  last_polled_at: string | null;
  last_poll_error: string | null;
}

const inputClass =
  "min-h-[44px] w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50";

export function SourcesManager({ sources }: { sources: SourceView[] }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [handle, setHandle] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editHandle, setEditHandle] = useState("");

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) =>
    startTransition(async () => {
      setStatus(null);
      const res = await fn();
      setStatus(res.ok ? okMsg : `Failed: ${res.error}`);
    });

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-ink-muted">
        {status}
      </p>

      <form
        className="rounded-card border border-line bg-surface/60 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await createSource(label, "x", handle);
            if (res.ok) {
              setLabel("");
              setHandle("");
            }
            return res;
          }, "Source added.");
        }}
      >
        <h2 className="text-base font-semibold text-ink">Add a source</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">
              Internal label
            </span>
            <input
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Source type</span>
            <select
              className={`${inputClass} disabled:opacity-60`}
              defaultValue="x"
              aria-label="Source type (only X is supported today)"
              disabled
            >
              <option value="x">X (Twitter)</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">
              X handle (without @)
            </span>
            <input
              className={inputClass}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              required
            />
          </label>
        </div>
        <button type="submit" disabled={pending} className={`mt-3 ${btnClass}`}>
          {pending ? "Saving..." : "Add source"}
        </button>
      </form>

      <section aria-labelledby="src-list">
        <h2 id="src-list" className="text-base font-semibold text-ink">
          Sources
        </h2>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No sources yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {sources.map((s) => (
              <li
                key={s.id}
                className="rounded-card border border-line bg-surface/60 p-4"
              >
                {editId === s.id ? (
                  <div className="space-y-3">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        Internal label
                      </span>
                      <input
                        className={inputClass}
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        X handle (without @)
                      </span>
                      <input
                        className={inputClass}
                        value={editHandle}
                        onChange={(e) => setEditHandle(e.target.value)}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        className={btnClass}
                        onClick={() =>
                          run(async () => {
                            const res = await updateSource(
                              s.id,
                              editLabel,
                              editHandle,
                            );
                            if (res.ok) setEditId(null);
                            return res;
                          }, "Source updated.")
                        }
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className={btnClass}
                        onClick={() => setEditId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">
                        {s.admin_label}{" "}
                        <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                          {s.is_active ? "Active" : "Inactive"}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">
                        {s.source_type.toUpperCase()} @{s.handle}
                      </p>
                      <p className="mt-1 text-xs text-ink-subtle">
                        Last poll:{" "}
                        {s.last_polled_at ? (
                          <span
                            className={
                              s.last_poll_status === "error"
                                ? "text-signal-danger"
                                : "text-ink-muted"
                            }
                          >
                            {s.last_poll_status ?? "unknown"} at{" "}
                            {new Date(s.last_polled_at).toLocaleString()}
                            {s.last_poll_error ? ` (${s.last_poll_error})` : ""}
                          </span>
                        ) : (
                          "never"
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnClass}
                        onClick={() => {
                          setEditId(s.id);
                          setEditLabel(s.admin_label);
                          setEditHandle(s.handle);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={btnClass}
                        aria-pressed={s.is_active}
                        onClick={() =>
                          run(
                            () => toggleSource(s.id, !s.is_active),
                            s.is_active ? "Deactivated." : "Activated.",
                          )
                        }
                      >
                        {s.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={`${btnClass} hover:border-signal-danger`}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete source "${s.admin_label}"? Its ingestion history is removed too.`,
                            )
                          ) {
                            run(() => deleteSource(s.id), "Source deleted.");
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
