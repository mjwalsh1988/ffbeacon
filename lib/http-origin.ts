/**
 * Same-origin request guard for state-changing POSTs (FFB-SEC-013).
 *
 * A same-origin HTML form POST sends an `Origin` header in modern browsers, and a
 * cross-site page cannot forge another site's Origin. We check Origin first, fall back
 * to Referer, and fail closed when neither is present. Used to block cross-site
 * request forgery on endpoints that change state (e.g. sign-out).
 */
export function isSameOrigin(req: Request): boolean {
  let selfHost: string;
  try {
    selfHost = new URL(req.url).host;
  } catch {
    return false;
  }

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === selfHost;
    } catch {
      return false;
    }
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === selfHost;
    } catch {
      return false;
    }
  }

  // Neither header present: fail closed.
  return false;
}
