"use client";

import { useState, useTransition } from "react";
import { Mail, Trash2 } from "lucide-react";
import {
  deleteLearningRequest,
  setLearningRequestStatus,
} from "@/app/admin/beam/actions";

/**
 * The learning-request queue.
 *
 * Each row is one person who hit a wall and asked us to fix it, so the row shows
 * the question that failed, who asked, and a way to reply. Status is a plain
 * select rather than a set of buttons because there are four states and only one
 * can be true.
 *
 * Rows disappear from the list optimistically on delete and stay put on a status
 * change, since a status change is not a removal and making the row vanish would
 * hide the confirmation.
 */

export type BeamRequestRow = {
  id: string;
  question: string;
  name: string;
  email: string | null;
  message: string | null;
  status: string;
  adminNote: string | null;
  createdAtLabel: string;
};

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "planned", label: "Planned" },
  { value: "shipped", label: "Shipped" },
  { value: "declined", label: "Declined" },
] as const;

export function BeamRequestsManager({ initial }: { initial: BeamRequestRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-line bg-surface/60 p-4 text-sm text-ink-muted">
        Nothing waiting. When someone uses the Help BEAM learn this button, it lands here.
      </p>
    );
  }

  const updateStatus = (id: string, status: string, note: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await setLearningRequestStatus(id, status, note);
      if (result.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status, adminNote: note } : r)));
        setMessage({ kind: "ok", text: "Updated." });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  const remove = (id: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteLearningRequest(id);
      if (result.ok) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        setMessage({ kind: "ok", text: "Deleted." });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  return (
    <div className="space-y-3">
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-card border px-4 py-2 text-sm ${
            message.kind === "error"
              ? "border-signal-danger bg-signal-danger/10 text-ink"
              : "border-brand-cyan/50 bg-brand-cyan/10 text-ink"
          }`}
        >
          {message.text}
        </p>
      )}

      <ul role="list" className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-card border border-line bg-surface/60 p-4">
            <p className="text-sm font-semibold text-ink">{row.question}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {row.name}
              {row.email ? " | " : ""}
              {row.email && (
                <a
                  href={`mailto:${row.email}`}
                  className="inline-flex items-center gap-1 font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Mail aria-hidden="true" className="h-3 w-3" />
                  {row.email}
                </a>
              )}
              {" | "}
              {row.createdAtLabel}
            </p>
            {row.message && (
              <p className="mt-2 rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink-muted">
                {row.message}
              </p>
            )}

            <RequestControls
              row={row}
              disabled={pending}
              onSave={(status, note) => updateStatus(row.id, status, note)}
              onDelete={() => remove(row.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestControls({
  row,
  disabled,
  onSave,
  onDelete,
}: {
  row: BeamRequestRow;
  disabled: boolean;
  onSave: (status: string, note: string) => void;
  onDelete: () => void;
}) {
  const [status, setStatus] = useState(row.status);
  const [note, setNote] = useState(row.adminNote ?? "");
  const statusId = `status-${row.id}`;
  const noteId = `note-${row.id}`;

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-end">
      <div className="grid gap-1">
        <label htmlFor={statusId} className="text-xs font-semibold text-ink">
          Status
        </label>
        <select
          id={statusId}
          value={status}
          disabled={disabled}
          onChange={(e) => setStatus(e.target.value)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <label htmlFor={noteId} className="text-xs font-semibold text-ink">
          Internal note
        </label>
        <input
          id={noteId}
          type="text"
          value={note}
          maxLength={1000}
          disabled={disabled}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onSave(status, note)}
        className="inline-flex min-h-[44px] items-center justify-center rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
      >
        Save
      </button>

      <button
        type="button"
        disabled={disabled}
        onClick={onDelete}
        aria-label={`Delete the request from ${row.name}`}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink-muted transition-colors hover:border-signal-danger hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Delete</span>
      </button>
    </div>
  );
}
