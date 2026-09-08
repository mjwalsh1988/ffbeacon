"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { BeamMark } from "@/components/beam/beam-mark";
import { BeamPanel } from "@/components/beam/beam-panel";

// The transcript, the composer and every answer-card renderer live in this one
// 567-line chunk, and most readers never open BEAM at all, so it ships as its
// own bundle instead of riding along on every page. `warm()` below already
// fetches it on the first sign of intent (hover, focus, touchstart), so by the
// time a reader actually clicks, the chunk is usually already in. `ssr: false`
// is safe here because the panel it lives in is a client-only overlay to begin
// with, portalled onto `document.body`.
const BeamChat = dynamic(
  () => import("@/components/beam/beam-chat").then((mod) => mod.BeamChat),
  {
    ssr: false,
    // BeamPanel sizes this slot with flex-1 already, so the loading state
    // fills the same box the real chat does and nothing shifts when it swaps
    // in. aria-busy plus a visually hidden label speaks once, from the
    // container the composer will replace, rather than staying silent while
    // the chunk downloads.
    loading: () => (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center" aria-busy="true">
        <span className="sr-only">Loading Ask BEAM</span>
      </div>
    ),
  },
);

/**
 * The header button that opens Ask BEAM, and the panel it opens.
 *
 * Sits immediately right of the site search trigger on every breakpoint, because
 * "ask a question" and "search" are the same reach for the same intent and
 * hiding one of them on a phone would put BEAM behind the hamburger.
 *
 * The panel stays mounted once opened (see beam-panel.tsx), so the conversation
 * survives closing it, and survives navigating: the header is part of the root
 * layout and is not remounted between routes.
 */
export function BeamLauncher({ starters }: { starters: string[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const lastPathname = useRef(pathname);

  const close = useCallback(() => setOpen(false), []);

  // Fetch and DECODE the two mascot files on the first sign of intent, so the
  // click opens a panel whose images are already bitmaps. Without this the first
  // open pays the fetch and the decode inside the same frames that are animating
  // the panel in, which is what made the whole page hitch. decode() does the
  // expensive half off the main thread. Runs once, and only on intent, so a
  // reader who never opens BEAM never downloads its art.
  const [primed, setPrimed] = useState(false);
  const warmed = useRef(false);
  const warm = useCallback(() => {
    if (warmed.current || typeof window === "undefined") return;
    warmed.current = true;
    for (const src of ["/img/beam-avatar.webp", "/img/beam-mascot.webp"]) {
      const img = new window.Image();
      img.src = src;
      void img.decode?.().catch(() => {});
    }
    // Build the panel too, hidden. Same reasoning as the images: do the work
    // before the click rather than inside it.
    setPrimed(true);
  }, []);

  // Close on a completed route change. A link inside an answer navigates the
  // page behind the panel, and a panel that outlives the page it was opened
  // from also holds body scroll locked, which reads as a frozen page.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          warm();
          setOpen(true);
        }}
        onPointerEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ask BEAM a fantasy football question"
        className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-brand-purple/50 bg-brand-purple/10 text-ink transition-colors hover:border-brand-purple hover:bg-brand-purple/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <BeamMark className="h-5 w-5" />
      </button>

      <BeamPanel open={open} prime={primed} onClose={close}>
        <BeamChat starters={starters} />
      </BeamPanel>
    </>
  );
}
