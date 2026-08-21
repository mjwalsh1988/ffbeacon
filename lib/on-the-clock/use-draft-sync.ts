"use client";

/**
 * The draft room's sync clock: one manual press, one unattended refresh, both on
 * the draft's shared schedule rather than on this browser's.
 *
 * What this hook owns:
 *   - the in-flight flag (one sync at a time per tab, whatever started it),
 *   - the two ABSOLUTE instants the room is counting down to, as epoch ms,
 *   - the timer that fires the automatic refresh when its instant arrives,
 *   - backoff after a failed attempt and a floor between attempts.
 *
 * What it deliberately does NOT own: the per-second countdown. It hands out
 * instants, not seconds, so this hook re-renders the room only when a sync
 * actually resolves. The ticking lives inside the small panel that displays it
 * (sync-panel.tsx), which is the only thing that should repaint once a second.
 *
 * The caller supplies `runSync`, which performs the request and applies whatever
 * came back, and returns the server's two windows. The server is the authority:
 * claim_on_the_clock_sync decides in Postgres whether an attempt reaches Sleeper
 * at all, so the worst a wrong clock here can do is spend one request and be told
 * to wait.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** What a completed attempt tells the clock. */
export interface SyncAttempt {
  /** Seconds until a manual press is allowed again, from the server. */
  manualRemainingSeconds: number;
  /** Seconds until the shared automatic refresh is due, from the server. */
  autoRemainingSeconds: number;
  /** The attempt produced nothing usable (network, server error, throttled). */
  failed: boolean;
  /** The server reports automatic refresh is switched off. Stops the loop. */
  autoDisabled: boolean;
  /**
   * Another viewer's sync was already running, so this one was turned away at the
   * lock rather than at the cooldown. Its reported window is measured from BEFORE
   * that sync, which reads as due now, so the schedule ignores it and waits a
   * whole interval instead.
   */
  contended?: boolean;
}

/**
 * Performs the request and applies whatever came back. Returns the server's two
 * windows, or null when the answer arrived for a room the reader has already left
 * and must be discarded whole rather than used to reschedule anything.
 */
export type SyncRunner = (trigger: "auto" | "manual") => Promise<SyncAttempt | null>;

/**
 * The floor under every scheduled gap. Nothing the server can say, and no path
 * through this hook, may put two attempts closer together than this.
 */
const AUTO_MIN_GAP_SECONDS = 5;
/** First wait after a failed automatic attempt; doubles, capped, resets on success. */
const AUTO_BACKOFF_START_SECONDS = 15;
const AUTO_BACKOFF_MAX_SECONDS = 300;
/**
 * Every viewer of one draft counts down to the SAME instant, so left alone they
 * would all fire together and eleven of twelve would be told to wait. Spreading
 * each tab by up to a few seconds means the first one through has usually
 * finished before the rest ask, so they get the fresh answer on their first try
 * instead of a denial.
 *
 * Rolled fresh every cycle rather than once per tab. A fixed offset would hand
 * the same unlucky viewer the Sleeper fan-out every single minute for the whole
 * draft, and hand the same neighbours the losing end of the same race.
 */
const AUTO_JITTER_MS = 4000;

/** Why a press did nothing, for the room to put into its status line. */
export type SyncBlockedReason =
  | { kind: "syncing" }
  | { kind: "cooldown"; seconds: number };

export interface DraftSyncClock {
  /**
   * A sync the reader ASKED FOR is in flight.
   *
   * False throughout an automatic refresh, deliberately. The spinner and the
   * dimmed button are feedback for a press, and an unattended refresh is not one:
   * flipping them twice a minute would make the room look like it was reacting to
   * something the reader did, and would re-render the whole board to do it.
   */
  syncing: boolean;
  /** Epoch ms when a manual press is allowed again. */
  manualReadyAt: number;
  /** Epoch ms of the next automatic refresh, or null when none is scheduled. */
  autoDueAt: number | null;
  /** The tab is in the background, so the automatic refresh is holding. */
  autoPaused: boolean;
  /** The server switched automatic refresh off for this tool. */
  autoStopped: boolean;
  /** Run a manual sync now, if the shared cooldown allows it. */
  syncNow: () => void;
  /** Feed the clock an attempt's result (used for the room's first load too). */
  noteAttempt: (attempt: SyncAttempt) => void;
  /** Forget everything. Called when the room switches to a different draft. */
  reset: () => void;
}

