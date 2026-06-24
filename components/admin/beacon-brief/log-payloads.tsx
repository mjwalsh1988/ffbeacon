"use client";

import { useState } from "react";
import { getBeaconBriefLogPayload } from "@/app/admin/beacon-brief/actions";

// tabIndex={0} makes the scrollable payload keyboard-reachable so a keyboard-only
// user can scroll JSON taller than the max-height; the aria-label names it on focus.
const preClass =
  "mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-card border border-line bg-base p-3 font-mono text-xs text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const summaryClass = "cursor-pointer text-sm font-medium text-brand-cyan";

/**
 * Lazy disclosures for a Beacon Brief log row's request/response payloads.
 *
 * The server list query only tells us WHICH payloads exist (hasReq/hasRes); the
 * heavy jsonb itself is fetched once, the first time the admin expands either
 * disclosure, via the getBeaconBriefLogPayload server action. This keeps the
 * logs page light when many rows are never opened.
 */
export function LogPayloads({
  id,
  hasReq,
  hasRes,
}: {
  id: string;
  hasReq: boolean;
  hasRes: boolean;
}) {
  const [payload, setPayload] = useState<{
    request: string | null;
    response: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function ensureLoaded() {
    if (payload || loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await getBeaconBriefLogPayload(id);
      setPayload(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open) void ensureLoaded();
  };

  const bodyFor = (which: "request" | "response"): string => {
    if (error) return "Could not load this payload. Close and reopen to retry.";
    if (!payload) return "Loading...";
    return payload[which] ?? "";
  };

  if (!hasReq && !hasRes) return null;

  return (
    <>
      {hasReq && (
        <details className="mt-2" onToggle={onToggle}>
          <summary className={summaryClass}>Prompt / request</summary>
          <pre
            className={preClass}
            tabIndex={0}
            aria-label="Prompt / request payload"
            aria-busy={loading}
          >
            {bodyFor("request")}
          </pre>
        </details>
      )}
      {hasRes && (
        <details className="mt-2" onToggle={onToggle}>
          <summary className={summaryClass}>Response</summary>
          <pre
            className={preClass}
            tabIndex={0}
            aria-label="Response payload"
            aria-busy={loading}
          >
            {bodyFor("response")}
          </pre>
        </details>
      )}
    </>
  );
}
