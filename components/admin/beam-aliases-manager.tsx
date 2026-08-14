"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  addPlayerAlias,
  deletePlayerAlias,
  setPlayerAliasActive,
} from "@/app/admin/beam/actions";

/**
 * The nickname editor.
 *
 * This is the one part of BEAM's player resolution that is editorial rather than
 * algorithmic, and it is the loop the unanswered-questions page feeds: read
 * which name people typed that BEAM could not place, add it here, done.
 *
 * The alias is normalized server-side with the same function the resolver uses,
 * so typing "C.M.C." here stores "cmc" and matches. The stored form is shown
 * back after a save for exactly that reason.
 */

export type BeamAliasRow = {
  id: string;
  alias: string;
  aliasKind: string;
  isActive: boolean;
  source: string;
  note: string | null;
  playerName: string;
  playerSlug: string;
  position: string | null;
  team: string | null;
};

const KINDS = [
  { value: "nickname", label: "Nickname" },
  { value: "shorthand", label: "Shorthand" },
  { value: "misspelling", label: "Common misspelling" },
  { value: "initials", label: "Initials" },
] as const;

export function BeamAliasesManager({ initial }: { initial: BeamAliasRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  // Debounced, so typing five characters queues one announcement rather than
  // five. Same pattern as the Signal Guide panel search.
  const [liveCount, setLiveCount] = useState("");

  const uid = useId();
  const [slug, setSlug] = useState("");
  const [alias, setAlias] = useState("");
  const [kind, setKind] = useState<string>("nickname");
  const [note, setNote] = useState("");

  const add = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await addPlayerAlias({
        playerSlug: slug.trim(),
        alias,
        aliasKind: kind,
        note,
      });
      if (result.ok) {
        setMessage({
          kind: "ok",
          text: "Added. Reload to see it in the list below.",
        });
        setAlias("");
        setNote("");
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  const toggle = (id: string, isActive: boolean) => {
    setMessage(null);
    startTransition(async () => {
      const result = await setPlayerAliasActive(id, isActive);
      if (result.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isActive } : r)));
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  const remove = (id: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await deletePlayerAlias(id);
      if (result.ok) {
        const removed = rows.find((r) => r.id === id);
        setRows((prev) => prev.filter((r) => r.id !== id));
        // Announced, because the row carrying the button just vanished and
        // silence is indistinguishable from a failure.
        setMessage({
          kind: "ok",
          text: removed
            ? `Deleted the alias ${removed.alias} for ${removed.playerName}.`
            : "Deleted.",
        });
      } else setMessage({ kind: "error", text: result.error });
    });
  };

  const q = filter.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) => r.alias.toLowerCase().includes(q) || r.playerName.toLowerCase().includes(q),
      )
    : rows;

  useEffect(() => {
    if (q.length === 0) {
      setLiveCount("");
      return;
    }
    const t = window.setTimeout(() => {
      setLiveCount(`${visible.length} ${visible.length === 1 ? "alias" : "aliases"} shown.`);
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, visible.length]);

  return (
    <div className="space-y-6">
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

      <section
        aria-labelledby={`${uid}-add`}
        className="rounded-card border border-line bg-surface/40 p-4"
      >
        <h2 id={`${uid}-add`} className="text-base font-semibold text-ink">
          Add a nickname
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          The player slug is the last part of their profile URL, for example
          brock-purdy-6813. The alias is stored lower-cased with punctuation removed, so
          it matches however someone types it.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) add();
          }}
          className="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <Field
            id={`${uid}-slug`}
            label="Player slug"
            value={slug}
            onChange={setSlug}
            placeholder="brock-purdy-6813"
            required
          />
          <Field
            id={`${uid}-alias`}
            label="Alias"
            value={alias}
            onChange={setAlias}
            placeholder="mr irrelevant"
            required
          />
          <div className="grid gap-1">
            <label htmlFor={`${uid}-kind`} className="text-sm font-semibold text-ink">
              Kind
            </label>
            <select
              id={`${uid}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            id={`${uid}-note`}
            label="Note (optional)"
            value={note}
            onChange={setNote}
            placeholder="Seen 12 times in the gaps list"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60 sm:col-span-2 sm:w-fit"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {pending ? "Adding..." : "Add alias"}
          </button>
        </form>
      </section>

      <section aria-labelledby={`${uid}-list`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id={`${uid}-list`} className="text-base font-semibold text-ink">
            Existing aliases
          </h2>
          <div className="grid gap-1">
            <label htmlFor={`${uid}-filter`} className="text-xs font-semibold text-ink">
              Filter
            </label>
            <input
              id={`${uid}-filter`}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Alias or player"
              className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            />
          </div>
        </div>

        <p aria-live="polite" className="sr-only">
          {liveCount}
        </p>

        {visible.length === 0 ? (
          <p className="mt-3 rounded-card border border-line bg-surface/60 p-4 text-sm text-ink-muted">
            No aliases match that filter.
          </p>
        ) : (
          <ul role="list" className="mt-3 space-y-2">
            {visible.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {row.alias}{" "}
                    <span className="font-normal text-ink-muted">to {row.playerName}</span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {[row.position, row.team, row.aliasKind, row.source]
                      .filter(Boolean)
                      .join(" | ")}
                    {row.note ? ` | ${row.note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex min-h-[44px] items-center gap-2 text-xs font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      disabled={pending}
                      onChange={(e) => toggle(row.id, e.target.checked)}
                      className="h-4 w-4 accent-[#22D3EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    />
                    <span>Active</span>
                    <span className="sr-only">for the alias {row.alias}</span>
                  </label>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(row.id)}
                    aria-label={`Delete the alias ${row.alias} for ${row.playerName}`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-card border border-line bg-base text-ink-muted transition-colors hover:border-signal-danger hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        required={required}
        aria-required={required ? "true" : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
    </div>
  );
}
