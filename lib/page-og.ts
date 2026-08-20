import type { Metadata } from "next";
import { SITE } from "@/lib/site";

/**
 * Builds the share metadata for one of the site's fixed pages.
 *
 * Every page that uses this gets a real 1200x630 card from
 * app/api/og/page/[key]/route.tsx instead of the square site logo, which is
 * what most of them shared before and which told a reader nothing about what
 * they were being sent. The `key` has to match a row in that route's registry;
 * a key with no row 404s, so a typo shows up as a missing image rather than a
 * blank branded rectangle.
 *
 * Title and description are passed in rather than read from the card, because
 * the two audiences are different. The card is read by a person deciding
 * whether to tap a link in a group chat; the description is read by a search
 * engine and by the same person a second later. They should say the same thing
 * in different lengths, not the same string twice.
 */
export function pageShareMetadata({
  key,
  title,
  description,
  path,
  type = "website",
}: {
  /** Row in the PAGE_CARDS registry. */
  key: string;
  /** The og:title. Usually the page title without the site suffix. */
  title: string;
  description: string;
  /** Canonical path, leading slash, no domain. */
  path: string;
  type?: "website" | "article" | "profile";
}): Metadata {
  const image = `${SITE.url}/api/og/page/${key}`;
  const url = `${SITE.url}${path}`;
  return {
    openGraph: {
      title,
      description,
      url,
      siteName: SITE.name,
      type,
      images: [{ url: image, width: 1200, height: 630, alt: `${title}, on FF Beacon` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
