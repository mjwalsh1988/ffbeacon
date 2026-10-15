import { SITE_TIME_ZONE } from "@/lib/datetime";

/**
 * Seasons the optional league panel offers.
 *
 * Derived here rather than in the browser so the list is identical in the
 * server render and the client one. Read in America/New_York, per the site-wide
 * time rule, so a January 1st visitor in Hawaii and the UTC server agree on
 * which season it is.
 */
export function seasonOptions(): string[] {
  const year = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SITE_TIME_ZONE,
      year: "numeric",
    }).format(new Date()),
  );
  return [String(year), String(year - 1)];
}
