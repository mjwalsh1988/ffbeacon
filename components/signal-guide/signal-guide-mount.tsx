"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { resolveGuidePageKey } from "@/lib/guide/registry";
import {
  setSignalGuideAvailable,
  subscribeToSignalGuideOpen,
} from "@/lib/guide/open-guide";
import type { GuidePageContent } from "@/lib/guide/types";
import { GuidePanel } from "./guide-panel";

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

  useEffect(() => {
    const pageKey = pathname ? resolveGuidePageKey(pathname) : null;
    // Reset on navigation so the previous page's button never lingers.
    setContent(null);
    setPanelOpen(false);
    setFocusRequest(null);
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
            setFocusRequest(null);
            setPanelOpen(true);
          }}
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

      <GuidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        content={content}
        focusHeading={focusRequest?.heading ?? null}
        focusNonce={focusRequest?.nonce ?? 0}
      />
    </>
  );
}
