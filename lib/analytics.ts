/**
 * Google Analytics 4, and the one function the rest of the site calls to send
 * it an event.
 *
 * Vercel Analytics still runs beside this and still counts page views on its
 * own. GA is here for what Vercel cannot say: returning visitors, where a visit
 * came from, and the handful of actions below that tell us whether the site is
 * doing its job.
 *
 * GA LOADS IN PRODUCTION ONLY. `isGoogleAnalyticsEnabled()` is read by the root
 * layout, and outside production no tag is rendered, `window.gtag` never exists
 * and `trackEvent` is a no-op. A local dev session or a preview deploy must not
 * land in the same numbers as real readers.
 *
 * EVERY EVENT NAME AND PARAMETER IS LISTED IN `AnalyticsEvent`, so a typo is a
 * type error rather than a new row in a GA report nobody set up. The parameter
 * names match the custom dimensions registered on the GA property (tool,
 * surface, method, cta_location, content_type); a parameter GA has no
 * dimension for is collected but cannot be reported on.
 *
 * NOTHING THAT IDENTIFIES A PERSON GOES IN A PARAMETER. No email, no Sleeper
 * handle, no user id, no league id. GA's terms forbid it and the privacy page
 * promises it.
 */

/**
 * The measurement ID is public by design: it is printed into the source of
 * every page that loads the tag. The env var exists so a test property can be
 * swapped in without a code change; the fallback is the live FF Beacon stream.
 */
export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_ID?.trim() || "G-PEFKMMBMR5";

/**
 * Server-side switch for the root layout. Vercel sets VERCEL_ENV itself.
 *
 * The ID is checked against GA's own format as well, because the layout writes
 * it into an inline script, and a malformed env value must turn the tag off
 * rather than put arbitrary text inside a <script>.
 */
export function isGoogleAnalyticsEnabled(): boolean {
  return (
    process.env.VERCEL_ENV === "production" && /^G-[A-Z0-9]{4,20}$/.test(GA_MEASUREMENT_ID)
  );
}

/**
 * The tools a `tool_use` event can name.
 *
 * WHAT COUNTS AS A USE. Where the tool answers in place (Signal Check, Trade
 * Finder, FAAB, Signal Scout, Would You Rather) the event fires when an answer
 * came back. Where the tool is a search that navigates to its results page
 * (League Pulse, Manager Pulse, Who Should I Start) it fires on the submit,
 * because the answer is a page load and the page view is already counted.
 * On The Clock fires when a draft room is opened. Known gaps, left on purpose:
 * a saved-handle auto-run of League Pulse submits no form and is not counted,
 * and the League Pulse deep views under /leagues are measured by page views
 * alone.
 */
export type AnalyticsTool =
  | "league_pulse"
  | "signal_check"
  | "trade_finder"
  | "manager_pulse"
  | "would_you_rather"
  | "faab"
  | "on_the_clock"
  | "who_should_i_start"
  | "signal_scout";

export type DonateSurface = "header_modal" | "donate_page";

export type AnalyticsEvent =
  /** The header Donate button opened the donation panel. */
  | { name: "donate_open"; params: { surface: "header_modal" } }
  /** The card button asked our server for a Stripe session and got one. */
  | {
      name: "donate_checkout_start";
      params: { surface: DonateSurface; value: number; currency: "USD" };
    }
  /** A PayPal or Venmo link was followed. What happens there is invisible to us. */
  | {
      name: "donate_external_click";
      params: { surface: DonateSurface; method: "paypal" | "venmo"; value: number; currency: "USD" };
    }
  /** Stripe confirmed the payment on the thank-you page. */
  | { name: "donation_complete"; params: { value: number; currency: "USD" } }
  /** A link to /join, the Discord invite, was followed. */
  | { name: "join_discord_click"; params: { cta_location: string } }
  /**
   * The FAAB calculator produced a bid. One per result, in either mode.
   *
   * bid_pct is a share of the league's FULL budget rather than dollars, for
   * the same reason every figure in that model is: a $12 bid in a $100 league
   * and a $120 bid in a $1,000 league are the same decision, and averaging
   * dollars across both would tell us nothing.
   */
  | {
      name: "faab_result";
      params: {
        mode: "league" | "manual";
        league_kind: "standard" | "chopped";
        goal: "value" | "sure";
        bid_pct: number;
        win_chance: number;
      };
    }
  /** The reader switched between "Good value" and "Make sure I win". */
  | { name: "faab_goal_change"; params: { goal: "value" | "sure" } }
  /** A sign-in was started with a provider or a magic link. */
  | { name: "login_start"; params: { method: "google" | "discord" | "email" } }
  /** A sign-in finished. GA's own recommended event name. */
  | { name: "login"; params: { method: string } }
  /** A new account finished signing in for the first time. GA's own recommended name. */
  | { name: "sign_up"; params: { method: string } }
  /** Someone ran one of the tools. */
  | { name: "tool_use"; params: { tool: AnalyticsTool } }
  /** A copy link or copy image button worked. GA's own recommended name. */
  | {
      name: "share";
      params: { method: "copy_link" | "copy_image"; content_type: string };
    };

type Gtag = (command: "event", name: string, params: Record<string, string | number>) => void;

declare global {
  interface Window {
    gtag?: Gtag;
  }
}

/**
 * Send one event. Never throws and never blocks: analytics failing must not be
 * the reason a donation or a sign-in does not happen.
 */
export function trackEvent<E extends AnalyticsEvent>(name: E["name"], params: E["params"]): void {
  if (typeof window === "undefined") return;
  try {
    window.gtag?.("event", name, params);
  } catch {
    // Swallowed on purpose. See above.
  }
}

/**
 * The site's top-level sections. Anything else in the first path segment is a
 * public profile handle (app/[handle]), and a handle can be somebody's real
 * name, so it is reported as "profile" rather than passed through.
 */
const KNOWN_SECTIONS = new Set([
  "about",
  "admin",
  "author",
  "brief",
  "donate",
  "games",
  "guides",
  "join",
  "leagues",
  "login",
  "my-beacon",
  "players",
  "privacy",
  "rankings",
  "terms",
  "tools",
]);

/**
 * Which part of the site the reader is on: "leagues", "tools", "guides" and so
 * on. Used as `content_type` on share events and `cta_location` on Discord
 * clicks. Coarse on purpose, because a full path would carry league ids,
 * roster ids and Sleeper handles into event parameters.
 */
export function sectionOf(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return "home";
  return KNOWN_SECTIONS.has(first) ? first : "profile";
}

export function currentSection(): string {
  if (typeof window === "undefined") return "unknown";
  return sectionOf(window.location.pathname);
}

/**
 * The one-shot cookie `/auth/callback` sets so the page it redirects to can
 * report the sign-in. Value is `<event>.<method>`, for example
 * `sign_up.google`. Readable from JavaScript on purpose; it carries no
 * identity and lives for five minutes at most.
 */
export const AUTH_EVENT_COOKIE = "ff_auth_event";

/** Parse the cookie value. Anything unexpected is ignored rather than guessed at. */
export function parseAuthEventCookie(
  value: string | null | undefined,
): { name: "login" | "sign_up"; method: string } | null {
  if (!value) return null;
  const [name, method] = value.split(".");
  if (name !== "login" && name !== "sign_up") return null;
  if (!method || !/^[a-z_]{1,32}$/.test(method)) return null;
  return { name, method };
}
