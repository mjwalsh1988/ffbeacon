/**
 * Sleeper's avatar CDN, and the one place a URL for it is built.
 *
 * Pure and client-safe: both the person avatar (`components/sleeper-avatar.tsx`)
 * and the league logo (`components/league-logo.tsx`) render in the browser.
 *
 * `sleepercdn.com` is already allowed by `next.config.ts` images.remotePatterns
 * and by the CSP `img-src` in `lib/security-headers.ts`, so nothing new has to
 * be opened up for this.
 *
 * The id is validated rather than trusted. A league logo id arrives from
 * `leagues.metadata->>avatar`, which is a raw external object we store
 * verbatim, so a value containing a slash, a dot or a colon would let a stored
 * string decide which host an <img> points at. Sleeper's own ids are 32 hex
 * characters; the pattern here is a little wider than that and still cannot
 * escape the path segment.
 */

export const SLEEPER_AVATAR_BASE = "https://sleepercdn.com/avatars";

/** What Sleeper's own ids look like, plus a little slack. No dots, no slashes. */
const AVATAR_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * Full-size or thumbnail URL for a Sleeper avatar id. Null in, null out.
 *
 * The thumbnail is the right asset for anything up to about 48 px, which is
 * every league logo on a list row and every person avatar on the site.
 */
export function sleeperAvatarUrl(
  avatarId: string | null | undefined,
  size: "full" | "thumb" = "full",
): string | null {
  if (typeof avatarId !== "string") return null;
  const id = avatarId.trim();
  if (!AVATAR_ID_PATTERN.test(id)) return null;
  return size === "thumb"
    ? `${SLEEPER_AVATAR_BASE}/thumbs/${id}`
    : `${SLEEPER_AVATAR_BASE}/${id}`;
}
