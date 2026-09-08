"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { HelpCircle } from "lucide-react";
import { resolveGuidePageKey } from "@/lib/guide/registry";
import {
  setSignalGuideAvailable,
  subscribeToSignalGuideOpen,
} from "@/lib/guide/open-guide";
import type { GuidePageContent } from "@/lib/guide/types";

// The guide panel (search, the FAQ/terms accordions, the submit-a-question
// form) is its own chunk rather than riding along in the root layout, because
// most readers on most pages never open it. It is included in the tree only
// once `primed` or `panelOpen` is true below, so a reader who never touches
// the trigger never fetches it. `ssr: false` is safe: the panel is a
// client-only overlay portalled onto `document.body`.
const GuidePanel = dynamic(
  () => import("./guide-panel").then((mod) => mod.GuidePanel),
  { ssr: false },
);

/**
 * Stand-in for the panel while its chunk is still loading. Only ever shown
 * while `panelOpen` is true (see the `Suspense` fallback below, which is null
 * while merely primed), sized to match GuidePanel's own dialog frame so
 * nothing shifts when the real panel takes its place.
 */
function GuideLoadingFallback() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      // A dialog needs a name. Without one this is announced as an unnamed
      // dialog for however long the chunk takes, and the sr-only text below is
      // its content rather than its label. The real GuidePanel names itself, so
      // this only has to hold the name steady across the swap.
      aria-label="Signal Guide"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-stretch sm:justify-end"
    >
      <div className="flex h-[85vh] w-full max-w-2xl items-center justify-center rounded-t-modal border border-line bg-surface-elevated shadow-2xl shadow-black/60 sm:h-full sm:max-w-md sm:rounded-none sm:rounded-l-modal sm:border-y-0 sm:border-r-0">
        <span className="sr-only">Loading the Signal Guide</span>
      </div>
    </div>
  );
}

/**
 * Site-wide Signal Guide launcher. Mounted once in the root layout.
 *
 * On every navigation it resolves the current pathname to a guide page_key and
 * fetches that page's published content. The floating "?" button only renders
 * when the page actually has published entries, so a page with no guide content
 * shows nothing at all (per the product rule). Anchored bottom-LEFT so it never
 * collides with the Discord CTA (bottom-right).
 */
export function SignalGuideMount() {
  const pathname = usePathname();
  const [content, setContent] = useState<GuidePageContent | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  /**
   * The entry a deep link asked for, and a nonce so asking for the SAME entry
   * twice still counts as a new request. Without the nonce, a reader who
   * opened the guide at Positional WAR, closed it, and pressed the same
   * control again would pass an unchanged prop and the panel would open at
   * the top.
   */
  const [focusRequest, setFocusRequest] = useState<{ heading: string | null; nonce: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);

  // True from the first sign of intent (hover, focus, touch, or an actual
  // open) onward, for THIS page. Only once this is true does GuidePanel enter
  // the tree at all, which is what defers its chunk: a reader who never comes
  // near the trigger never fetches it.
  const [primed, setPrimed] = useState(false);
  const warm = useCallback(() => setPrimed(true), []);

  useEffect(() => {
    const pageKey = pathname ? resolveGuidePageKey(pathname) : null;
    // Reset on navigation so the previous page's button never lingers.
    setContent(null);
    setPanelOpen(false);
    setFocusRequest(null);
    setPrimed(false);
    setSignalGuideAvailable(false);
    if (!pageKey) return;

    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/guide/${pageKey}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<GuidePageContent> & {
          page: GuidePageContent["page"] | null;
        };
        if (cancelled) return;
        if (
          data.page &&
          ((data.questions?.length ?? 0) > 0 || (data.terms?.length ?? 0) > 0)
        ) {
          setContent({
            page: data.page,
            questions: data.questions ?? [],
            terms: data.terms ?? [],
          });
          // Publish availability so an in-page control ("What is Positional
          // WAR?") can render as a real opener rather than a link away.
          setSignalGuideAvailable(true);
        }
      } catch {
        // Network error or aborted navigation: leave the button hidden.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pathname]);

  // Deep-link requests from anywhere on the page. Registered for as long as
  // the mount lives, and the availability flag is cleared on unmount so a
  // caller never believes an opener exists when none does.
  useEffect(() => {
    const unsubscribe = subscribeToSignalGuideOpen((request) => {
      warm();
      setFocusRequest(request);
      setPanelOpen(true);
    });
    return () => {
      unsubscribe();
      setSignalGuideAvailable(false);
    };
  }, []);

  if (!content) return null;

  return (
    <>
      {/* Fixed to the viewport and pinned bottom-left, which from lg up is
          where the navigation rail is. The extra left padding clears it, and
          it tracks the rail's width so collapsing the rail moves the trigger
          with it. The Discord bubble needs no equivalent: it sits bottom-right,
          away from the rail. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-start px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 lg:pl-[calc(var(--app-rail-w)+2rem)]">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            warm();
            setFocusRequest(null);
            setPanelOpen(true);
          }}
          onPointerEnter={warm}
          onFocus={warm}
          onTouchStart={warm}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          aria-label={`Open the Signal Guide for ${content.page.title}: help and definitions for this page`}
          className="pointer-events-auto inline-flex min-h-[44px] items-center gap-2 rounded-full border border-brand-cyan/40 bg-surface/95 py-2 pl-2 pr-3 text-sm font-semibold text-ink shadow-lg backdrop-blur transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-purple to-brand-cyan text-black">
            <HelpCircle aria-hidden="true" className="h-4 w-4" />
          </span>
          <span>Guide</span>
        </button>
      </div>

      {(primed || panelOpen) && (
        // The fallback is null while merely primed (nothing should appear
        // before a real open), and only becomes the reserved-height, aria-busy
        // placeholder once panelOpen is actually true. Passing `loading` to
        // `dynamic()` instead would show it the moment the trigger is merely
        // hovered, since that option cannot see `panelOpen`.
        <Suspense fallback={panelOpen ? <GuideLoadingFallback /> : null}>
          <GuidePanel
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            content={content}
            focusHeading={focusRequest?.heading ?? null}
            focusNonce={focusRequest?.nonce ?? 0}
          />
        </Suspense>
      )}
    </>
  );
}
