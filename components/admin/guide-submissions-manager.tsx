"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Check, Mail, Trash2, X } from "lucide-react";
import { useAdminAnnouncer } from "@/components/admin/admin-controls";
import { denySubmission, deleteSubmission } from "@/app/admin/signal-guide/actions";

export type PendingSubmission = {
  id: string;
  name: string;
  email: string | null;
  question: string;
  page_key: string;
  pageTitle: string;
  createdAtLabel: string;
};

/**
 * The pending community-question queue. Each row can be:
 *   - Accepted: a link into that page's manager (?submission=id) where the admin
 *     writes the answer and publishes it (which marks the submission accepted).
 *   - Denied: kept for the record but removed from the queue.
 *   - Deleted: removed permanently (guarded by an inline confirm).
 * Screen-reader-first: one re-announcing live region narrates every change, and
 * deletes/denies remove the row optimistically with focus management.
 */
export function GuideSubmissionsManager({ initial }: { initial: PendingSubmission[] }) {
  const [list, setList] = useState<PendingSubmission[]>(initial);
  const { announce, region } = useAdminAnnouncer();
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const yesDeleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmingDelete) yesDeleteRef.current?.focus();
  }, [confirmingDelete]);

  const onDeny = (sub: PendingSubmission) => {
    const prev = list;
    setList((l) => l.filter((s) => s.id !== sub.id));
    startTransition(async () => {
      const res = await denySubmission(sub.id);
      if (res.ok) {
        announce(`Denied the question from ${sub.name}.`);
      } else {
        setList(prev);
        announce(`Could not deny: ${res.error}`);
      }
    });
  };

  const onDelete = (sub: PendingSubmission) => {
    const prev = list;
    setList((l) => l.filter((s) => s.id !== sub.id));
    setConfirmingDelete(null);
    startTransition(async () => {
      const res = await deleteSubmission(sub.id);
      if (res.ok) {
        announce(`Deleted the question from ${sub.name}.`);
      } else {
        setList(prev);
        announce(`Could not delete: ${res.error}`);
      }
    });
  };

  if (list.length === 0) {
    return (
      <>
        {region}
        <p className="rounded-card border border-line bg-surface/60 p-6 text-sm text-ink-muted">
          No pending questions right now. When a visitor submits a question from a page's
          guide, it will appear here for review.
        </p>
      </>
    );
  }

  return (
    <div>
      {region}
      <ul role="list" className="grid gap-4">
        {list.map((sub) => (
          <li
            key={sub.id}
            className="rounded-card border border-line bg-surface/60 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{sub.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                  {sub.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
                      <a className="hover:underline" href={`mailto:${sub.email}`}>
                        {sub.email}
                      </a>
                    </span>
                  ) : (
                    <span className="text-ink-muted">No email (no reply expected)</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
                    {sub.createdAtLabel}
                  </span>
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-base px-2.5 py-1 text-xs font-medium text-ink-muted">
                Asked on {sub.pageTitle}
              </span>
            </div>

            <p className="mt-3 whitespace-pre-line rounded-card border border-line bg-base/60 p-3 text-sm leading-relaxed text-ink">
              {sub.question}
            </p>

            {confirmingDelete === sub.id ? (
              <div
                role="group"
                aria-label={`Confirm deleting the question from ${sub.name}`}
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <span className="text-sm text-ink-muted">
                  Delete this question permanently? This cannot be undone.
                </span>
                <button
                  ref={yesDeleteRef}
                  type="button"
                  disabled={pending}
                  onClick={() => onDelete(sub)}
                  className="inline-flex min-h-[44px] items-center rounded-card border border-signal-danger bg-signal-danger/10 px-3 text-sm font-semibold text-ink hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(null)}
                  className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                >
                  Keep
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/signal-guide/${encodeURIComponent(sub.page_key)}?submission=${sub.id}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Check aria-hidden="true" className="h-4 w-4" />
                  Accept &amp; answer
                </Link>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onDeny(sub)}
                  aria-label={`Deny the question from ${sub.name}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-signal-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                  Deny
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(sub.id)}
                  aria-label={`Delete the question from ${sub.name} permanently`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
