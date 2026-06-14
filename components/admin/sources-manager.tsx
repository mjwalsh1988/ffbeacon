"use client";

import { useState, useTransition } from "react";
import {
  toggleSource,
  setDefaultSource,
  moveSource,
} from "@/app/admin/beacon/actions";

export type ManagedSource = {
  slug: string;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  priority: number;
};

/**
 * Sources management: active on/off, the site-wide default (exactly one), and
 * display order. Screen-reader-first:
 *   - one shared aria-live region announces every state change (activation,
 *     default promotion, reorder with the new position),
 *   - active is a role="switch" with aria-checked,
 *   - default is a "Set as default" button per source (the current default shows
 *     a static badge instead); inactive sources can't be promoted because the
 *     default must be active,
 *   - reorder is up/down buttons (no drag-and-drop), disabled at the ends.
 * Updates are optimistic for instant feedback; the server action revalidates and
 * is the source of truth (a failure reverts and announces the error).
 */
export function SourcesManager({ sources }: { sources: ManagedSource[] }) {
  const [list, setList] = useState(() =>
    [...sources].sort((a, b) => a.priority - b.priority),
  );
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();

  const announce = (msg: string) => setStatus(msg);

  const onToggleActive = (slug: string, next: boolean) => {
    const src = list.find((s) => s.slug === slug);
    if (!src) return;
    if (!next && src.is_default) {
      announce(
        `Cannot deactivate ${src.display_name}: it is the default source. Set another source as the default first.`,
      );
      return;
    }
    const prev = list;
    setList((l) => l.map((s) => (s.slug === slug ? { ...s, is_active: next } : s)));
    startTransition(async () => {
      const res = await toggleSource(slug, next);
      if (res.ok) {
        announce(`${src.display_name} is now ${next ? "active and included in the blend" : "inactive and dropped from the blend"}.`);
      } else {
        setList(prev);
        announce(`Failed to update ${src.display_name}: ${res.error}`);
      }
    });
  };

  const onSetDefault = (slug: string) => {
    const src = list.find((s) => s.slug === slug);
    if (!src || src.is_default) return;
    const prev = list;
    setList((l) => l.map((s) => ({ ...s, is_default: s.slug === slug })));
    startTransition(async () => {
      const res = await setDefaultSource(slug);
      if (res.ok) {
        announce(`${src.display_name} is now the site-wide default source.`);
      } else {
        setList(prev);
        announce(`Failed to set ${src.display_name} as default: ${res.error}`);
      }
    });
  };

  const onMove = (slug: string, direction: "up" | "down") => {
    const idx = list.findIndex((s) => s.slug === slug);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= list.length) return;
    const src = list[idx];
    const prev = list;
    const reordered = [...list];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    setList(reordered);
    startTransition(async () => {
      const res = await moveSource(slug, direction);
      if (res.ok) {
        announce(`${src.display_name} moved to position ${targetIdx + 1} of ${list.length}.`);
      } else {
        setList(prev);
        announce(`Failed to move ${src.display_name}: ${res.error}`);
      }
    });
  };

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      <ol role="list" className="grid gap-3">
        {list.map((s, i) => (
          <li
            key={s.slug}
            className="rounded-card border border-line bg-surface/60 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {s.display_name}{" "}
                  <span className="font-mono text-xs text-ink-subtle">{s.slug}</span>
                </p>
                <p className="mt-0.5 text-sm">
                  <span className="text-ink-subtle">Position {i + 1} of {list.length}. </span>
                  {s.is_active ? (
                    <span className="text-signal-success">Active.</span>
                  ) : (
                    <span className="text-ink-subtle">Inactive.</span>
                  )}
                  {s.is_default && <span className="text-brand-cyan"> Default source.</span>}
                </p>
              </div>

              {/* Active switch */}
              <button
                type="button"
                role="switch"
                aria-checked={s.is_active}
                aria-label={`${s.display_name}: ${s.is_active ? "active, click to deactivate" : "inactive, click to activate"}`}
                disabled={pending}
                onClick={() => onToggleActive(s.slug, !s.is_active)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60 ${
                  s.is_active ? "border-brand-cyan bg-brand-cyan/30" : "border-line bg-base"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 transform rounded-full bg-ink transition-transform ${
                    s.is_active ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* Default source: a static badge for the current default, a
                  promote button for the rest (only when active). */}
              {s.is_default ? (
                <span className="inline-flex min-h-[44px] items-center rounded-card border border-brand-cyan bg-brand-cyan/10 px-3 text-sm font-semibold text-ink">
                  Default source
                </span>
              ) : (
                <button
                  type="button"
                  disabled={pending || !s.is_active}
                  aria-label={
                    s.is_active
                      ? `Set ${s.display_name} as the site-wide default source`
                      : `${s.display_name} must be active before it can be the default source`
                  }
                  onClick={() => onSetDefault(s.slug)}
                  className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
                >
                  Set as default
                </button>
              )}

              {/* Reorder */}
              <button
                type="button"
                disabled={pending || i === 0}
                aria-label={`Move ${s.display_name} up (currently position ${i + 1} of ${list.length})`}
                onClick={() => onMove(s.slug, "up")}
                className="min-h-[44px] min-w-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                <span aria-hidden="true">Up</span>
              </button>
              <button
                type="button"
                disabled={pending || i === list.length - 1}
                aria-label={`Move ${s.display_name} down (currently position ${i + 1} of ${list.length})`}
                onClick={() => onMove(s.slug, "down")}
                className="min-h-[44px] min-w-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                <span aria-hidden="true">Down</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
