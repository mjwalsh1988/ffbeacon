"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from "lucide-react";
import { saveLinks } from "./actions";
import { LINK_LABEL_MAX, LINKS_MAX, type SignalLink } from "./customization";

/**
 * Custom-links editor for a Signal. Owns a local list of {label, url} rows that
 * the owner edits, reorders (accessible move up / move down, no drag, mirroring
 * profile-boards-manager), adds to, and removes from. The whole list is
 * persisted on Save via the saveLinks server action, which re-validates
 * server-side and is backed by the signals.links DB shape guard (migration
 * 0069). Client-side validation mirrors the server rules so the owner gets
 * instant, specific feedback: https web links only, label 1 to 40 characters,
 * and at most 10 links. A polite live region announces reorder + save results;
 * an assertive region carries errors.
 */

type Row = { key: string; label: string; url: string };

let keySeq = 0;
const nextKey = () => `link-${keySeq++}`;

export function LinksEditor({ initialLinks }: { initialLinks: SignalLink[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialLinks.slice(0, LINKS_MAX).map((l) => ({
      key: nextKey(),
      label: l.label,
      url: l.url,
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const headingId = useId();
  // Refs to each row's label input so a newly added row can take focus.
  const labelRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
  };

  const addRow = () => {
    if (rows.length >= LINKS_MAX) return;
    const key = nextKey();
    setRows((prev) => [...prev, { key, label: "", url: "" }]);
    markDirty();
    setAnnouncement(`Added link ${rows.length + 1}. Enter a label and address.`);
    // Focus the new label input after it mounts.
    requestAnimationFrame(() => labelRefs.current.get(key)?.focus());
  };

  const updateRow = (key: string, field: "label" | "url", value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
    markDirty();
  };

  const removeRow = (key: string, index: number) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    markDirty();
    setAnnouncement(`Removed link ${index + 1}.`);
  };

  const move = (key: string, direction: "up" | "down") => {
    const index = rows.findIndex((r) => r.key === key);
    const swap = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swap < 0 || swap >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
    setAnnouncement(`Moved link to position ${swap + 1} of ${rows.length}.`);
    markDirty();
  };

  // Client mirror of the server validation. Returns the cleaned list or an
  // error message describing the first problem.
  const validate = (): { ok: true; links: SignalLink[] } | { ok: false; error: string } => {
    const cleaned: SignalLink[] = [];
    for (let i = 0; i < rows.length; i++) {
      const label = rows[i].label.trim();
      const url = rows[i].url.trim();
      if (label.length < 1 || label.length > LINK_LABEL_MAX) {
        return {
          ok: false,
          error: `Link ${i + 1} needs a label of 1 to ${LINK_LABEL_MAX} characters.`,
        };
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return {
          ok: false,
          error: `Link ${i + 1} ("${label}") needs a valid web address.`,
        };
      }
      if (parsed.protocol !== "https:") {
        return {
          ok: false,
          error: `Link ${i + 1} ("${label}") must start with https://.`,
        };
      }
      cleaned.push({ label, url: parsed.toString() });
    }
    return { ok: true, links: cleaned };
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const result = validate();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(async () => {
      const res = await saveLinks(result.links);
      if (res.ok) {
        setDirty(false);
        setSaved(true);
        setAnnouncement("Links saved.");
      } else {
        setError(res.error);
        setAnnouncement("");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <h3 id={headingId} className="sr-only">
        Custom links
      </h3>
      <p className="text-xs text-ink-subtle">
        Add up to {LINKS_MAX} links to your other pages. Web addresses must start
        with https://. Visitors see the label, not the raw address.
      </p>

      {/* Polite reorder / save status. */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-line bg-base/40 p-5 text-sm text-ink-muted">
          No links yet. Add your first one below.
        </p>
      ) : (
        <ol role="list" className="mt-4 flex flex-col gap-3">
          {rows.map((row, index) => (
            <LinkRow
              key={row.key}
              row={row}
              index={index}
              total={rows.length}
              busy={pending}
              labelRef={(el) => {
                if (el) labelRefs.current.set(row.key, el);
                else labelRefs.current.delete(row.key);
              }}
              onChange={updateRow}
              onMove={move}
              onRemove={removeRow}
            />
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          disabled={pending || rows.length >= LINKS_MAX}
          className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-semibold text-brand-cyan hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add link
        </button>
        <span className="text-xs text-ink-subtle">
          {rows.length} of {LINKS_MAX}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <button
          type="submit"
          disabled={pending || !dirty}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {pending ? "Saving..." : "Save links"}
        </button>
        <div aria-live="polite" role="status" className="min-h-[1.25rem] text-sm">
          {saved && !dirty && <p className="text-signal-success">Links saved.</p>}
          {dirty && !error && (
            <p className="text-ink-subtle">You have unsaved changes.</p>
          )}
        </div>
      </div>

      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="mt-2 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function LinkRow({
  row,
  index,
  total,
  busy,
  labelRef,
  onChange,
  onMove,
  onRemove,
}: {
  row: Row;
  index: number;
  total: number;
  busy: boolean;
  labelRef: (el: HTMLInputElement | null) => void;
  onChange: (key: string, field: "label" | "url", value: string) => void;
  onMove: (key: string, direction: "up" | "down") => void;
  onRemove: (key: string, index: number) => void;
}) {
  const labelId = useId();
  const urlId = useId();
  const position = `Link ${index + 1}`;
  return (
    <li className="rounded-card border border-line bg-base p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
          {position}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onMove(row.key, "up")}
            disabled={busy || index === 0}
            aria-label={`Move ${position} up`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-9 sm:w-9"
          >
            <ChevronUp aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(row.key, "down")}
            disabled={busy || index === total - 1}
            aria-label={`Move ${position} down`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-9 sm:w-9"
          >
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(row.key, index)}
            disabled={busy}
            aria-label={`Remove ${position}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9 sm:w-9"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={labelId} className="block text-xs font-medium text-ink">
            Label
          </label>
          <input
            id={labelId}
            ref={labelRef}
            value={row.label}
            maxLength={LINK_LABEL_MAX}
            onChange={(e) => onChange(row.key, "label", e.target.value)}
            placeholder="My YouTube channel"
            className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor={urlId} className="block text-xs font-medium text-ink">
            Web address
          </label>
          <input
            id={urlId}
            type="url"
            inputMode="url"
            value={row.url}
            onChange={(e) => onChange(row.key, "url", e.target.value)}
            placeholder="https://example.com"
            className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
          />
        </div>
      </div>
    </li>
  );
}
