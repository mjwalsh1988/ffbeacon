import { ImageWithFallback } from "@/components/image-with-fallback";

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

const AVATAR_BASE = "https://sleepercdn.com/avatars";

/**
 * Renders a Sleeper team/owner avatar. The avatar id is the raw Sleeper-side
 * identifier; this component builds the URL and routes rendering plus the
 * missing-avatar fallback through the shared ImageWithFallback helper so a
 * dead avatar URL never shows as a broken image.
 */
export function SleeperAvatar({ avatarId, title, size = 36 }: SleeperAvatarProps) {
  const src = avatarId ? `${AVATAR_BASE}/${avatarId}` : null;
  return <ImageWithFallback src={src} alt={title} size={size} />;
}
