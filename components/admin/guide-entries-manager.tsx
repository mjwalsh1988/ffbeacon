"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AdminSwitch, useAdminAnnouncer } from "@/components/admin/admin-controls";
import {
  createEntry,
  updateEntry,
  setEntryPublished,
  moveEntry,
  deleteEntry,
  updatePageMeta,
} from "@/app/admin/signal-guide/actions";
import {
  GUIDE_KIND_NOUN,
  GUIDE_SECTION_LABEL,
  type GuideEntry,
  type GuideEntryKind,
} from "@/lib/guide/types";
import {
  GUIDE_HEADING_MAX,
  GUIDE_BODY_MAX,
  GUIDE_PAGE_TITLE_MAX,
  GUIDE_PAGE_DESCRIPTION_MAX,
} from "@/lib/guide/validate";

/**
 * Admin manager for one Signal Guide section (questions OR terms on a single
 * page). Screen-reader-first, reusing the shared admin primitives (AdminSwitch +
 * useAdminAnnouncer), mirroring components/admin/reactions-manager.tsx:
 *   - one re-announcing aria-live region narrates every change,
 *   - is_published is an AdminSwitch (role="switch", 44px target),
 *   - reorder is keyboard up/down (no drag), disabled at the ends,
 *   - delete is guarded by an inline confirm.
 */

type EditingState = { mode: "create" } | { mode: "edit"; id: string } | null;

function nounFor(kind: GuideEntryKind) {
  return GUIDE_KIND_NOUN[kind];
}

