"use client";

import { useEffect, useState } from "react";

type PlayerHeadshotProps = {
  /** Sleeper player id (numeric string). Drives the CDN URL. When null /
   * undefined, the component renders the position badge fallback. */
  sleeperId: string | null | undefined;
  /** Player position (e.g. "QB", "RB"). Used by the fallback badge AND as
   * the accent color so the avatar reads "QB" green / "RB" / etc. */
  position: string;
  /** Accessible label — usually the player's full name. */
  name: string;
  /** Pixel size for both dimensions. Defaults to 40. */
  size?: number;
};

const PLAYER_IMAGE_BASE = "https://sleepercdn.com/content/nfl/players";

/**
 * Player headshot driven by Sleeper's CDN: every player with an external
 * Sleeper id is served at `${PLAYER_IMAGE_BASE}/{sleeperId}.jpg`. We render
 * an `<img>` with `onError` so retired / missing images fall through to a
 * position-letter badge, matching the FF Beacon brand palette.
 */
export function PlayerHeadshot({
  sleeperId,
  position,
  name,
  size = 40,
}: PlayerHeadshotProps) {
  const [errored, setErrored] = useState(false);
  useEffect(() => setErrored(false), [sleeperId]);

  const showImage = !!sleeperId && !errored;
  const accent = positionAccent(position);
  const sharedStyle = { width: size, height: size };

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${PLAYER_IMAGE_BASE}/${sleeperId}.jpg`}
        alt={name}
        title={name}
        width={size}
        height={size}
        style={{
          ...sharedStyle,
          borderColor: `${accent}55`,
        }}
        onError={() => setErrored(true)}
        loading="lazy"
        decoding="async"
        className="flex-shrink-0 rounded-full border bg-base object-cover"
      />
    );
  }

  // Position-letter badge fallback. Keeps the position color so even when the
  // photo is missing the avatar still encodes the position visually.
  return (
    <div
      style={{
        ...sharedStyle,
        backgroundColor: `${accent}22`,
        border: `1px solid ${accent}55`,
        color: accent,
      }}
      role="img"
      aria-label={`${name} (${position}) — photo unavailable`}
      title={name}
      className="flex flex-shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase tracking-wider"
    >
      {(position || "?").slice(0, 3)}
    </div>
  );
}

/** Same palette FaabForm used for the inline badge. Keeping the source of
 * truth here so headshot fallbacks and any external badges stay in sync. */
function positionAccent(position: string): string {
  const pos = (position ?? "").toUpperCase();
  if (pos === "QB") return "#F472B6";
  if (pos === "RB") return "#10B981";
  if (pos === "WR") return "#22D3EE";
  if (pos === "TE") return "#F59E0B";
  return "#A8A8B8";
}
