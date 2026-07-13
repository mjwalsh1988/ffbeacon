/**
 * Centralized security response headers (FFB-SEC-005), consumed by next.config.ts.
 *
 * Two groups:
 *   1. `baselineSecurityHeaders` - always-enforced, low-risk headers (framing,
 *      MIME sniffing, referrer, permissions, cross-origin isolation).
 *   2. Content-Security-Policy - shipped in REPORT-ONLY mode first. A CSP that is
 *      wrong breaks the whole site (Next.js inline bootstrap scripts, Supabase Auth,
 *      OAuth, analytics, OG images, GIPHY). Report-Only collects violations without
 *      blocking so the policy can be validated against real traffic before flipping
 *      to enforcing. See the "Path to enforcement" note below.
 *
 * The JSON-LD escaping fix (FFB-SEC-006, lib/json-ld.ts) is the primary XSS control;
 * the CSP is a backstop and is mandatory regardless.
 */

type Header = { key: string; value: string };

/**
 * Derive the Supabase origins (https + wss for Realtime) from the public URL so the
 * connect-src / img-src directives do not hardcode the project ref.
 */
function supabaseOrigins(): { https: string; wss: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    return { https: `https://${u.host}`, wss: `wss://${u.host}` };
  } catch {
    return null;
  }
}

/**
 * Always-on headers. These are safe to enforce immediately: they do not depend on
 * per-page script/style inventories the way a CSP does.
 */
export const baselineSecurityHeaders: Header[] = [
  // Stop MIME sniffing (content-type confusion).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking protection. Enforced now; CSP frame-ancestors below is the belt.
  { key: "X-Frame-Options", value: "DENY" },
  // Trim referrer leakage while keeping same-origin analytics useful.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drop powerful features the site never uses.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=(), interest-cohort=()",
  },
  // Cross-origin isolation. same-origin-allow-popups keeps any OAuth popup flow
  // working while still isolating our window from openers.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // Public content (OG images, avatars, shared cards) may be embedded cross-origin,
  // so cross-origin is the compatible choice here rather than same-origin.
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
];

/**
 * Build the CSP string. Kept permissive enough to not break current functionality;
 * tightened over time once Report-Only surfaces no legitimate violations.
 *
 * Notes on choices:
 *   - script-src includes 'unsafe-inline' because Next.js App Router injects inline
 *     bootstrap/flight scripts and we have no nonce pipeline yet. 'unsafe-eval' is
 *     deliberately omitted (production Next does not require it).
 *   - style-src 'unsafe-inline' covers Next/Tailwind injected styles.
 *   - img-src allows data:/blob: (previews, inlined icons), Sleeper CDN, and Supabase
 *     Storage. GIPHY is server-proxied through our origin, so 'self' covers it.
 *   - connect-src allows the Supabase REST/Realtime origins (https + wss). Analytics
 *     hosts are included so enabling Plausible/GA later does not require a CSP change.
 *   - frame-ancestors 'none' mirrors X-Frame-Options: DENY.
 */
export function buildContentSecurityPolicy(): string {
  const sb = supabaseOrigins();
  const sbHttps = sb ? ` ${sb.https}` : "";
  const sbWss = sb ? ` ${sb.wss}` : "";

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://plausible.io https://www.googletagmanager.com https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: https://sleepercdn.com${sbHttps}`,
    `connect-src 'self'${sbHttps}${sbWss} https://plausible.io https://www.google-analytics.com https://www.googletagmanager.com`,
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self'",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

/**
 * The full header list applied by next.config.ts to every route. CSP is Report-Only.
 *
 * Path to enforcement:
 *   1. Deploy with Content-Security-Policy-Report-Only (this).
 *   2. Watch the browser console / a report endpoint for legitimate violations over a
 *      representative window.
 *   3. Tighten the policy to remove anything unused, add a nonce pipeline to drop
 *      script-src 'unsafe-inline' if feasible.
 *   4. Rename the header key to "Content-Security-Policy" to enforce.
 */
export function securityHeadersForNextConfig(): Header[] {
  return [
    ...baselineSecurityHeaders,
    { key: "Content-Security-Policy-Report-Only", value: buildContentSecurityPolicy() },
  ];
}
