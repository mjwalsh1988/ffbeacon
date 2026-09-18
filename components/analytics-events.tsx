"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  AUTH_EVENT_COOKIE,
  currentSection,
  parseAuthEventCookie,
  trackEvent,
} from "@/lib/analytics";

/**
 * Site-wide analytics that belong to no single component. Renders nothing.
 *
 * DISCORD JOINS ARE COUNTED BY ONE LISTENER, NOT PER BUTTON. There are more
 * than a dozen links to /join (the floating pill, the section CTA, the hero,
 * the footer, inline links on half the guides) and several of them are server
 * components that cannot hold an onClick. One click listener on the document
 * sees every one of them, including any added later, and cannot drift out of
 * sync with them. Keyboard activation of a link dispatches a click, so Enter
 * is counted the same as a tap.
 *
 * SIGN-INS ARE REPORTED FROM A COOKIE. OAuth and magic links finish in a route
 * handler (`/auth/callback`) that redirects, so no client code runs at the
 * moment the sign-in succeeds. The route leaves a five-minute, identity-free
 * cookie saying what happened, and the first page after the redirect reads it,
 * reports it once and deletes it.
 */
export function AnalyticsEvents() {
  const pathname = usePathname();

  useEffect(() => {
    const raw = readCookie(AUTH_EVENT_COOKIE);
    if (raw === null) return;
    // Deleted before reporting, so a failure in between cannot report it twice.
    document.cookie = `${AUTH_EVENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    const parsed = parseAuthEventCookie(raw);
    if (!parsed) return;
    trackEvent(parsed.name, { method: parsed.method });
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || url.pathname !== "/join") return;
      trackEvent("join_discord_click", { cta_location: currentSection() });
    }
    // A middle-click opens the link in a new tab and fires auxclick, not click.
    function onAuxClick(event: MouseEvent) {
      if (event.button === 1) onClick(event);
    }
    // Capture phase, so a handler that stops propagation further down cannot
    // hide the click from us.
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("auxclick", onAuxClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("auxclick", onAuxClick, { capture: true });
    };
  }, []);

  return null;
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
