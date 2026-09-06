"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { formatEastern } from "@/lib/datetime";
import type { BulkSyncState } from "@/lib/league-bulk-sync-types";
import { ProgressBar } from "@/components/manager-pulse/progress-bar";
import { ElapsedClock } from "@/components/manager-pulse/elapsed-clock";

/**
 * Sync all, on My Sleeper Leagues only.
 *
 * The per-row Sync button (components/league-sync-button.tsx) does one league and
 * makes the reader wait. That is right for the public tool, where a visitor is
 * looking at one league they care about. It is wrong for a dashboard where
 * somebody has fourteen leagues and wants all of them current, so this queues
 * them all in one press.
 *
 * WHAT PRESSING IT ACTUALLY DOES
 *   One POST that writes a row per league and returns. Nothing syncs in this
 *   browser and nothing depends on it staying open. That is the fact the notice
 *   leads with, because "you can leave" is only worth saying if it is true, and
 *   readers who have used a progress bar that dies on navigation will assume it
 *   is not.
 *
 * WHAT IT ANNOUNCES, AND WHAT IT DOES NOT
 *   Three announcements: it started, it finished, it failed to start. The
 *   progress line updates on a poll, and routing every poll through a live region
 *   would talk over the reader every few seconds to tell them a number moved by
 *   one. So the counts live in the notice, readable whenever the reader wants
 *   them, and the live region carries only the transitions worth interrupting for.
 *
 * The button uses aria-disabled rather than the disabled attribute, so a reader
 * can still reach it and hear why it is unavailable. That is the same reasoning,
 * and the same choice, as the per-row button.
 */

/**
 * How often to ask the server how far the queue got, while one is running,
 * when the caller does not pass its own `pollIntervalMs`.
 */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * Floor between page refreshes while a batch runs.
 *
 * Standings come from the server render, so seeing a league fill in means asking
 * for a new one. The page re-resolves the league list from Sleeper when it
 * renders, so refreshing on every completed job would spend two Sleeper calls per
 * league to watch a list update. Once every half minute keeps it moving without
 * that.
 */
const REFRESH_FLOOR_MS = 30_000;

type Notice = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
};

