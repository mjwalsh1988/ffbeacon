/**
 * Where Stripe sends a reader who backs out of Checkout.
 *
 * The modal opens from the header, which means it opens from ANY page, so the
 * cancel destination has to come from the browser. That makes it caller-
 * supplied input on a URL we hand to a third party and that the third party
 * then redirects to, which is the exact shape of an open redirect: left
 * unchecked, our own checkout endpoint becomes a laundering service for
 * somebody else's link, and the link arrives wearing Stripe's padlock.
 *
 * So the path is not sanitised, it is RESOLVED against our own origin and then
 * checked against it. Anything that resolves anywhere else, a scheme, a host, a
 * protocol-relative reference, a backslash browsers fold into a slash, falls
 * back to the home page. Pure, and tested, because the failure is silent when
 * it is wrong.
 */

/** Where a reader lands when the supplied path is missing or not ours. */
const FALLBACK_PATH = "/";

/**
 * Written as a loop rather than a regex literal because the characters it looks
 * for cannot survive being typed into one. A tab or a newline in front of a
 * scheme is how a naive prefix check gets beaten, so they are rejected outright
 * rather than trimmed.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeReturnPath(input: unknown, siteOrigin: string): string {
  if (typeof input !== "string") return FALLBACK_PATH;

  // BEFORE the trim, deliberately. Trimming first REPAIRS a hostile string
  // rather than rejecting it: a leading tab or newline is stripped and the
  // result then sails through every check below on its repaired form. A control
  // character in a path this endpoint was handed is evidence that something is
  // wrong with the request, not whitespace to be tidied away.
  if (hasControlChars(input)) return FALLBACK_PATH;

  const raw = input.trim();
  if (raw.length === 0 || raw.length > 512) return FALLBACK_PATH;

  // Must be a site-relative path. A single leading slash, and nothing that
  // could be read as an authority or a scheme.
  if (!raw.startsWith("/")) return FALLBACK_PATH;
  if (raw.startsWith("//")) return FALLBACK_PATH;
  if (raw.includes("\\")) return FALLBACK_PATH;
  if (raw.includes("://")) return FALLBACK_PATH;
  if (hasControlChars(raw)) return FALLBACK_PATH;

  try {
    const base = new URL(siteOrigin);
    const resolved = new URL(raw, base);
    if (resolved.origin !== base.origin) return FALLBACK_PATH;

    const out = `${resolved.pathname}${resolved.search}`;

    // The OUTPUT is checked for a protocol-relative form as well as the input.
    // `/..//evil.example` passes every check above and normalises to the
    // pathname `//evil.example`, which is same-origin here only because the one
    // caller prefixes an absolute origin. Handed to a `Location` header or an
    // `href` by any future caller, that string is a live open redirect. This
    // function's name promises a path on our own origin, so it returns one.
    if (out.startsWith("//")) return FALLBACK_PATH;

    return out;
  } catch {
    return FALLBACK_PATH;
  }
}
