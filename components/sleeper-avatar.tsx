"use client";

import { useEffect, useState } from "react";

type SleeperAvatarProps = {
  /** Raw avatar id from league_users.avatar (e.g. "ab12cd..."). null/undefined renders the fallback. */
  avatarId: string | null | undefined;
  /** Fallback letter shown when avatar is missing or fails to load. */
  initial: string;
  /** Accessible label (team or owner name) used for alt + title. */
  title: string;
  /** Pixel size — sets width, height, and font sizing for the fallback. Defaults to 36. */
  size?: number;
};

const AVATAR_BASE = "https://sleepercdn.com/avatars";

/**
 * Renders a Sleeper team avatar with graceful fallback to an initial letter.
 * The avatar id is the raw Sleeper-side identifier; this component handles
 * URL construction so callers don't have to repeat the base URL.
 */
export function SleeperAvatar({
  avatarId,
  initial,
  title,
  size = 36,
}: SleeperAvatarProps) {
  const [errored, setErrored] = useState(false);
  useEffect(() => setErrored(false), [avatarId]);

  const showImage = !!avatarId && !errored;
  const fallbackChar = (initial || "?").charAt(0).toUpperCase();
  const sharedStyle = { width: size, height: size };

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${AVATAR_BASE}/${avatarId}`}
        alt={title}
        title={title}
        width={size}
        height={size}
        style={sharedStyle}
        onError={() => setErrored(true)}
        className="flex-shrink-0 rounded-full border border-line bg-base object-cover"
      />
    );
  }

  return (
    <div
      style={sharedStyle}
      title={title}
      aria-label={title}
      role="img"
      className="flex flex-shrink-0 items-center justify-center rounded-full border border-line bg-base font-semibold text-ink-muted"
    >
      {fallbackChar}
    </div>
  );
}
