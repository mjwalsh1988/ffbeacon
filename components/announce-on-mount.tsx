"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Makes a live region announce text it was rendered WITH.
 *
 * Screen readers announce a CHANGE inside a live region, and a region that
 * arrives in the DOM already holding its sentence has not changed, so NVDA and
 * VoiceOver routinely say nothing at all. The usual fix, mounting the region
 * empty and filling it a moment later, would leave the server HTML without the
 * sentence, which a crawler and a slow connection both need.
 *
 * So the text is server-rendered as normal, and shortly after hydration its
 * node is swapped for an identical one (a new React key). Nothing moves on
 * screen, and the region sees a fresh text node inserted, which is the change
 * it announces. Place it INSIDE the role="status" element, and never inside an
 * aria-busy="true" ancestor, which tells a screen reader to hold announcements.
 */
export function AnnounceOnMount({
  children,
  delayMs = 100,
}: {
  children: ReactNode;
  delayMs?: number;
}) {
  const [pass, setPass] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setPass(1), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  return <span key={pass}>{children}</span>;
}
