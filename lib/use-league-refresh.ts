"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Force-refreshing a league from Sleeper, as a hook so the control can live
 * wherever it belongs rather than wherever the fetch was written. It is a row
 * in the league's section of the navigation rail today; it used to be a button
 * in the deep view's header.
 *
 * Refresh is deliberately available to everyone, guests included. The server
 * protects it with a shared per-league cooldown rather than an auth check, and
 * lib/security/league-refresh-public.test.ts guards that on every CI run. This
 * hook therefore has no notion of who is asking; do not add one here, because a
 * client-side gate would be decoration over a route that intentionally has none.
 *
 * On success the page is refreshed so the freshly synced rows render. A 429
 * comes back as the server's own "try again in N seconds" message, and any
 * other failure as the reason the server gave.
 */
export type LeagueRefreshStatus =
  | { kind: "idle" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function useLeagueRefresh(sleeperLeagueId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<LeagueRefreshStatus>({ kind: "idle" });

  const refresh = useCallback(() => {
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
            /* the status line is the message when the body is not JSON */
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
  }, [sleeperLeagueId, router]);

  /** What a screen reader should hear about the last attempt. */
  const announcement = pending
    ? "Refresh in progress."
    : status.kind === "success"
      ? "Refresh complete. Reloading."
      : status.kind === "error"
        ? `Refresh failed: ${status.message}`
        : "";

  return { refresh, pending, status, announcement };
}
