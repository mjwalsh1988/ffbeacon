"use client";

import { useEffect, useState, type ReactNode } from "react";
import { UserRound } from "lucide-react";

/**
 * Single source of truth for rendering a possibly-missing image (player
 * headshots, user/team avatars, etc.). It loads `src`; if the URL is absent or
 * fails to load, it renders a fallback that occupies the exact same square in
 * the exact same spot, so the layout never shifts and we never show a broken
 * image.
 *
 * The default fallback is a neutral "user avatar" silhouette. Callers that want
 * a different placeholder (an initial, a position badge) can pass `fallback`.
 *
 * Every avatar/photo on the site should route through this component rather
 * than rendering a raw <img>.
 */
export function ImageWithFallback({
  src,
  alt,
  size = 40,
  rounded = true,
  className = "",
  fallback,
  loading = "lazy",
}: {
  src: string | null | undefined;
  /** Accessible name. Also used as the fallback's aria-label. */
  alt: string;
  /** Square pixel dimension for both the image and the fallback. */
  size?: number;
  /** Circular by default; set false for a rounded-rectangle (e.g. logos). */
  rounded?: boolean;
  /** Extra classes applied to whichever element renders (image or fallback). */
  className?: string;
  /** Custom placeholder. Defaults to a user-avatar silhouette icon. */
  fallback?: ReactNode;
  loading?: "lazy" | "eager";
}) {
  const [errored, setErrored] = useState(false);
  // A new src (e.g. the user uploads a fresh avatar) deserves a fresh attempt.
  useEffect(() => setErrored(false), [src]);

  const shape = rounded ? "rounded-full" : "rounded-card";
  const dims = { width: size, height: size };
  const showImage = !!src && !errored;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- intentional: we
      // need onError fallback handling that next/image doesn't expose cleanly,
      // and many of these are external/CDN or signed URLs.
      <img
        src={src ?? undefined}
        alt={alt}
        title={alt || undefined}
        width={size}
        height={size}
        style={dims}
        loading={loading}
        decoding="async"
        onError={() => setErrored(true)}
        className={`flex-shrink-0 border border-line bg-base object-cover ${shape} ${className}`}
      />
    );
  }

  // Empty alt means the caller marked this decorative (e.g. the name is
  // already shown as visible text next to it). role="img" with no name would
  // still surface an unlabeled graphic to assistive tech, so hide it outright
  // instead of leaving a phantom announcement.
  const isDecorative = alt === "";

  return (
    <span
      role={isDecorative ? undefined : "img"}
      aria-hidden={isDecorative ? true : undefined}
      aria-label={isDecorative ? undefined : alt}
      title={alt || undefined}
      style={dims}
      className={`inline-flex flex-shrink-0 items-center justify-center border border-line bg-base text-ink-subtle ${shape} ${className}`}
    >
      {fallback ?? (
        <UserRound
          aria-hidden="true"
          strokeWidth={1.75}
          style={{
            width: Math.round(size * 0.55),
            height: Math.round(size * 0.55),
          }}
        />
      )}
    </span>
  );
}
