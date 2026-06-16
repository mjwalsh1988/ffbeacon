"use client";

import { useState } from "react";
import { Play, Pause } from "lucide-react";
import type { WallGif } from "@/lib/signal-wall";

/**
 * Render a GIF (from GIPHY) attached to a post or comment. Motion is never
 * automatic: the STATIC still (preview_url) is shown by default for everyone, which
 * also honors prefers-reduced-motion, and an explicit, labeled play/pause control
 * swaps in the animated rendition only when the viewer asks for it. The image
 * always carries the creator's required alt text.
 *
 * A visible "Powered by GIPHY" attribution is rendered on every GIF. This is a
 * required, permanent element for GIPHY production-key approval, not optional
 * chrome, so it carries plain text that a screen reader announces.
 */
export function AnimatedGif({ gif }: { gif: WallGif }) {
  const [playing, setPlaying] = useState(false);

  return (
    <figure className="mt-3 max-w-xs">
      <div className="relative overflow-hidden rounded-card border border-line bg-base">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={playing ? gif.url : gif.previewUrl}
          alt={gif.alt}
          width={gif.width}
          height={gif.height}
          loading="lazy"
          className="h-auto w-full"
        />
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
          className="absolute bottom-2 left-2 inline-flex h-11 items-center gap-1.5 rounded-full bg-black/75 px-3 text-xs font-semibold text-white hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {playing ? (
            <Pause aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Play aria-hidden="true" className="h-4 w-4" />
          )}
          {playing ? "Pause GIF" : "Play GIF"}
        </button>
      </div>
      <figcaption className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Powered by GIPHY
      </figcaption>
    </figure>
  );
}
