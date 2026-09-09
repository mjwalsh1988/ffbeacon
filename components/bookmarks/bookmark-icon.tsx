"use client";

/**
 * The picture beside one bookmark: a league's own logo where there is one, and
 * otherwise the glyph the navigation uses for that destination.
 *
 * BOTH HALVES ARE DERIVED FROM THE PATH, never stored on the row. The glyph
 * comes from `bookmarkIconFor`, and the logo from a lookup against `leagues`
 * done when the list is read (lib/bookmarks/load.ts). So a commissioner who
 * changes their league logo changes it on every reader's bar, and a bookmark
 * saved before we had ever synced that league picks the logo up the first time
 * somebody opens it.
 *
 * A LEAGUE WITH NO LOGO GETS THE SHIELD, which is the same placeholder
 * components/league-logo.tsx draws in every league list on the site, so the two
 * surfaces read as the same thing. A league whose stored avatar id has since
 * gone stale gets it too, by way of the load error, which is what
 * `ImageWithFallback` is for.
 *
 * DECORATIVE, always. Every caller draws the bookmark's label as visible text
 * immediately beside this, so an alt of the league name would have a screen
 * reader say the same words twice on every row.
 */

import { navIcon } from "@/components/app-shell/nav-icons";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { bookmarkIconFor } from "@/lib/bookmarks/icon";
import type { Bookmark } from "@/lib/bookmarks/types";

export function BookmarkIcon({
  bookmark,
  size = 16,
}: {
  bookmark: Bookmark;
  /** Square pixels. The bar uses 16, the sheet and the manage page 20 and 16. */
  size?: number;
  }) {
  const Glyph = navIcon(bookmarkIconFor(bookmark.path));

  if (bookmark.imageUrl) {
    return (
      <ImageWithFallback
        src={bookmark.imageUrl}
        alt=""
        size={size}
        // Square-cornered, like every league logo on the site. Circles are
        // reserved for people.
        radiusClass="rounded-sm"
        fallback={
          <Glyph
            aria-hidden="true"
            strokeWidth={1.75}
            style={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7) }}
          />
        }
      />
    );
  }

  return (
    <Glyph
      aria-hidden="true"
      className="shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
