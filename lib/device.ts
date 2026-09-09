import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

/**
 * Is this request coming from a handheld.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR. This decides whether the server
 * does WORK for a feature that a phone is never shown. It never decides how
 * anything LOOKS: layout is CSS, at the `lg` breakpoint, as it is everywhere
 * else on the site. Sniffing a user agent is a guess, and a guess is fine for
 * "should I run this query" and wrong for "should this element exist".
 *
 * TWO FEATURES DEPEND ON IT, both because the alternative was measurable waste:
 *   - The bookmark bar is desktop-only. Loading a reader's bookmarks on a
 *     phone would be a database round trip for a bar that is never painted;
 *     the mobile sheet fetches the same list on demand instead, once, when the
 *     reader opens it.
 *   - Ask BEAM is desktop-only. Its launcher pulled the BEAM settings row on
 *     every request at every width, and on a phone that row now buys nothing.
 *
 * HOW A WRONG GUESS DEGRADES, in both directions:
 *   - Says handheld, viewport is wide: the bar is absent and the bookmarks
 *     sheet trigger is shown at every width instead of only below `lg`, so the
 *     reader still reaches their bookmarks. They lose the bar, not the feature.
 *   - Says desktop, viewport is narrow: the bar is loaded and CSS hides it. One
 *     query wasted, nothing broken, and the sheet reads the list that is
 *     already in hand.
 *
 * Wrapped in React's `cache` so several callers in one render share one header
 * read. `headers()` is request-scoped and makes no network call, and every
 * route that reaches this is already dynamic (the header reads cookies), so
 * this changes nothing about what can be statically rendered.
 */
export const isHandheldRequest = cache(async (): Promise<boolean> => {
  try {
    const ua = (await headers()).get("user-agent") ?? "";
    if (!ua) return false;
    // Deliberately the coarse, well-known test rather than a parser: the only
    // question is "phone or tablet", and a dependency that answers it more
    // precisely would still be a guess.
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk/i.test(
      ua,
    );
  } catch {
    // No headers available (a build-time render). Treating that as desktop is
    // the safe answer: the feature is present and CSS decides the rest.
    return false;
  }
});
