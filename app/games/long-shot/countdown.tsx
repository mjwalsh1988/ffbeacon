"use client";

/**
 * The Hurry-Up countdown (plan 8.3). Display only: the server owns the clock.
 * Starts from the remainingMs the server returned and calls onExpire once at
 * zero, which submits a timeout.
 *
 * The visible figure (the clock badge) is ordinary text outside any live
 * region. The timer region beside it speaks exactly three times: on prompt
 * load ("Prompt 2 of 5, 30 seconds"), at 10 seconds left and at 5.
 */

import { useEffect, useRef, useState } from "react";
import { ClockBadge } from "@/components/long-shot/clock-badge";

export function timerAnnouncement(seconds: number, position: number, promptCount: number, loaded: boolean): string | null {
  if (!loaded) return `Prompt ${position} of ${promptCount}, ${seconds} seconds`;
  if (seconds === 10) return "10 seconds left";
  if (seconds === 5) return "5 seconds left";
  return null;
}

export function Countdown({
  remainingMs,
  limitSeconds,
  position,
  promptCount,
  onExpire,
}: {
  remainingMs: number;
  limitSeconds: number;
  position: number;
  promptCount: number;
  onExpire: () => void;
}) {
  const [deadline] = useState(() => Date.now() + remainingMs);
  const [seconds, setSeconds] = useState(() => Math.ceil(remainingMs / 1000));
  // Mounted empty and filled a moment later: most screen readers ignore a live
  // region that arrives with its text already in it.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const t = setTimeout(
      () => setAnnouncement(timerAnnouncement(Math.ceil(remainingMs / 1000), position, promptCount, false) ?? ""),
      150,
    );
    return () => clearTimeout(t);
    // Once per prompt; the component is keyed per prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const firedRef = useRef(false);
  const lastAnnounced = useRef<number>(Math.ceil(remainingMs / 1000));
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  });

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(left);
      if (left !== lastAnnounced.current && (left === 10 || left === 5)) {
        lastAnnounced.current = left;
        setAnnouncement(timerAnnouncement(left, position, promptCount, true) ?? "");
      }
      if (left === 0 && !firedRef.current) {
        firedRef.current = true;
        expireRef.current();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, position, promptCount]);

  return (
    <>
      <ClockBadge seconds={seconds} limit={limitSeconds} />
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