export function useDraftSync({
  active,
  autoEnabled,
  autoRefreshSeconds,
  runSync,
  onBlocked,
}: {
  /**
   * A live room is open on a draft that can still change. False before a league
   * is chosen, in snapshot mode, and once the draft reports complete: a finished
   * draft has nothing left to fetch.
   */
  active: boolean;
  /** The admin toggle. Off means the room only ever syncs when pressed. */
  autoEnabled: boolean;
  /** The room's interval, used as the gap when another viewer held the lock. */
  autoRefreshSeconds: number;
  runSync: SyncRunner;
  /** Called when a press did nothing, so the room can say why out loud. */
  onBlocked?: (reason: SyncBlockedReason) => void;
}): DraftSyncClock {
  const [syncing, setSyncing] = useState(false);
  const [manualReadyAt, setManualReadyAt] = useState(0);
  const [autoDueAt, setAutoDueAt] = useState<number | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [autoStopped, setAutoStopped] = useState(false);

  const runnerRef = useRef<SyncRunner>(runSync);
  useEffect(() => {
    runnerRef.current = runSync;
  }, [runSync]);

  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  }, [onBlocked]);

  // Read inside the schedulers rather than closed over, so changing the interval
  // does not tear down and rebuild a live timer.
  const autoSecondsRef = useRef(autoRefreshSeconds);
  useEffect(() => {
    autoSecondsRef.current = autoRefreshSeconds;
  }, [autoRefreshSeconds]);

  // A ref, not the `syncing` state, because the guard has to hold between two
  // calls in the same tick, before React has re-rendered anything.
  const busyRef = useRef(false);
  const failuresRef = useRef(0);

  const noteAttempt = useCallback((attempt: SyncAttempt) => {
    const now = Date.now();

    // Checked before the manual window is touched. The server answers an auto
    // request against a switched-off feature without looking anything up, so its
    // reported cooldown is zero and would open the button mid-window.
    if (attempt.autoDisabled) {
      setAutoStopped(true);
      setAutoDueAt(null);
      return;
    }

    setManualReadyAt(now + Math.max(0, attempt.manualRemainingSeconds) * 1000);

    if (attempt.failed) {
      failuresRef.current += 1;
      const backoff = Math.min(
        AUTO_BACKOFF_MAX_SECONDS,
        AUTO_BACKOFF_START_SECONDS * 2 ** (failuresRef.current - 1),
      );
      setAutoDueAt(now + backoff * 1000);
      return;
    }
    failuresRef.current = 0;
    // A contended attempt learned nothing: the sync it lost to had not finished,
    // so the window it reports is measured from before that sync and reads as
    // due now. Wait a full interval rather than firing again in five seconds. The
    // picks that sync is fetching arrive over Realtime in the meantime.
    const gap = attempt.contended
      ? autoSecondsRef.current
      : attempt.autoRemainingSeconds;
    setAutoDueAt(now + Math.max(gap, AUTO_MIN_GAP_SECONDS) * 1000);
  }, []);

  const reset = useCallback(() => {
    failuresRef.current = 0;
    setManualReadyAt(0);
    setAutoDueAt(null);
    setAutoStopped(false);
  }, []);

  /**
   * Put the loop back on the clock when there is no answer to schedule from.
   *
   * Every exit from `fire` has to leave a timer armed. The scheduling effect only
   * re-runs when `autoDueAt` moves, so a path that returns without setting it
   * stops the room refreshing itself for the rest of the session, silently.
   */
  const rearm = useCallback(() => {
    setAutoDueAt(Date.now() + AUTO_MIN_GAP_SECONDS * 1000);
  }, []);

  const fire = useCallback(
    async (trigger: "auto" | "manual") => {
      // A sync is already running, usually the very one this tick was waiting on.
      // Come back shortly rather than consuming the timer and arming nothing.
      if (busyRef.current) {
        rearm();
        return;
      }
      busyRef.current = true;
      // Only a press moves the visible state. `busyRef` still holds the "one at a
      // time" guarantee for both triggers; this is about what the room SHOWS.
      const visible = trigger === "manual";
      if (visible) setSyncing(true);
      try {
        const attempt = await runnerRef.current(trigger);
        // A null attempt means the answer belonged to a room the reader has left.
        // There is nothing to schedule from, but there still has to be a timer.
        if (attempt) noteAttempt(attempt);
        else rearm();
      } catch {
        // A runner that threw is a failed attempt like any other: back off rather
        // than leaving the room with no scheduled refresh at all.
        noteAttempt({
          manualRemainingSeconds: 0,
          autoRemainingSeconds: 0,
          failed: true,
          autoDisabled: false,
        });
      } finally {
        busyRef.current = false;
        if (visible) setSyncing(false);
      }
    },
    [noteAttempt, rearm],
  );

  const syncNow = useCallback(() => {
    if (!active) return;
    if (busyRef.current) {
      onBlockedRef.current?.({ kind: "syncing" });
      return;
    }
    const waitMs = manualReadyAt - Date.now();
    if (waitMs > 0) {
      // The button is dimmed but still answers. The wait is spoken here rather
      // than reported as a state that flips at a reader twice a minute.
      onBlockedRef.current?.({ kind: "cooldown", seconds: Math.ceil(waitMs / 1000) });
      return;
    }
    void fire("manual");
  }, [active, fire, manualReadyAt]);

  // A background tab holds. Nobody is reading the board, and a room left open
  // overnight would otherwise keep asking Sleeper about a draft that ended.
  useEffect(() => {
    if (!active) {
      setAutoPaused(false);
      return;
    }
    const apply = () => setAutoPaused(document.visibilityState === "hidden");
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => document.removeEventListener("visibilitychange", apply);
  }, [active]);

  const autoRunning = active && autoEnabled && !autoStopped && !autoPaused;

  // One timeout aimed at the due instant, rather than a ticker asking every
  // second whether it is time yet. Coming back to a backgrounded tab re-runs this
  // with a due time already in the past, so the delay collapses to the jitter and
  // the room refreshes as the reader looks at it.
  useEffect(() => {
    if (!autoRunning || autoDueAt === null) return;
    // Rolled here, so every cycle draws a new offset and the fan-out rotates
    // between the viewers instead of always landing on the same one.
    const delay = Math.max(0, autoDueAt - Date.now()) + Math.random() * AUTO_JITTER_MS;
    const timer = setTimeout(() => {
      void fire("auto");
    }, delay);
    return () => clearTimeout(timer);
  }, [autoRunning, autoDueAt, fire]);

  return {
    syncing,
    manualReadyAt,
    autoDueAt,
    autoPaused,
    autoStopped,
    syncNow,
    noteAttempt,
    reset,
  };
}
