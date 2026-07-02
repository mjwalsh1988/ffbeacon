import { ImageWithFallback } from "@/components/image-with-fallback";

type PlayerHeadshotProps = {
  /** Sleeper player id (numeric string). Drives the CDN URL. When null /
   * undefined, the shared user-avatar fallback renders. */
  sleeperId: string | null | undefined;
  /** Player position (e.g. "QB", "RB"). Kept for call-site compatibility and
   * potential future styling; the missing-photo fallback is the shared
   * user-avatar icon. */
  position?: string;
  /** Accessible label — usually the player's full name. Pass "" when the photo
   * is decorative (e.g. the name is shown as text right beside it). */
  name: string;
  /** Pixel size for both dimensions. Defaults to 40. */
  size?: number;
  /** Circular by default; set false for a rounded-rectangle headshot. */
  rounded?: boolean;
  /** Extra classes forwarded to the rendered image / fallback. */
  className?: string;
};

const PLAYER_IMAGE_BASE = "https://sleepercdn.com/content/nfl/players";

/**
 * Player headshot driven by Sleeper's CDN: every player with an external
 * Sleeper id is served at `${PLAYER_IMAGE_BASE}/{sleeperId}.jpg`. Rendering
 * (and the missing-photo fallback) goes through the shared ImageWithFallback
 * helper so no player photo can ever render as a broken image.
 */
export function PlayerHeadshot({
  sleeperId,
  name,
  size = 40,
  rounded = true,
  className = "",
}: PlayerHeadshotProps) {
  const src = sleeperId ? `${PLAYER_IMAGE_BASE}/${sleeperId}.jpg` : null;
  return (
    <ImageWithFallback src={src} alt={name} size={size} rounded={rounded} className={className} />
  );
}