export function GuideEntriesManager({
  pageKey,
  kind,
  initial,
}: {
  pageKey: string;
  kind: GuideEntryKind;
  initial: GuideEntry[];
}) {
  const [list, setList] = useState<GuideEntry[]>(() =>
    [...initial].sort((a, b) => a.display_order - b.display_order),
  );
  const { announce, region } = useAdminAnnouncer();
  const [editing, setEditing] = useState<EditingState>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const yesDeleteRef = useRef<HTMLButtonElement>(null);
  const deleteBtnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const lastConfirm = useRef<string | null>(null);
  const headingId = useId();

  const noun = nounFor(kind);
  const isQuestion = kind === "question";
  const bodyLabel = isQuestion ? "Answer" : "Explanation";

  useEffect(() => {
    if (confirmingDelete) {
      lastConfirm.current = confirmingDelete;
      yesDeleteRef.current?.focus();
    } else if (lastConfirm.current) {
      deleteBtnRefs.current.get(lastConfirm.current)?.focus();
      lastConfirm.current = null;
    }
  }, [confirmingDelete]);

  const onTogglePublished = (entry: GuideEntry, next: boolean) => {
    const prev = list;
    setList((l) => l.map((e) => (e.id === entry.id ? { ...e, is_published: next } : e)));
    startTransition(async () => {
      const res = await setEntryPublished(entry.id, pageKey, next);
      if (res.ok) {
        announce(
          `${entry.heading} is now ${next ? "published and visible to visitors" : "unpublished and hidden from visitors"}.`,
        );
      } else {
        setList(prev);
        announce(`Failed to update: ${res.error}`);
      }
    });
  };

  const onMove = (entry: GuideEntry, direction: "up" | "down") => {
    const idx = list.findIndex((e) => e.id === entry.id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= list.length) return;
    const prev = list;
    const reordered = [...list];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    setList(reordered);
    startTransition(async () => {
      const res = await moveEntry(entry.id, pageKey, direction);
      if (res.ok) {
        announce(`${entry.heading} moved to position ${targetIdx + 1} of ${list.length}.`);
      } else {
        setList(prev);
        announce(`Failed to move: ${res.error}`);
      }
    });
  };

  const onDelete = (entry: GuideEntry) => {
    startTransition(async () => {
      const res = await deleteEntry(entry.id, pageKey);
      if (res.ok) {
        setList((l) => l.filter((e) => e.id !== entry.id));
        setConfirmingDelete(null);
        announce(`${entry.heading} deleted.`);
        addButtonRef.current?.focus();
      } else {
        announce(res.error);
      }
    });
  };

  const onSaved = (saved: GuideEntry, isNew: boolean) => {
    if (isNew) {
      setList((l) => [...l, saved]);
      announce(`${noun.one} added.`);
    } else {
      setList((l) => l.map((e) => (e.id === saved.id ? saved : e)));
      announce(`${noun.one} updated.`);
    }
    setEditing(null);
    addButtonRef.current?.focus();
  };

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan"
      >
        {GUIDE_SECTION_LABEL[kind]} ({noun.many})
      </h2>

      <div className="mt-3">
        {region}

        {list.length === 0 ? (
          <p className="rounded-card border border-line bg-surface/60 p-4 text-sm text-ink-muted">
            No {noun.many} yet. Add the first one below.
          </p>
        ) : (
          <ol role="list" className="grid gap-3">
            {list.map((entry, i) => (
              <li key={entry.id} className="rounded-card border border-line bg-surface/60 p-4">
                {editing?.mode === "edit" && editing.id === entry.id ? (
                  <GuideEntryForm
                    key={`edit-${entry.id}`}
                    kind={kind}
                    bodyLabel={bodyLabel}
                    initial={entry}
                    submitLabel="Save changes"
                    onCancel={() => setEditing(null)}
                    onSubmit={(input) => updateEntry(entry.id, pageKey, input)}
                    onSaved={(saved) => onSaved(saved, false)}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{entry.heading}</p>
                        <p className="mt-0.5 text-sm text-ink-muted">
                          <span>
                            Position {i + 1} of {list.length}.{" "}
                          </span>
                          {entry.is_published ? (
                            <span className="text-signal-success">Published.</span>
                          ) : (
                            <span>Unpublished.</span>
                          )}
                        </p>
                        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">
                          {entry.body}
                        </p>
                      </div>

                      <AdminSwitch
                        checked={entry.is_published}
                        disabled={pending}
                        label={`${entry.heading}: ${entry.is_published ? "published, click to unpublish" : "unpublished, click to publish"}`}
                        onChange={(next) => onTogglePublished(entry, next)}
                      />
                    </div>

                    {confirmingDelete === entry.id ? (
                      <div
                        role="group"
                        aria-label={`Confirm deleting ${entry.heading}`}
                        className="mt-3 flex flex-wrap items-center gap-2"
                      >
                        <span className="text-sm text-ink-muted">
                          Delete {entry.heading}? This cannot be undone.
                        </span>
                        <button
                          ref={yesDeleteRef}
                          type="button"
                          disabled={pending}
                          onClick={() => onDelete(entry)}
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
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={pending || editing !== null}
                          aria-label={`Edit ${entry.heading}`}
                          onClick={() => {
                            setConfirmingDelete(null);
                            setEditing({ mode: "edit", id: entry.id });
                          }}
                          className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          ref={(el) => {
                            deleteBtnRefs.current.set(entry.id, el);
                          }}
                          type="button"
                          disabled={pending}
                          aria-label={`Delete ${entry.heading}`}
                          onClick={() => setConfirmingDelete(entry.id)}
                          className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          disabled={pending || i === 0}
                          aria-label={`Move ${entry.heading} up (currently position ${i + 1} of ${list.length})`}
                          onClick={() => onMove(entry, "up")}
                          className="min-h-[44px] min-w-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
                        >
                          <span aria-hidden="true">Up</span>
                        </button>
                        <button
                          type="button"
                          disabled={pending || i === list.length - 1}
                          aria-label={`Move ${entry.heading} down (currently position ${i + 1} of ${list.length})`}
                          onClick={() => onMove(entry, "down")}
                          className="min-h-[44px] min-w-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
                        >
                          <span aria-hidden="true">Down</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-4">
          {editing?.mode === "create" ? (
            <div className="rounded-card border border-brand-purple/40 bg-surface p-4">
              <h3 className="text-base font-semibold text-ink">Add a {noun.one}</h3>
              <GuideEntryForm
                key="create"
                kind={kind}
                bodyLabel={bodyLabel}
                submitLabel={`Add ${noun.one}`}
                onCancel={() => setEditing(null)}
                onSubmit={(input) => createEntry(pageKey, input)}
                onSaved={(saved) => onSaved(saved, true)}
              />
            </div>
          ) : (
            <button
              ref={addButtonRef}
              type="button"
              disabled={pending || editing !== null}
              onClick={() => {
                setConfirmingDelete(null);
                setEditing({ mode: "create" });
              }}
              className="inline-flex min-h-[44px] items-center rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
            >
              Add a {noun.one}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function GuideEntryForm({
  kind,
  bodyLabel,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
  onSaved,
}: {
  kind: GuideEntryKind;
  bodyLabel: string;
  initial?: GuideEntry;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: {
    kind: GuideEntryKind;
    heading: string;
    body: string;
  }) => Promise<{ ok: true; row: GuideEntry } | { ok: false; error: string }>;
  onSaved: (saved: GuideEntry) => void;
}) {
  const isQuestion = kind === "question";
  const headingLabel = isQuestion ? "Question" : "Term or metric";
  const [heading, setHeading] = useState(initial?.heading ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  const submit = () => {
    setError("");
    if (!heading.trim()) {
      setError(`Enter the ${isQuestion ? "question" : "term"}.`);
      headingRef.current?.focus();
      return;
    }
    if (!body.trim()) {
      setError(`Enter the ${bodyLabel.toLowerCase()}.`);
      return;
    }
    startTransition(async () => {
      const res = await onSubmit({ kind, heading: heading.trim(), body: body.trim() });
      if (!res.ok) {
        setError(res.error);
        headingRef.current?.focus();
        return;
      }
      onSaved(res.row);
    });
  };

  return (
    <div className="mt-3 grid gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-card border border-signal-danger bg-signal-danger/10 px-3 py-2 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <div className="grid gap-1">
        <label htmlFor={`${uid}-heading`} className="text-sm font-semibold text-ink">
          {headingLabel}
        </label>
        <input
          ref={headingRef}
          id={`${uid}-heading`}
          type="text"
          value={heading}
          maxLength={GUIDE_HEADING_MAX}
          onChange={(e) => setHeading(e.target.value)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
      </div>

      <div className="grid gap-1">
        <label htmlFor={`${uid}-body`} className="text-sm font-semibold text-ink">
          {bodyLabel}
        </label>
        <textarea
          id={`${uid}-body`}
          value={body}
          maxLength={GUIDE_BODY_MAX}
          rows={4}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-[88px] rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="inline-flex min-h-[44px] items-center rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Edits the page's own title and description (the admin-facing metadata shown in
 * the index and the public panel subheader). Announces save success/failure.
 */
export function GuidePageMetaForm({
  pageKey,
  initialTitle,
  initialDescription,
}: {
  pageKey: string;
  initialTitle: string;
  initialDescription: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const { announce, region } = useAdminAnnouncer();
  const uid = useId();
  const headingId = useId();

  const dirty = title !== initialTitle || description !== initialDescription;

  const save = () => {
    setError("");
    if (!title.trim()) {
      setError("Enter a page title.");
      return;
    }
    startTransition(async () => {
      const res = await updatePageMeta(pageKey, { title: title.trim(), description });
      if (!res.ok) {
        setError(res.error);
        announce(`Failed to save: ${res.error}`);
        return;
      }
      announce("Page details saved.");
    });
  };

  return (
    <section aria-labelledby={headingId} className="rounded-card border border-line bg-surface/60 p-4">
      {region}
      <h2 id={headingId} className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
        Page details
      </h2>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-card border border-signal-danger bg-signal-danger/10 px-3 py-2 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <div className="mt-3 grid gap-4">
        <div className="grid gap-1">
          <label htmlFor={`${uid}-title`} className="text-sm font-semibold text-ink">
            Title (shown in the guide panel header)
          </label>
          <input
            id={`${uid}-title`}
            type="text"
            value={title}
            maxLength={GUIDE_PAGE_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${uid}-description`} className="text-sm font-semibold text-ink">
            Internal description (admin only)
          </label>
          <textarea
            id={`${uid}-description`}
            value={description}
            maxLength={GUIDE_PAGE_DESCRIPTION_MAX}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[66px] rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>
        <div>
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={save}
            className="inline-flex min-h-[44px] items-center rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
          >
            Save page details
          </button>
        </div>
      </div>
    </section>
  );
}