export function LeagueSyncAll({
  initialState,
  leagueCount,
  onStateChange,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: {
  initialState: BulkSyncState;
  /** Leagues on the page right now, for the button's accessible name. */
  leagueCount: number;
  /** Lets the surrounding list mark its rows queued the moment this returns. */
  onStateChange?: (state: BulkSyncState) => void;
  /** How often to poll while a batch runs. Defaults to 2000ms. */
  pollIntervalMs?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<BulkSyncState>(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(() =>
    initialState.active ? inProgressNotice(initialState) : null,
  );
  const [announcement, setAnnouncement] = useState("");
  const noticeId = useId();
  const lastRefreshRef = useRef(0);
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const publish = useCallback((next: BulkSyncState) => {
    setState(next);
    onStateChangeRef.current?.(next);
  }, []);

  // Poll only while something is queued. A page with nothing running ticks
  // nothing and makes no requests.
  useEffect(() => {
    if (!state.active) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/leagues/bulk-sync", {
          headers: { "x-requested-with": "ff-beacon" },
        });
        if (!res.ok) return;
        const body = (await res.json()) as { state?: BulkSyncState };
        if (cancelled || !body.state) return;
        const next = body.state;
        publish(next);

        if (!next.active) {
          // Finished. Pull the render that has the new standings in it.
          lastRefreshRef.current = Date.now();
          router.refresh();
          setNotice(completedNotice(next));
          setAnnouncement(completedAnnouncement(next));
          return;
        }
        setNotice(inProgressNotice(next));
        if (Date.now() - lastRefreshRef.current >= REFRESH_FLOOR_MS) {
          lastRefreshRef.current = Date.now();
          router.refresh();
        }
      } catch {
        // A dropped poll is not worth telling anyone about. The queue is on the
        // server and the next tick asks again.
      }
    };

    const id = setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state.active, publish, router, pollIntervalMs]);

  const start = async () => {
    if (submitting || state.active || !state.canStart) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/leagues/bulk-sync", {
        method: "POST",
        headers: { "x-requested-with": "ff-beacon" },
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        queued?: number;
        state?: BulkSyncState;
      };

      if (body.state) publish(body.state);

      if (!res.ok) {
        setNotice({
          tone: res.status === 429 ? "warning" : "error",
          title: res.status === 429 ? "Not yet" : "That did not start",
          body:
            res.status === 429 && body.state?.nextAllowedAt
              ? `Sync all runs once every 12 hours. Yours is available again at ${formatEastern(body.state.nextAllowedAt)}.`
              : (body.error ??
                "We could not start that sync. Try again in a moment."),
        });
        setAnnouncement(
          body.error ?? "Sync all could not start. Try again in a moment.",
        );
        return;
      }

      const queued = body.queued ?? leagueCount;
      setNotice(inProgressNotice(body.state ?? state, queued));
      setAnnouncement(
        `${queued} ${queued === 1 ? "league is" : "leagues are"} queued. They sync a few at a time and you do not need to stay on this page.`,
      );
      // The rows still say "Not yet synced" until the server render catches up,
      // so ask for one now rather than waiting out the first poll.
      lastRefreshRef.current = Date.now();
      router.refresh();
    } catch {
      setNotice({
        tone: "error",
        title: "That did not start",
        body: "The request did not go through. Check your connection and try again.",
      });
      setAnnouncement("Sync all could not start. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || state.active;
  const canPress = !busy && state.canStart;

  const label = submitting
    ? "Starting"
    : state.active
      ? `Syncing ${state.done + state.failed} of ${state.total}`
      : "Sync all leagues";

  const reason = state.active
    ? `Syncing your leagues. ${state.done + state.failed} of ${state.total} done so far.`
    : !state.canStart && state.nextAllowedAt
      ? `Not available yet. The next one is at ${formatEastern(state.nextAllowedAt)}.`
      : null;

  const ariaLabel = canPress
    ? `Sync all ${leagueCount} of your leagues. Runs once every 12 hours.`
    : submitting
      ? "Starting your sync."
      : (reason ?? "Sync all leagues. Currently unavailable.");

  // The cooldown line is the only state with nothing else to say, so it stands in
  // for the notice rather than sitting under it as a second box.
  const cooldownLine =
    !state.active && !state.canStart && state.nextAllowedAt
      ? `Available again at ${formatEastern(state.nextAllowedAt)}.`
      : null;

  return (
    <div className="mb-4 rounded-card border border-line bg-surface/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-purple"
          >
            <RefreshCw
              className={`h-4 w-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Sync all leagues</p>
            <p className="text-xs text-ink-muted">
              {state.active
                ? `${state.done + state.failed} of ${state.total} done.`
                : (cooldownLine ??
                  `Queues all ${leagueCount} ${leagueCount === 1 ? "league" : "leagues"} at once. Once every 12 hours.`)}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-disabled={!canPress}
          aria-label={ariaLabel}
          aria-describedby={notice ? noticeId : undefined}
          onClick={start}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold tracking-tight transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
            canPress
              ? "border-transparent bg-beacon text-black shadow-[0_0_20px_-8px_rgba(168,85,247,0.9)] hover:opacity-90"
              : busy
                ? "border-transparent bg-beacon text-black opacity-70"
                : "cursor-not-allowed border-line-accent bg-base/70 text-ink-subtle"
          }`}
        >
          <RefreshCw
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          {label}
        </button>
      </div>

      {notice && (
        <NoticeBox id={noticeId} notice={notice} state={state} />
      )}

      {/* Start, finish, and failure only. Progress is in the notice above, where
          it can be read on demand instead of announced on a timer. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/* ---------- Notice ---------- */

const TONE = {
  info: {
    box: "border-brand-cyan/40 bg-brand-cyan/10",
    icon: "text-brand-cyan",
    Icon: Info,
  },
  success: {
    box: "border-signal-success/40 bg-signal-success/10",
    icon: "text-signal-success",
    Icon: CheckCircle2,
  },
  warning: {
    box: "border-signal-warning/40 bg-signal-warning/10",
    icon: "text-signal-warning",
    Icon: AlertTriangle,
  },
  error: {
    box: "border-signal-danger/40 bg-signal-danger/10",
    icon: "text-signal-danger",
    Icon: AlertTriangle,
  },
} as const;

/**
 * A titled box with an icon that says what it is.
 *
 * A plain region, not a live one: the live announcements are made by the caller
 * at the three moments worth interrupting for. Giving this box its own live
 * region would repeat them, and would also read the progress line aloud on every
 * poll.
 */
function NoticeBox({
  id,
  notice,
  state,
}: {
  id: string;
  notice: Notice;
  state: BulkSyncState;
}) {
  const tone = TONE[notice.tone];
  const Icon = tone.Icon;
  const showProgress = state.total > 0 && (state.active || state.done > 0);

  return (
    <div
      id={id}
      role="region"
      aria-label={notice.title}
      className={`mt-3 flex items-start gap-3 rounded-card border px-4 py-3 ${tone.box}`}
    >
      <span aria-hidden="true" className={`mt-0.5 shrink-0 ${tone.icon}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{notice.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {notice.body}
        </p>
        {showProgress && (
          <div className="mt-2">
            <ProgressBar
              id={`${id}-bar`}
              done={state.done}
              failed={state.failed}
              total={state.total > 0 ? state.total : null}
              processing={state.processing}
              ariaLabelledBy={`${id}-count`}
            />
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 font-mono text-xs tabular-nums text-ink-muted">
              <span id={`${id}-count`}>
                {state.done} of {state.total} synced
                {state.failed > 0 ? `, ${state.failed} failed` : ""}
              </span>
              {state.active && state.requestedAt ? (
                <ElapsedClock requestedAt={state.requestedAt} running={state.active} />
              ) : null}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Copy ---------- */

/**
 * The worker takes four or five leagues a minute (see MAX_JOBS_PER_RUN in
 * lib/league-bulk-sync.ts). Rather than quote a number that pretends to a
 * precision we do not have, say "a minute or two" for a normal list and "a few
 * minutes" once the list is long enough that a minute or two would be a lie.
 */
function inProgressNotice(state: BulkSyncState, queuedOverride?: number): Notice {
  const n = queuedOverride ?? state.total;
  const howLong =
    n > 8 ? "expect a few minutes" : "most lists finish in a minute or two";
  return {
    tone: "info",
    title: "Syncing is under way",
    body: `${n} ${n === 1 ? "league is" : "leagues are"} in the queue. They sync a few at a time so we do not flood Sleeper, so ${howLong}. You can leave this page: the queue keeps running without you, and your standings will be here when you come back.`,
  };
}

function completedNotice(state: BulkSyncState): Notice {
  if (state.failed > 0) {
    return {
      tone: "warning",
      title: "Synced, with some left over",
      body: `${state.done} of ${state.total} finished. ${state.failed} did not, usually because Sleeper was slow to answer. Press Sync on those rows to try them again.`,
    };
  }
  return {
    tone: "success",
    title: "Your leagues are synced",
    body: `All ${state.total} finished. Every row below now carries your team's tag and where it is projected to finish.`,
  };
}

function completedAnnouncement(state: BulkSyncState): string {
  return state.failed > 0
    ? `Syncing finished. ${state.done} of ${state.total} leagues synced, ${state.failed} did not. Use the Sync button on those rows to try again.`
    : `Syncing finished. All ${state.total} leagues are up to date. The list has been refreshed.`;
}
