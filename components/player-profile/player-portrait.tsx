"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";

/**
 * Player portrait frame for the profile hero. Unlike the square PlayerHeadshot
 * (which object-covers/contains a centered image), this anchors the Sleeper
 * cutout to the BOTTOM of a fixed portrait-shaped container and sizes it by
 * height, so the jersey sits flush against the bottom edge with only a little
 * headroom above the player, no matter how much dead space the source image
 * carries. A failed / missing image falls back to the shared user silhouette so
 * a broken image never renders.
 */

const PLAYER_IMAGE_BASE = "https://sleepercdn.com/content/nfl/players";

export function PlayerPortrait({
  sleeperId,
  name,
  accentColor,
  className = "",
}: {
  sleeperId: string | null;
  /** Accessible name. Pass "" when the name is shown as text beside the photo
   * so the portrait is treated as decorative. */
  name: string;
  /** Optional team color for a faint wash pooled at the base of the frame. */
  accentColor?: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  useEffect(() => setErrored(false), [sleeperId]);

  const src = sleeperId ? `${PLAYER_IMAGE_BASE}/${sleeperId}.jpg` : null;
  const showImage = Boolean(src) && !errored;

  return (
    <div
      className={`relative h-[210px] w-[176px] overflow-hidden rounded-card border border-line/80 bg-surface/50 sm:h-[248px] sm:w-[208px] ${className}`}
    >
      {accentColor && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5"
          style={{ backgroundImage: `linear-gradient(to top, ${accentColor}40 0%, transparent 100%)` }}
        />
      )}
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN image
        // with onError fallback, which next/image doesn't expose cleanly.
        <img
          src={src ?? undefined}
          alt={name}
          title={name || undefined}
          decoding="async"
          onError={() => setErrored(true)}
          // Bottom-anchored, sized by height, horizontally centered. max-w-none
          // lets a wider-than-tall source overflow and clip at the sides rather
          // than shrink and reintroduce dead space at the bottom.
          className="absolute bottom-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2 object-contain object-bottom"
        />
      ) : (
        <span
          role="img"
          aria-label={name || undefined}
          className="absolute inset-0 flex items-center justify-center text-ink-subtle"
        >
          <UserRound aria-hidden="true" strokeWidth={1.5} className="h-24 w-24" />
        </span>
      )}
    </div>
  );
}
