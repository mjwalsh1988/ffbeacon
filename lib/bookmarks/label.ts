/**
 * The label a page suggests for itself when a reader saves it.
 *
 * The reader can rename any bookmark afterwards, so this only has to be a
 * decent starting point. It comes from the same trail the breadcrumb bar draws
 * (lib/breadcrumbs.ts), which means a page that already knows a better name for
 * itself than its slug (a player, an article, a league) gets that name here too,
 * through the same registration.
 *
 * Pure and client-safe. The bookmark button is a client component and computes
 * this on the fly; keeping it out of the component makes it testable.
 */

import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { MAX_BOOKMARK_LABEL_LENGTH } from "./types";

/**
 * A suggested label for one path.
 *
 * `registeredLabel` is what the page registered for its own last crumb, when it
 * registered one. It always wins: "Ja'Marr Chase" is a better bookmark than
 * "Ja Marr Chase", and an article's headline is better than its slug.
 */
export function defaultBookmarkLabel(
  pathname: string,
  registeredLabel?: string | null,
): string {
  const registered = registeredLabel?.trim();
  if (registered) return clamp(registered);

  const crumbs = buildBreadcrumbs(pathname);
  const last = crumbs[crumbs.length - 1]?.label?.trim();
  if (last) return clamp(last);

  // Only the homepage has no trail at all.
  return "FF Beacon";
}

function clamp(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_BOOKMARK_LABEL_LENGTH
    ? collapsed.slice(0, MAX_BOOKMARK_LABEL_LENGTH).trimEnd()
    : collapsed;
}
