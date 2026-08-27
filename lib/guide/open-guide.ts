"use client";

/**
 * Opening the Signal Guide from anywhere on the page, at a named entry.
 *
 * WHY THIS EXISTS. The guide is mounted once in the root layout
 * (components/signal-guide/signal-guide-mount.tsx) and owns its own open
 * state, so a card elsewhere on the page had no way to say "open the guide at
 * Positional WAR". The only honest thing such a card could do was link to a
 * page where the term happened to surface, which navigates a reader away from
 * the thing they were reading to explain a word in it.
 *
 * The mechanism is a tiny module-level bus rather than a context, because the
 * mount and the callers are in different subtrees of the layout and there is
 * no common provider between them that is not the root layout itself.
 *
 * Two directions of traffic:
 *   - The MOUNT publishes whether a guide exists for the current page, so a
 *     caller can render a real in-place control when one does and fall back to
 *     a plain link when one does not. A control that silently does nothing is
 *     worse than a link that navigates.
 *   - A CALLER requests an open at a heading. The mount opens its panel and
 *     hands the heading to the panel, which expands that entry and moves focus
 *     to it.
 *
 * Headings are matched case-insensitively against `guide_entries.heading`,
 * which is the string an admin edits at /admin/signal-guide. A heading that
 * matches nothing opens the panel at the top, which is the same thing the "?"
 * button does, so a renamed entry degrades to the old behaviour rather than
 * breaking the control.
 */

import { useSyncExternalStore } from "react";

type OpenRequest = { heading: string | null; nonce: number };

type Listeners = {
  availability: Set<() => void>;
  open: Set<(request: OpenRequest) => void>;
};

const listeners: Listeners = { availability: new Set(), open: new Set() };

let available = false;
let nonce = 0;

/** Called by the mount whenever it learns the current page has (or lacks) a guide. */
export function setSignalGuideAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  for (const notify of listeners.availability) notify();
}

/** Called by the mount to receive open requests for as long as it is mounted. */
export function subscribeToSignalGuideOpen(
  handler: (request: OpenRequest) => void,
): () => void {
  listeners.open.add(handler);
  return () => {
    listeners.open.delete(handler);
  };
}

/**
 * Ask the guide to open, optionally at a named entry.
 *
 * Returns false when nothing is listening, which is the caller's cue that it
 * should have rendered its fallback instead. In practice a caller that used
 * `useSignalGuideAvailable()` never sees false, but the return value keeps the
 * two facts (is it available, did it open) from drifting apart.
 */
export function openSignalGuide(heading?: string): boolean {
  if (listeners.open.size === 0) return false;
  nonce += 1;
  const request: OpenRequest = { heading: heading ?? null, nonce };
  for (const handler of listeners.open) handler(request);
  return true;
}

function subscribeAvailability(notify: () => void): () => void {
  listeners.availability.add(notify);
  return () => {
    listeners.availability.delete(notify);
  };
}

const getSnapshot = () => available;
/**
 * Server snapshot is always false, so a component that branches on this
 * renders its fallback during SSR and upgrades on hydration. Returning `true`
 * here would render an in-place control into HTML that has no listener yet.
 */
const getServerSnapshot = () => false;

/** Whether the current page has a Signal Guide the reader can be sent into. */
export function useSignalGuideAvailable(): boolean {
  return useSyncExternalStore(subscribeAvailability, getSnapshot, getServerSnapshot);
}
