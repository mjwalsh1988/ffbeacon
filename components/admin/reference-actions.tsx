"use client";

import { useId, useState, useTransition } from "react";
import {
  rebuildReferenceNow,
  rollbackReference,
} from "@/app/admin/beacon/calibration/actions";

/**
 * Rebuild and rollback controls for one format's calibration reference.
 *
 * Both are two-step: the button arms a confirmation, and only the second press
 * runs. Rebuilding replaces the scale every value on that board is measured
 * against, so a stray click should not be able to do it.
 */
export function ReferenceActions({
  formatSlug,
  rollbackVersionId,
  rollbackVersionLabel,
}: {
  formatSlug: string;
  rollbackVersionId: string | null;
  rollbackVersionLabel: string | null;
}) {
  const statusId = useId();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState<"rebuild" | "rollback" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = (kind: "rebuild" | "rollback") =>
    startTransition(async () => {
      setStatus(null);
      const res =
        kind === "rebuild"
          ? await rebuildReferenceNow(formatSlug)
          : await rollbackReference(rollbackVersionId ?? "");
      setArmed(null);
      setStatus(res.ok ? res.message : `Failed: ${res.error}`);
    });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        aria-describedby={statusId}
        onClick={() => (armed === "rebuild" ? run("rebuild") : setArmed("rebuild"))}
        className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
      >
        {armed === "rebuild"
          ? `Confirm: replace the ${formatSlug} reference`
          : "Rebuild reference now"}
      </button>

      {rollbackVersionId && (
        <button
          type="button"
          disabled={pending}
          aria-describedby={statusId}
          onClick={() => (armed === "rollback" ? run("rollback") : setArmed("rollback"))}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          {armed === "rollback"
            ? `Confirm: go back to ${rollbackVersionLabel}`
            : `Roll back to ${rollbackVersionLabel}`}
        </button>
      )}

      {armed && (
        <button
          type="button"
          disabled={pending}
          onClick={() => setArmed(null)}
          className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink-muted transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Cancel
        </button>
      )}

      <span id={statusId} aria-live="polite" className="text-xs text-ink-muted">
        {pending ? "Working..." : status}
      </span>
    </div>
  );
}
