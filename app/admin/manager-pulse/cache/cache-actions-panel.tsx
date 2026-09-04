"use client";

/**
 * The two destructive cache actions: clear one handle, and clear every row on
 * a superseded model version. Both confirm through the house dialog with
 * desktopPlacement="center" (a decision, not a detail view, per
 * components/slide-up-dialog.tsx), name what will be deleted and how many
 * rows before the reader commits, and route through the server actions in
 * ./actions.ts, which re-check admin status and re-derive the delete
 * predicate from what is actually stored.
 *
 * The version dropdown never accepts free text: its options are exactly the
 * superseded versions the server page found rows for, so a typo cannot name a
 * version that does not exist and the current version is not offered at all.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { invalidateHandleCacheAction, invalidateModelVersionCacheAction } from "./actions";

export type VersionBreakdownRow = {
  version: string;
  reportCount: number;
  tendencyCount: number;
  isCurrent: boolean;
};

const btnClass =
  "inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60";
const dangerBtnClass =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-card bg-signal-danger px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-wait disabled:opacity-60";
const safeBtnClass =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function HandleInvalidatePanel({
  handle,
  reportCount,
  tendencyCount,
}: {
  handle: string;
  reportCount: number;
  tendencyCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  const nothingStored = reportCount === 0 && tendencyCount === 0;

  const confirm = () => {
    startTransition(async () => {
      const result = await invalidateHandleCacheAction(handle);
      if (result.ok) {
        setStatus(
          `Cleared ${result.reportsDeleted} report row${result.reportsDeleted === 1 ? "" : "s"} and ${result.tendenciesDeleted} tendency row${result.tendenciesDeleted === 1 ? "" : "s"} for ${handle}.`,
        );
        setOpen(false);
        router.refresh();
      } else {
        setStatus(`Could not clear. ${result.error}`);
      }
    });
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={nothingStored}
          className={btnClass}
        >
          Clear stored data for {handle}
        </button>
        {nothingStored ? (
          <span className="text-xs text-ink-subtle">Nothing stored for this handle yet.</span>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-ink-muted">
        {pending ? "Clearing..." : status}
      </p>

      <SlideUpDialog
        open={open}
        onClose={() => setOpen(false)}
        label={`Confirm clearing stored data for ${handle}`}
        labelledBy="mp-handle-clear-heading"
        desktopPlacement="center"
      >
        <div className="p-5 sm:p-6">
          <h3 id="mp-handle-clear-heading" className="text-lg font-semibold tracking-tight text-ink">
            Clear stored data for {handle}?
          </h3>
          <p className="mt-2 text-sm text-ink-muted">
            This deletes {reportCount} report row{reportCount === 1 ? "" : "s"} and {tendencyCount}{" "}
            tendency row{tendencyCount === 1 ? "" : "s"}. The next lookup for this handle rebuilds
            from scratch. This cannot be undone.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => setOpen(false)} className={safeBtnClass}>
              Keep it
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              aria-busy={pending}
              className={dangerBtnClass}
            >
              {pending ? "Clearing..." : "Clear this handle"}
            </button>
          </div>
        </div>
      </SlideUpDialog>
    </div>
  );
}

export function ModelVersionInvalidatePanel({ versions }: { versions: VersionBreakdownRow[] }) {
  const router = useRouter();
  const supersededVersions = versions.filter((v) => !v.isCurrent && (v.reportCount > 0 || v.tendencyCount > 0));
  const [selected, setSelected] = useState(supersededVersions[0]?.version ?? "");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  const selectedRow = supersededVersions.find((v) => v.version === selected) ?? null;

  const confirm = () => {
    if (!selectedRow) return;
    startTransition(async () => {
      const result = await invalidateModelVersionCacheAction(selectedRow.version);
      if (result.ok) {
        setStatus(
          `Cleared ${result.reportsDeleted} report row${result.reportsDeleted === 1 ? "" : "s"} and ${result.tendenciesDeleted} tendency row${result.tendenciesDeleted === 1 ? "" : "s"} on version ${selectedRow.version}.`,
        );
        setOpen(false);
        router.refresh();
      } else {
        setStatus(`Could not clear. ${result.error}`);
      }
    });
  };

  if (supersededVersions.length === 0) {
    return (
      <p className="mt-4 text-sm text-ink-muted">
        Only the current model version has stored rows. There is nothing to bulk-invalidate.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="mp-version-select" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            Superseded model version
          </label>
          <select
            id="mp-version-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="min-h-11 w-64 rounded-card border border-line bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {supersededVersions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version} ({v.reportCount} reports, {v.tendencyCount} tendencies)
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!selectedRow}
          className={btnClass}
        >
          Invalidate this version
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-ink-muted">
        {pending ? "Clearing..." : status}
      </p>

      <SlideUpDialog
        open={open}
        onClose={() => setOpen(false)}
        label="Confirm clearing a model version"
        labelledBy="mp-version-clear-heading"
        desktopPlacement="center"
      >
        <div className="p-5 sm:p-6">
          <h3 id="mp-version-clear-heading" className="text-lg font-semibold tracking-tight text-ink">
            Clear model version {selectedRow?.version}?
          </h3>
          <p className="mt-2 text-sm text-ink-muted">
            This deletes {selectedRow?.reportCount ?? 0} report row
            {(selectedRow?.reportCount ?? 0) === 1 ? "" : "s"} and {selectedRow?.tendencyCount ?? 0}{" "}
            tendency row{(selectedRow?.tendencyCount ?? 0) === 1 ? "" : "s"} across every manager on
            that version. This cannot be undone.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => setOpen(false)} className={safeBtnClass}>
              Keep it
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending || !selectedRow}
              aria-busy={pending}
              className={dangerBtnClass}
            >
              {pending ? "Clearing..." : `Clear version ${selectedRow?.version ?? ""}`}
            </button>
          </div>
        </div>
      </SlideUpDialog>
    </div>
  );
}
