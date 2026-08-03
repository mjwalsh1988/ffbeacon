"use client";

import { useCallback, useEffect, useRef } from "react";

/** How long a pointer has to rest on a link before we treat it as intent. */
const DWELL_MS = 200;

/**
 * Handlers that start a league's sync when the user looks like they are about
 * to open it.
 *
 * Opening a cold league means waiting on Sleeper. The league list knows the
 * candidates a beat before the click does, so hovering or tabbing onto a row
 * starts that work early. By the time the page renders, the sync is usually
 * done and its 60-minute cache answers instead.
 *
 * Three things keep this from turning a list into a stampede:
 *   - A dwell delay, so sweeping the cursor across rows fires nothing.
 *   - One request per league per mount, tracked here.
 *   - The endpoint itself no-ops on a league that is already fresh.
 *
 * Keyboard focus fires immediately and without the dwell: arriving on a link by
 * tab is deliberate in a way that passing a cursor over it is not.
 *
 * Failures are silent on purpose. This is an optimization; if it does not
 * happen, the page still loads exactly as it did before.
 */
export function useLeagueWarmup(sleeperLeagueId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const send = useCallback(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    void fetch(`/api/leagues/${encodeURIComponent(sleeperLeagueId)}/warm`, {
      method: "POST",
      headers: { "x-requested-with": "ff-beacon" },
      keepalive: true,
    }).catch(() => {
      /* optimization only */
    });
  }, [sleeperLeagueId]);

  const onPointerEnter = useCallback(() => {
    if (sentRef.current || timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      send();
    }, DWELL_MS);
  }, [send]);

  const onPointerLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { onPointerEnter, onPointerLeave, onFocus: send };
}
