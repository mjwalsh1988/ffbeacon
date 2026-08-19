"use client";

import { useEffect, useState } from "react";

/**
 * Site-wide floating CTA that nudges visitors into the FF Beacon Discord.
 *
 * Why a floating element instead of a header/footer link:
 *   - The header is already crowded (source and format, search, BEAM, auth).
 *   - The footer is below the fold on most pages and easy to miss.
 *   - A persistent floating CTA stays visible across every route without
 *     blocking primary content.
 *
 * Behavior:
 *   - Anchored bottom-right with `env(safe-area-inset-bottom)` padding so it
 *     clears iOS home-bar and Android nav-bar regions cleanly.
 *   - Icon+label on every breakpoint so the "Join the Discord" intent is
 *     never ambiguous, including on mobile.
 *   - Dismissible. The X button writes `ffbeacon.discord_cta_dismissed = "1"`
 *     to localStorage and hides the component for the rest of the session and
 *     across return visits. There is no re-prompt; the footer + /join still
 *     surface the invite for anyone who changes their mind.
 *   - Opens `/join` in a new tab (which then redirects to the actual Discord
 *     invite) so the user never loses their FF Beacon session.
 *   - Hidden on the /join page itself (no point CTAing a page that already
 *     redirects to the same target).
 *
 * Accessibility:
 *   - Single labeled `<a>` element for the CTA itself, separate labeled
 *     `<button>` for the dismiss action, both keyboard-reachable with
 *     visible focus rings.
 *   - The CTA's `aria-label` includes "(opens in new tab)" so screen-reader
 *     users get the same affordance sighted users get from a target='_blank'.
 *   - Initial render is suppressed until the localStorage check resolves;
 *     this prevents the dismissed state from flashing in before hydration.
 */
const STORAGE_KEY = "ffbeacon.discord_cta_dismissed";

export function DiscordCta() {
  // `null` = not yet decided (pre-hydration). The render path treats this as
  // "do not render" so we never flash the button before knowing whether the
  // user already dismissed it. Hydration runs the effect below which resolves
  // to either true (show) or false (hide).
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    // Hide on /join, the page itself is the invite redirect.
    if (typeof window !== "undefined" && window.location.pathname === "/join") {
      setVisible(false);
      return;
    }

    // Honor an earlier dismissal before doing any network work.
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // localStorage can throw in private mode / hardened browsers; treat as
      // "not dismissed" and fall through to the membership check.
      dismissed = false;
    }
    if (dismissed) {
      setVisible(false);
      return;
    }

    // Ask the server whether the signed-in user is already in our Discord.
    // The endpoint derives identity from the session cookie (never trusts the
    // client) and the bot token stays server-side. We stay in the "undecided"
    // (render nothing) state until this resolves so a confirmed member never
    // sees the invite flash in. Anyone we can't confirm as a member (logged
    // out, no Discord linked, or an unverifiable check) still sees the CTA.
    const controller = new AbortController();
    let active = true;
    fetch("/api/discord/membership", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : { member: false }))
      .then((data: { member?: boolean }) => {
        if (active) setVisible(data.member !== true);
      })
      .catch(() => {
        // Network/abort error: fail open to showing the invite.
        if (active) setVisible(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end px-4 pb-[calc(max(1rem,env(safe-area-inset-bottom))+var(--ffb-dock-h,0px))] sm:px-6 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
      // The outer wrapper is non-interactive so it doesn't block clicks on
      // page content; only the inner pill + dismiss button capture pointer events.
      //
      // The bottom padding also clears whatever is docked to the bottom of the
      // viewport, via --ffb-dock-h (see app/globals.css). Without it this pill
      // would land on top of the Signal Scout meter's score readout during a
      // round. The var is unset on every other page, and cleared the moment the
      // meter undocks, so the calc collapses back to the plain safe-area
      // padding and the pill drops to its usual spot. The sm rule is belt and
      // braces: docking is mobile-only, so the offset must never reach a wider
      // viewport even if a future publisher sets the var at every width.
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-brand-purple/40 bg-surface/95 p-1 pl-2 shadow-lg backdrop-blur">
        <a
          href="/join"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Join the FF Beacon Discord (opens in new tab)"
          className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-brand-purple to-brand-cyan px-3 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:px-4"
        >
          <DiscordGlyph className="h-5 w-5" />
          <span>Join the Discord</span>
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide the Discord invite"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <CloseGlyph className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable={false}
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.075-.035 19.74 19.74 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable={false}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
