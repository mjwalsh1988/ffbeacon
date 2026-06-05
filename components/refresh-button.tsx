"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type RefreshButtonProps = {
  /** Sleeper league id used in the POST URL. */
  sleeperLeagueId: string;
  /** Visible only after the server confirms admin/commissioner. The
   * server is the source of truth — this prop is a hint, not a security
   * boundary. The API endpoint re-validates auth. */
  isAuthorized: boolean;
};

/**
 * Admin / commissioner force-refresh button.
 *
 * Behavior:
 * - Hidden when `isAuthorized` is false (server determines this)
 * - On click: POST /api/leagues/[id]/refresh
 * - Loading state with aria-live announcement
 * - On success: router.refresh() to re-render the page with fresh data
 * - On rate-limit (429): inline message "Try again in N seconds"
 * - On other error: inline message with the server's reason
 *
 * The endpoint enforces a 60s/league rate limit. This component does
 * NOT pre-check the limit client-side — we let the server be the
 * source of truth so refreshing the page can never bypass it.
 */
export function RefreshButton({ sleeperLeagueId, isAuthorized }: RefreshButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "success" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  if (!isAuthorized) return null;

  const handleClick = () => {
    startTransition(async () => {
      setStatus({ kind: "idle" });
      try {
        const res = await fetch(`/api/leagues/${sleeperLeagueId}/refresh`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Custom header is the CSRF defense the API expects.
            "x-requested-with": "ff-beacon",
          },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          let message = `Refresh failed (${res.status})`;
          try {
            const body = await res.json();
            if (body && typeof body.error === "string") message = body.error;
          } catch {
            /* ignore */
          }
          setStatus({ kind: "error", message });
          return;
        }
        setStatus({ kind: "success" });
        router.refresh();
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Refresh failed",
        });
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex min-h-10 items-center gap-2 rounded-card border border-brand-purple/40 bg-brand-purple/10 px-3 py-2 text-sm font-medium text-brand-purple transition-colors hover:bg-brand-purple/20 focus-visible:outline-2 focus-visible:outline-brand-purple disabled:cursor-wait disabled:opacity-60"
        aria-label={pending ? "Refreshing league" : "Force refresh from Sleeper"}
      >
        <RefreshIcon spinning={pending} />
        {pending ? "Refreshing..." : "Refresh"}
      </button>
      <p className="sr-only" aria-live="polite" role="status">
        {pending
          ? "Refresh in progress."
          : status.kind === "success"
            ? "Refresh complete. Reloading."
            : status.kind === "error"
              ? `Refresh failed: ${status.message}`
              : ""}
      </p>
      {status.kind === "error" && !pending && (
        <p className="text-xs text-signal-danger" role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? "animate-spin" : ""}
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
