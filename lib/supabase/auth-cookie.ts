/**
 * The shape of this project's Supabase auth cookie, shared by the server
 * (components/site-header.tsx) and the browser (components/discord-cta.tsx).
 *
 * Supabase's SSR helper (`@supabase/ssr`) names its auth cookie
 * `sb-<project-ref>-auth-token`, splitting a long token across
 * `sb-<ref>-auth-token.0`, `sb-<ref>-auth-token.1` and so on. Deriving the
 * exact prefix from this project's own URL, rather than testing any cookie
 * shaped like `sb-*-auth-token`, means a stray Supabase cookie from a
 * different project on the same hostname cannot mark a reader as signed in.
 *
 * Everything here is a HINT. A cookie can be stale (signed out elsewhere,
 * expired) or forged (cookies are client-writable), so the answer may only
 * ever decide what to render or whether to ask the server a question, never
 * grant anything. The server-verified identity still comes from getUser() in
 * the render or the route.
 *
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` is inlined into client bundles by
 * Next, so the same function gives the same prefix on both sides.
 */
export function supabaseAuthCookiePrefix(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (!url) return null;
  try {
    const projectRef = new URL(url).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * Does a `document.cookie` string (or any `Cookie` header value) carry this
 * project's auth cookie. Browser side, this is how a client component can
 * tell a signed-out reader apart from a signed-in one WITHOUT a round trip:
 * the Discord invite pill used to ask /api/discord/membership on every page
 * view for every guest and every bot, about 3,300 function invocations a
 * day that could only ever answer "not a member".
 *
 * Fails toward "no cookie": a missing URL, an empty string or a malformed
 * cookie header all return false, and the caller treats false as signed out.
 */
export function hasSupabaseAuthCookie(
  cookieString: string | null | undefined,
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  if (!cookieString) return false;
  const prefix = supabaseAuthCookiePrefix(url);
  if (!prefix) return false;
  return cookieString.split(";").some((part) => {
    const name = part.trim().split("=")[0];
    return isAuthTokenCookieName(name, prefix);
  });
}

/**
 * The auth cookie itself (`sb-<ref>-auth-token`) or one of its chunks
 * (`sb-<ref>-auth-token.0`, `.1`, ...). A plain startsWith would also accept
 * `sb-<ref>-auth-token-code-verifier`, which auth-js writes when a PKCE
 * sign-in BEGINS, so a reader who opened the sign-in page and walked away
 * would read as signed in until that cookie expired.
 */
export function isAuthTokenCookieName(name: string, prefix: string): boolean {
  return name === prefix || name.startsWith(`${prefix}.`);
}
