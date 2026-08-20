"use client";

import { useEffect, useRef } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Where a view swap should leave the reader.
 *
 *  - `"top"`: the top of the page, and no focus move. For a step that opens
 *    somewhere new and handles its own focus.
 *  - `{ id }`: the element with that id, scrolled to and focused. For a step
 *    that answers a question the reader just asked. Search results belong
 *    here: someone who types a Sleeper username is looking for their leagues,
 *    and the top of the page is the form they have finished with, not the
 *    answer they asked for.
 *  - `{ focusId }` with no `id`: the top of the page, with focus moved to the
 *    named element. For a step that opens somewhere new but starts below the
 *    page top.
 *  - `null`: leave the reader where they are. For a transition that manages
 *    its own destination, or one that is really an exit rather than an arrival.
 */
export type StepScrollTarget = "top" | { id?: string; focusId?: string } | null;

/**
 * Moves the reader when `key` changes, skipping the first render.
 *
 * For the tools that replace the view from their own state instead of
 * navigating. On The Clock, Signal Scout, and the league lookups in FAAB and
 * Signal Check are each one route: searching or picking swaps out the panels
 * but the URL never changes, so neither the browser nor
 * components/route-scroll-reset.tsx has any reason to move the scroll
 * position. Someone who scrolled a long way down a league list to reach the
 * one they wanted lands in the new view still at that depth, looking at the
 * middle of something they have never seen.
 *
 * The target is the whole point, and it is not always the top. A wizard step
 * that produces results should land on the results; only a step that opens a
 * new destination should land at the top. Pass `null` for a change that should
 * not move anyone.
 *
 * Scroll and focus move together. A swap that only scrolls serves the readers
 * who can see it and strands everyone else: the control that was pressed has
 * usually just been unmounted, so focus falls back to the top of the document
 * and a screen reader announces nothing at all. Moving focus to the same place
 * the page scrolled to keeps the two audiences on the same step. Focus is set
 * with `preventScroll` because the scroll has already been decided here, and a
 * plain `focus()` would fight it.
 *
 * "top" is instant, because it stands in for a page load and a page load does
 * not animate. An element target scrolls smoothly (unless the reader asked for
 * reduced motion): it is usually a short hop within the same panel, and the
 * movement is what tells them the page answered.
 */
export function useStepScroll(key: string | number | null, target: StepScrollTarget) {
  const previous = useRef(key);
  const latestTarget = useRef(target);

  // Kept in a ref so the scroll effect can read the target without listing an
  // object in its deps, and synced in an effect of its own rather than during
  // render. Declared first, so on the commit where the key changed this has
  // already stored the target computed from the new key.
  useEffect(() => {
    latestTarget.current = target;
  });

  useEffect(() => {
    if (key === previous.current) return;
    previous.current = key;
    if (key === null) return;

    const destination = latestTarget.current;
    if (destination === null) return;

    const scrollId = destination === "top" ? undefined : destination.id;
    const focusId =
      destination === "top" ? undefined : (destination.focusId ?? destination.id);

    // Defer a frame so the freshly rendered section is laid out before we
    // measure it. The DOM is committed by now but layout can lag a tick.
    const raf = requestAnimationFrame(() => {
      if (scrollId) {
        const element = document.getElementById(scrollId);
        if (element) {
          element.scrollIntoView({
            block: "start",
            behavior: window.matchMedia(REDUCED_MOTION_QUERY).matches ? "auto" : "smooth",
          });
        } else {
          // The target should always be in the DOM by now. If it is not, the
          // top is still a better answer than leaving the reader mid-page,
          // which is the whole failure this exists to prevent.
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        }
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }

      if (!focusId) return;
      const focusTarget = document.getElementById(focusId);
      if (!focusTarget) return;
      // Containers and headings are not focusable on their own. tabindex="-1"
      // makes one a valid focus target without adding it to the tab order, so
      // Tab from here still goes to the first real control inside it.
      if (!focusTarget.hasAttribute("tabindex")) {
        focusTarget.setAttribute("tabindex", "-1");
      }
      focusTarget.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [key]);
}
