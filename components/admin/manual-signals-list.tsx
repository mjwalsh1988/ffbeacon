"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setManualSignalActive } from "@/app/admin/beacon/actions";

export type ManualSignalItem = {
  id: string;
  target: string;
  subject: string;
  scope: string;
  adjustmentType: string;
  magnitude: number;
  silent: boolean;
  reason: string | null;
};

/**
 * Active manual signals with a deactivate control. Screen-reader-first removal:
 * a shared aria-live region announces each deactivation, and focus is moved
 * deliberately after a row disappears (to the next deactivate button, or the
 * empty-state message when the last one is removed) so focus is never dropped to
 * the document body.
 */
export function ManualSignalsList({ signals }: { signals: ManualSignalItem[] }) {
  const [items, setItems] = useState(signals);
  const [status, setStatus] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Focus management: after an item is removed we point focus at the next
  // remaining deactivate button, or the empty-state node when none remain.
  const buttonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const emptyRef = useRef<HTMLParagraphElement | null>(null);
  const focusAfterRemoveRef = useRef<{ nextId: string | null } | null>(null);

  useEffect(() => {
    const plan = focusAfterRemoveRef.current;
    if (!plan) return;
    focusAfterRemoveRef.current = null;
    if (plan.nextId) {
      buttonRefs.current.get(plan.nextId)?.focus();
    } else {
      emptyRef.current?.focus();
    }
  }, [items]);

  const deactivate = (id: string) => {
    const idx = items.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const subject = items[idx].subject;
    setPendingId(id);
    startTransition(async () => {
      const res = await setManualSignalActive(id, false);
      setPendingId(null);
      if (!res.ok) {
        setStatus(`Failed to deactivate the signal for ${subject}: ${res.error}`);
        return;
      }
      const remaining = items.filter((s) => s.id !== id);
      const nextId = remaining[idx]?.id ?? remaining[idx - 1]?.id ?? null;
      focusAfterRemoveRef.current = { nextId };
      setItems(remaining);
      setStatus(`Deactivated the manual signal for ${subject}. ${remaining.length} active signal${remaining.length === 1 ? "" : "s"} remaining.`);
    });
  };

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {items.length === 0 ? (
        <p
          ref={emptyRef}
          tabIndex={-1}
          className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          No active manual signals.
        </p>
      ) : (
        <ul role="list" className="grid gap-3">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/60 p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {s.subject}{" "}
                  <span className="font-normal text-ink-muted">
                    {s.adjustmentType} {s.magnitude}, {s.scope}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {s.silent ? "Silent (hidden from trends)" : "True signal (shows as movement)"}
                  {s.reason ? `, ${s.reason}` : ""}
                </p>
              </div>
              <button
                type="button"
                ref={(el) => {
                  buttonRefs.current.set(s.id, el);
                }}
                disabled={pendingId === s.id}
                aria-label={`Deactivate manual signal for ${s.subject}`}
                onClick={() => deactivate(s.id)}
                className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
              >
                {pendingId === s.id ? "Removing..." : "Deactivate"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
