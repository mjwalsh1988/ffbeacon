"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Monitor, Smartphone, Globe } from "lucide-react";
import { revokeOtherSessions } from "./actions";

export type SessionRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  refreshed_at: string | null;
  not_after: string | null;
  user_agent: string | null;
  ip: string | null;
  /** True for the row that matches the current request's session. */
  is_current: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const statusId = useId();

  const otherCount = sessions.filter((s) => !s.is_current).length;

  const signOutOthers = () => {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await revokeOtherSessions();
      if (res.ok) {
        setStatus({
          kind: "success",
          message: "All other sessions signed out.",
        });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: res.error });
      }
    });
  };

  return (
    <div className="space-y-4">
      <ul role="list" className="space-y-3">
        {sessions.map((session) => {
          const parsed = parseUserAgent(session.user_agent);
          const lastActive = session.refreshed_at ?? session.updated_at ?? session.created_at;
          return (
            <li
              key={session.id}
              className={`flex flex-col gap-3 rounded-card border p-4 sm:flex-row sm:items-center sm:justify-between ${
                session.is_current
                  ? "border-brand-purple/40 bg-brand-purple/[0.04]"
                  : "border-line bg-surface/60"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
                >
                  <parsed.Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {parsed.label}
                    {session.is_current && (
                      <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {session.ip ? (
                      <>
                        IP {session.ip}
                        <span aria-hidden="true"> · </span>
                      </>
                    ) : null}
                    Last active {formatRelative(lastActive)}
                  </p>
                  {session.created_at && (
                    <p className="mt-0.5 text-[11px] text-ink-subtle">
                      Started {formatAbsolute(session.created_at)}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {otherCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
          <div>
            <p className="text-sm font-medium text-ink">
              {otherCount === 1
                ? "1 other session"
                : `${otherCount} other sessions`}
            </p>
            <p className="text-xs text-ink-muted">
              See an unfamiliar device? Sign it out right away.
            </p>
          </div>
          <button
            type="button"
            onClick={signOutOthers}
            disabled={pending}
            aria-describedby={statusId}
            aria-label="Sign out all other sessions besides this device"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-medium text-ink transition-colors hover:border-signal-danger/60 hover:text-signal-danger disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            {pending ? "Signing out..." : "Sign out other sessions"}
          </button>
        </div>
      )}

      <div
        id={statusId}
        aria-live="polite"
        role="status"
        className="min-h-[1.25rem] text-sm"
      >
        {status.kind === "error" && (
          <p
            role="alert"
            className="rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-signal-danger"
          >
            {status.message}
          </p>
        )}
        {status.kind === "success" && (
          <p className="rounded-card border border-signal-success/40 bg-signal-success/10 px-3 py-2 text-signal-success">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- User agent parsing ---------- */

type ParsedUA = {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

function parseUserAgent(ua: string | null): ParsedUA {
  if (!ua) return { label: "Unknown device", Icon: Globe };

  // Order matters — match the most specific patterns first. Mobile UA
  // strings often also contain Safari/Chrome, so device detection runs
  // before browser detection.
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const Icon = isMobile ? Smartphone : Monitor;

  let device = "Unknown";
  if (/Windows NT/i.test(ua)) device = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) device = "macOS";
  else if (/Android/i.test(ua)) device = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) device = "iOS";
  else if (/Linux/i.test(ua)) device = "Linux";

  let browser = "browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";

  return { label: `${browser} on ${device}`, Icon };
}

/* ---------- Date formatting ---------- */

function formatAbsolute(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "an unknown time ago";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "an unknown time ago";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.round(months / 12);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}
