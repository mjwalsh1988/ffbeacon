"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

/**
 * One sync at a time, across every league on the page.
 *
 * A league nobody has opened has no Power Pulse row, so its row says "Not yet
 * synced" and offers a Sync button. Pressing it runs the same pulse the deep
 * view runs: a full Sleeper round trip plus the derived passes. A reader with
 * twenty unsynced leagues in front of them will press twenty buttons, so the
 * page holds a queue of exactly one and a cooldown after it.
 *
 * This is presentation. The real limit is the per-visitor claim in
 * app/api/leagues/[league_id]/sync/route.ts, because anything enforced only in
 * a browser is not enforced. What this buys is that the reader is told which
 * button is unavailable and for how long, instead of discovering it by pressing
 * one and getting an error.
 *
 * A failed sync keeps the cooldown, then re-offers the button as "Try again".
 * The alternative, burning the attempt permanently on a network blip, punishes
 * the reader for our failure.
 */

/** Gap between the end of one sync and the start of the next. Matches the
 *  p_cooldown_seconds default on try_claim_league_sync. */
const COOLDOWN_SECONDS = 5;

export type LeagueSyncPhase =
  /** Nothing has happened; the button is live. */
  | "idle"
  /** This league is the one currently syncing. */
  | "syncing"
  /** A different league is syncing right now. */
  | "blocked"
  /** Between syncs. `secondsRemaining` counts down. */
  | "cooldown"
  /** This league failed and its cooldown has elapsed, so a retry is offered. */
  | "retry";

export type LeagueSyncView = {
  phase: LeagueSyncPhase;
  /** Seconds left on the cooldown. 0 outside a cooldown. */
  secondsRemaining: number;
  /** Last failure message for THIS league, if it has one. */
  error: string | null;
  /** Name of whichever league is holding the queue, for a "waiting on" line. */
  blockingLeagueName: string | null;
  /**
   * This league already synced successfully in this session.
   *
   * Worth knowing even though a successful sync normally replaces the pending
   * pill with a real tag: Power Pulse writes nothing for a league with no
   * unplayed games left, so a league can sync cleanly and still have no
   * standing. Offering the button again there would spend another slot to reach
   * the same answer, so the caller says so in words instead.
   */
  didSucceed: boolean;
  canStart: boolean;
};

type QueueContext = {
  activeLeagueId: string | null;
  activeLeagueName: string | null;
  readyAt: number;
  errors: Record<string, string>;
  succeeded: Set<string>;
  now: number;
  start: (leagueId: string, leagueName: string) => void;
};

const Ctx = createContext<QueueContext | null>(null);

export function LeagueSyncProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [activeLeagueName, setActiveLeagueName] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [succeeded, setSucceeded] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Guards a second click that lands in the same tick as the first, before
  // React has committed activeLeagueId.
  const inFlightRef = useRef(false);

  // The clock only runs while something is pending. An idle page ticks nothing.
  useEffect(() => {
    const pending = activeLeagueId !== null || readyAt > Date.now();
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => clearInterval(id);
  }, [activeLeagueId, readyAt]);

  const start = useCallback(
    (leagueId: string, leagueName: string) => {
      if (inFlightRef.current) return;
      if (Date.now() < readyAt) return;
      inFlightRef.current = true;
      setActiveLeagueId(leagueId);
      setActiveLeagueName(leagueName);
      setErrors((prev) => {
        if (!(leagueId in prev)) return prev;
        const next = { ...prev };
        delete next[leagueId];
        return next;
      });
      setAnnouncement(`Syncing ${leagueName}. This can take a few seconds.`);

      void (async () => {
        let failure: string | null = null;
        try {
          const res = await fetch(
            `/api/leagues/${encodeURIComponent(leagueId)}/sync`,
            {
              method: "POST",
              headers: { "x-requested-with": "ff-beacon" },
            },
          );
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            retryInSeconds?: number;
            reason?: string;
          };

          if (res.status === 429) {
            failure =
              body.reason === "in_flight"
                ? "Another league is still syncing. Try again in a moment."
                : `Too many syncs at once. Try again in ${body.retryInSeconds ?? COOLDOWN_SECONDS} seconds.`;
          } else if (!res.ok) {
            failure =
              body.error ??
              "Sleeper did not answer. This usually clears on its own.";
          }
        } catch {
          failure = "The request did not go through. Check your connection.";
        }

        // Cooldown starts when the attempt ends, pass or fail, mirroring the
        // server, which stamps released_at in a finally.
        setReadyAt(Date.now() + COOLDOWN_SECONDS * 1000);
        setActiveLeagueId(null);
        setActiveLeagueName(null);
        inFlightRef.current = false;

        if (failure) {
          setErrors((prev) => ({ ...prev, [leagueId]: failure as string }));
          setAnnouncement(
            `${leagueName} did not sync. ${failure} You can try again in ${COOLDOWN_SECONDS} seconds.`,
          );
        } else {
          setSucceeded((prev) => new Set(prev).add(leagueId));
          setAnnouncement(
            `${leagueName} synced. Refreshing your standing for that league.`,
          );
          // The row's status comes from the server render, so ask for a fresh
          // one. A soft refresh, so this provider's state and the reader's
          // scroll position both survive it.
          router.refresh();
        }
      })();
    },
    [readyAt, router],
  );

  const value = useMemo<QueueContext>(
    () => ({
      activeLeagueId,
      activeLeagueName,
      readyAt,
      errors,
      succeeded,
      now,
      start,
    }),
    [activeLeagueId, activeLeagueName, readyAt, errors, succeeded, now, start],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* One region for the whole list. Per-button live regions would talk over
          each other the moment two buttons changed state in the same tick. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Ctx.Provider>
  );
}

/**
 * What one league's Sync button should be doing right now. Safe to call outside
 * a provider: it reports a permanently idle button that does nothing, so a
 * surface that has not opted in cannot crash.
 */
export function useLeagueSync(leagueId: string): LeagueSyncView {
  const ctx = useContext(Ctx);

  return useMemo<LeagueSyncView>(() => {
    if (!ctx) {
      return {
        phase: "idle",
        secondsRemaining: 0,
        error: null,
        blockingLeagueName: null,
        didSucceed: false,
        canStart: false,
      };
    }

    const error = ctx.errors[leagueId] ?? null;
    const secondsRemaining = Math.max(
      0,
      Math.ceil((ctx.readyAt - ctx.now) / 1000),
    );

    let phase: LeagueSyncPhase;
    if (ctx.activeLeagueId === leagueId) phase = "syncing";
    else if (ctx.activeLeagueId !== null) phase = "blocked";
    else if (secondsRemaining > 0) phase = "cooldown";
    else if (error) phase = "retry";
    else phase = "idle";

    return {
      phase,
      secondsRemaining,
      error,
      blockingLeagueName: phase === "blocked" ? ctx.activeLeagueName : null,
      didSucceed: ctx.succeeded.has(leagueId),
      canStart: phase === "idle" || phase === "retry",
    };
  }, [ctx, leagueId]);
}

/** The starter, split out so `useLeagueSync` can stay a pure derived value and
 *  not re-create a closure per render. */
export function useStartLeagueSync() {
  const ctx = useContext(Ctx);
  return useCallback(
    (leagueId: string, leagueName: string) => {
      ctx?.start(leagueId, leagueName);
    },
    [ctx],
  );
}
