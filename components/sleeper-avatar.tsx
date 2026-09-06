import { ImageWithFallback } from "@/components/image-with-fallback";
import { sleeperAvatarUrl } from "@/lib/sleeper-avatar-url";

type SleeperAvatarProps = {
  /** Raw avatar id from league_users.avatar (e.g. "ab12cd..."). null/undefined renders the fallback. */
  avatarId: string | null | undefined;
  /** Kept for call-site compatibility; the missing-avatar fallback is the
   * shared user-avatar icon. */
  initial?: string;
  /** Accessible label (team or owner name) used for alt + title. */
  title: string;
  /** Pixel size, sets width and height. Defaults to 36. */
  size?: number;
};

/**
 * Renders a Sleeper team/owner avatar. The avatar id is the raw Sleeper-side
 * identifier; this component builds the URL and routes rendering plus the
 * missing-avatar fallback through the shared ImageWithFallback helper so a
 * dead avatar URL never shows as a broken image.
 */
export function SleeperAvatar({ avatarId, title, size = 36 }: SleeperAvatarProps) {
  // The thumbnail below 64 px, the same expression components/league-logo.tsx
  // uses. Every call site of this component is 20 to 40 px, so the full-size
  // asset was a user's original upload downscaled in the browser: on a
  // twelve-team rankings table that is twelve of them.
  const src = sleeperAvatarUrl(avatarId, size >= 64 ? "full" : "thumb");
  return <ImageWithFallback src={src} alt={title} size={size} />;
}
