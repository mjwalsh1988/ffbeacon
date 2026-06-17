"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Image from "next/image";
import {
  createReactionType,
  updateReactionType,
  setReactionTypeActive,
  moveReactionType,
  deleteReactionType,
} from "@/app/admin/signal/reactions/actions";
import {
  reactionImageUrl,
  REACTION_LABEL_MAX,
  REACTION_SLUG_MAX,
  REACTION_CHAR_MAX,
  type ReactionKind,
  type ReactionType,
} from "@/lib/signal/reactions";

/**
 * Admin manager for the Signal custom-reaction catalog. Screen-reader-first,
 * reusing the SourcesManager pattern:
 *   - one shared aria-live region announces every change (create, edit, activate,
 *     reorder with the new position, delete),
 *   - is_active is a role="switch" with aria-checked,
 *   - reorder is keyboard up/down buttons (no drag), disabled at the ends,
 *   - disable (is_active=false) keeps the type and its historical counts; delete is
 *     only possible when no reaction references the type (the DB RESTRICT enforces
 *     it) and the UI explains why a used type cannot be deleted.
 * Image reactions are previewed as <img alt=""> beside their required text label,
 * never as a bare image.
 */

type EditingState = { mode: "create" } | { mode: "edit"; id: string } | null;

export function ReactionsManager({ initial }: { initial: ReactionType[] }) {
  const [list, setList] = useState<ReactionType[]>(() =>
    [...initial].sort((a, b) => a.display_order - b.display_order),
  );
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<EditingState>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const yesDeleteRef = useRef<HTMLButtonElement>(null);
  const deleteBtnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const lastConfirm = useRef<string | null>(null);

  // Move focus into the confirm UI when it opens; on cancel (Keep), return focus
  // to the Delete trigger that opened it. On a successful delete the row unmounts
  // and onDelete has already moved focus to the Add button.
  useEffect(() => {
    if (confirmingDelete) {
      lastConfirm.current = confirmingDelete;
      yesDeleteRef.current?.focus();
    } else if (lastConfirm.current) {
      deleteBtnRefs.current.get(lastConfirm.current)?.focus();
      lastConfirm.current = null;
    }
  }, [confirmingDelete]);

  const announce = (msg: string) => setStatus(msg);

  const refresh = (next: ReactionType[]) =>
    setList([...next].sort((a, b) => a.display_order - b.display_order));

  const onToggleActive = (rt: ReactionType, next: boolean) => {
    const prev = list;
    setList((l) => l.map((r) => (r.id === rt.id ? { ...r, is_active: next } : r)));
    startTransition(async () => {
      const res = await setReactionTypeActive(rt.id, next);
      if (res.ok) {
        announce(
          `${rt.label} is now ${next ? "active and shown in the reaction picker" : "disabled and hidden from the picker; its historical counts stay visible"}.`,
        );
      } else {
        setList(prev);
        announce(`Failed to update ${rt.label}: ${res.error}`);
      }
    });
  };

  const onMove = (rt: ReactionType, direction: "up" | "down") => {
    const idx = list.findIndex((r) => r.id === rt.id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= list.length) return;
    const prev = list;
    const reordered = [...list];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    setList(reordered);
    startTransition(async () => {
      const res = await moveReactionType(rt.id, direction);
      if (res.ok) {
        announce(`${rt.label} moved to position ${targetIdx + 1} of ${list.length}.`);
      } else {
        setList(prev);
        announce(`Failed to move ${rt.label}: ${res.error}`);
      }
    });
  };

  const onDelete = (rt: ReactionType) => {
    startTransition(async () => {
      const res = await deleteReactionType(rt.id);
      if (res.ok) {
        setList((l) => l.filter((r) => r.id !== rt.id));
        setConfirmingDelete(null);
        announce(`${rt.label} deleted.`);
        addButtonRef.current?.focus();
      } else {
        announce(res.error);
      }
    });
  };

  const onSaved = (saved: ReactionType, isNew: boolean) => {
    if (isNew) {
      setList((l) => [...l, saved]);
      announce(`${saved.label} created.`);
    } else {
      setList((l) => l.map((r) => (r.id === saved.id ? saved : r)));
      announce(`${saved.label} updated.`);
    }
    setEditing(null);
    addButtonRef.current?.focus();
  };

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      {list.length === 0 ? (
        <p className="rounded-card border border-line bg-surface/60 p-4 text-sm text-ink-muted">
          No reactions yet. Add the first reaction below.
        </p>
      ) : (
        <ol role="list" className="grid gap-3">
          {list.map((rt, i) => (
            <li
              key={rt.id}
              className="rounded-card border border-line bg-surface/60 p-4"
            >
              {editing?.mode === "edit" && editing.id === rt.id ? (
                <ReactionForm
                  key={`edit-${rt.id}`}
                  initial={rt}
                  submitLabel="Save changes"
                  onCancel={() => setEditing(null)}
                  onSaved={(saved) => onSaved(saved, false)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <ReactionPreview rt={rt} />
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">
                          {rt.label}{" "}
                          <span className="font-mono text-xs text-ink-muted">{rt.slug}</span>
                        </p>
                        <p className="mt-0.5 text-sm text-ink-muted">
                          <span>Position {i + 1} of {list.length}. </span>
                          <span>{rt.kind === "image" ? "Image reaction. " : "Text reaction. "}</span>
                          {rt.is_active ? (
                            <span className="text-signal-success">Active.</span>
                          ) : (
                            <span>Disabled.</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Active switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rt.is_active}
                      aria-label={`${rt.label}: ${rt.is_active ? "active, click to disable" : "disabled, click to activate"}`}
                      disabled={pending}
                      onClick={() => onToggleActive(rt, !rt.is_active)}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60 ${
                        rt.is_active ? "border-brand-cyan bg-brand-cyan/30" : "border-line bg-base"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-5 w-5 transform rounded-full bg-ink transition-transform ${
                          rt.is_active ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {confirmingDelete === rt.id ? (
                    <div
                      role="group"
                      aria-label={`Confirm deleting ${rt.label}`}
                      className="mt-3 flex flex-wrap items-center gap-2"
                    >
                      <span className="text-sm text-ink-muted">
                        Delete {rt.label}? This works only if it has no reactions
                        left on any post or comment.
                      </span>
                      <button
                        ref={yesDeleteRef}
                        type="button"
                        disabled={pending}
                        onClick={() => onDelete(rt)}
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
                        aria-label={`Edit ${rt.label}`}
                        onClick={() => {
                          setConfirmingDelete(null);
                          setEditing({ mode: "edit", id: rt.id });
                        }}
                        className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        ref={(el) => {
                          deleteBtnRefs.current.set(rt.id, el);
                        }}
                        type="button"
                        disabled={pending}
                        aria-label={`Delete ${rt.label}`}
                        onClick={() => setConfirmingDelete(rt.id)}
                        className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        aria-label={`Move ${rt.label} up (currently position ${i + 1} of ${list.length})`}
                        onClick={() => onMove(rt, "up")}
                        className="min-h-[44px] min-w-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
                      >
                        <span aria-hidden="true">Up</span>
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === list.length - 1}
                        aria-label={`Move ${rt.label} down (currently position ${i + 1} of ${list.length})`}
                        onClick={() => onMove(rt, "down")}
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

      <div className="mt-6">
        {editing?.mode === "create" ? (
          <div className="rounded-card border border-brand-purple/40 bg-surface p-4">
            <h3 className="text-base font-semibold text-ink">Add a reaction</h3>
            <ReactionForm
              key="create"
              submitLabel="Add reaction"
              onCancel={() => setEditing(null)}
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
            Add a reaction
          </button>
        )}
      </div>
    </div>
  );
}

function ReactionPreview({ rt }: { rt: ReactionType }) {
  if (rt.kind === "image" && rt.image_path) {
    return (
      <Image
        src={reactionImageUrl(rt.image_path)}
        alt=""
        width={32}
        height={32}
        unoptimized
        className="h-8 w-8 shrink-0 rounded object-contain"
      />
    );
  }
  return (
    <span aria-hidden="true" className="text-2xl leading-none">
      {rt.char}
    </span>
  );
}

function ReactionForm({
  initial,
  submitLabel,
  onCancel,
  onSaved,
}: {
  initial?: ReactionType;
  submitLabel: string;
  onCancel: () => void;
  onSaved: (saved: ReactionType) => void;
}) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<ReactionKind>(initial?.kind ?? "text");
  const [char, setChar] = useState(initial?.char ?? "");
  const [imagePath, setImagePath] = useState(initial?.image_path ?? "");
  const [imageUrl, setImageUrl] = useState(
    initial?.kind === "image" && initial.image_path
      ? reactionImageUrl(initial.image_path)
      : "",
  );
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const slugRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  const onPickImage = async (file: File) => {
    setError("");
    setUploading(true);
    setUploadStatus("Uploading image...");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/signal/reaction-emoji", {
        method: "POST",
        headers: { "x-requested-with": "ff-beacon" },
        body,
      });
      const data = (await res.json()) as
        | { ok: true; path: string; url: string }
        | { error: string };
      if (!res.ok || !("ok" in data)) {
        const msg = "error" in data ? data.error : "Upload failed.";
        setUploadStatus("");
        setError(msg);
        return;
      }
      setImagePath(data.path);
      setImageUrl(data.url);
      setUploadStatus("Image uploaded.");
    } catch {
      setUploadStatus("");
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = () => {
    setError("");
    if (!label.trim()) {
      setError("Label is required.");
      return;
    }
    if (kind === "text" && !char.trim()) {
      setError("Enter an emoji or short text.");
      return;
    }
    if (kind === "image" && !imagePath) {
      setError("Upload an image first.");
      return;
    }
    startTransition(async () => {
      const input = {
        slug: slug.trim().toLowerCase(),
        label: label.trim(),
        kind,
        char: kind === "text" ? char.trim() : null,
        image_path: kind === "image" ? imagePath : null,
      };
      const res = initial
        ? await updateReactionType(initial.id, input)
        : await createReactionType(input);
      if (!res.ok) {
        setError(res.error);
        slugRef.current?.focus();
        return;
      }
      onSaved(res.row);
    });
  };

  const busy = pending || uploading;

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
        <label htmlFor={`${uid}-label`} className="text-sm font-semibold text-ink">
          Label (read aloud by screen readers)
        </label>
        <input
          id={`${uid}-label`}
          type="text"
          value={label}
          maxLength={REACTION_LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
      </div>

      <div className="grid gap-1">
        <label htmlFor={`${uid}-slug`} className="text-sm font-semibold text-ink">
          Slug (lowercase id, e.g. fire)
        </label>
        <input
          ref={slugRef}
          id={`${uid}-slug`}
          type="text"
          value={slug}
          maxLength={REACTION_SLUG_MAX}
          onChange={(e) => setSlug(e.target.value)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 font-mono text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-ink">Reaction kind</legend>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name={`${uid}-kind`}
              checked={kind === "text"}
              onChange={() => setKind("text")}
              className="h-4 w-4"
            />
            Emoji or text
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name={`${uid}-kind`}
              checked={kind === "image"}
              onChange={() => setKind("image")}
              className="h-4 w-4"
            />
            Custom image
          </label>
        </div>
      </fieldset>

      {kind === "text" ? (
        <div className="grid gap-1">
          <label htmlFor={`${uid}-char`} className="text-sm font-semibold text-ink">
            Emoji or short text
          </label>
          <input
            id={`${uid}-char`}
            type="text"
            value={char}
            maxLength={REACTION_CHAR_MAX}
            onChange={(e) => setChar(e.target.value)}
            className="min-h-[44px] w-24 rounded-card border border-line bg-base px-3 text-lg text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <label htmlFor={`${uid}-image`} className="text-sm font-semibold text-ink">
            Reaction image (PNG, JPEG, or WebP; re-encoded to a small static image)
          </label>
          <input
            id={`${uid}-image`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImage(f);
            }}
            aria-describedby={`${uid}-image-status`}
            className="text-sm text-ink file:mr-3 file:min-h-[44px] file:rounded-card file:border file:border-line file:bg-base file:px-3 file:text-sm file:font-semibold file:text-ink"
          />
          <p id={`${uid}-image-status`} aria-live="polite" className="text-sm text-ink-muted">
            {uploadStatus}
          </p>
          {imageUrl && (
            <Image
              src={imageUrl}
              alt="Reaction image preview"
              width={48}
              height={48}
              unoptimized
              className="h-12 w-12 rounded border border-line object-contain"
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSubmit}
          className="inline-flex min-h-[44px] items-center rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
