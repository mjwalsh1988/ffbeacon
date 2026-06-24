"use client";

import { useState, useTransition } from "react";
import {
  createWebhook,
  deleteWebhook,
  toggleWebhook,
  updateWebhook,
} from "@/app/admin/system/actions";

export interface WebhookView {
  id: string;
  label: string;
  is_active: boolean;
  urlHint: string;
}

const inputClass =
  "min-h-[44px] w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50";

export function WebhooksManager({ webhooks }: { webhooks: WebhookView[] }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUrl, setEditUrl] = useState("");

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
            const res = await createWebhook(newLabel, newUrl);
            if (res.ok) {
              setNewLabel("");
              setNewUrl("");
            }
            return res;
          }, "Webhook added.");
        }}
      >
        <h2 className="text-base font-semibold text-ink">Add a webhook</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Label</span>
            <input
              className={inputClass}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="News & Injuries"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">
              Discord webhook URL
            </span>
            <input
              className={inputClass}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              type="url"
              required
            />
          </label>
        </div>
        <button type="submit" disabled={pending} className={`mt-3 ${btnClass}`}>
          {pending ? "Saving..." : "Add webhook"}
        </button>
      </form>

      <section aria-labelledby="wh-list">
        <h2 id="wh-list" className="text-base font-semibold text-ink">
          Webhooks
        </h2>
        {webhooks.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No webhooks yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {webhooks.map((w) => (
              <li
                key={w.id}
                className="rounded-card border border-line bg-surface/60 p-4"
              >
                {editId === w.id ? (
                  <div className="space-y-3">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        Label
                      </span>
                      <input
                        className={inputClass}
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        New URL (leave blank to keep current)
                      </span>
                      <input
                        className={inputClass}
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        placeholder="https://discord.com/api/webhooks/..."
                        type="url"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        className={btnClass}
                        onClick={() =>
                          run(async () => {
                            const res = await updateWebhook(
                              w.id,
                              editLabel,
                              editUrl,
                            );
                            if (res.ok) setEditId(null);
                            return res;
                          }, "Webhook updated.")
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">
                        {w.label}{" "}
                        <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                          {w.is_active ? "Active" : "Inactive"}
                        </span>
                      </p>
                      <p className="mt-1 font-mono text-xs text-ink-subtle">
                        ...{w.urlHint}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnClass}
                        onClick={() => {
                          setEditId(w.id);
                          setEditLabel(w.label);
                          setEditUrl("");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={btnClass}
                        aria-pressed={w.is_active}
                        onClick={() =>
                          run(
                            () => toggleWebhook(w.id, !w.is_active),
                            w.is_active ? "Deactivated." : "Activated.",
                          )
                        }
                      >
                        {w.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={`${btnClass} hover:border-signal-danger`}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete webhook "${w.label}"? This cannot be undone.`,
                            )
                          ) {
                            run(() => deleteWebhook(w.id), "Webhook deleted.");
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
