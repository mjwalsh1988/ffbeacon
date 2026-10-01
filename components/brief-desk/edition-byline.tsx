/**
 * The edition byline (plan section 11.3), two plain paragraphs in reading
 * order directly under the title:
 *
 *   By Michael Walsh, founder of FF Beacon. Published Sep 16, 2026. [Updated Oct 1, 2026.]
 *   Covers Sep 9 to Sep 15, 2026. Values and ranks are {formats} on {source}.
 *
 * The name links to the author page with rel="author". The second line is
 * the period and the format note from the bundle's context and nothing else:
 * no research log, no citations, no review notes, nothing about how the
 * edition was prepared.
 *
 * Server component.
 */

import Link from "next/link";
import { SITE } from "@/lib/site";
import { AUTHOR_NAME } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { formatPeriod, formatsPhrase } from "@/lib/brief-desk/period";

/** An edit inside this window of publishing is part of publishing, not an update. */
const UPDATE_GRACE_MS = 60_000;

export function EditionByline({
  publishedAt,
  updatedAt = null,
  periodStart,
  periodEnd,
  formats,
  sourceDisplay,
  formatNote,
}: {
  publishedAt: string | null;
  /**
   * articles.last_updated. Shown as "Updated" only when it is genuinely later
   * than publishing, the same rule the article layout uses; the date itself
   * is the dateModified the page's structured data already carries.
   */
  updatedAt?: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  formats: Array<{ slug: string; display: string }>;
  sourceDisplay: string | null;
  /** The draft's own format sentence, used only when the context did not travel. */
  formatNote: string | null;
}) {
  const period = formatPeriod(periodStart, periodEnd);
  const phrase = formatsPhrase(formats);
  const formatLine =
    phrase && sourceDisplay ? `Values and ranks are ${phrase} on ${sourceDisplay}.` : formatNote?.trim() || null;
  // Only beside a publish date: an unpublished preview otherwise reads
  // "Updated" with nothing it was updated from.
  const showUpdated =
    Boolean(updatedAt && publishedAt) &&
    new Date(updatedAt as string).getTime() - new Date(publishedAt as string).getTime() > UPDATE_GRACE_MS;

  return (
    <div className="text-sm text-ink-muted">
      <p>
        By{" "}
        <Link
          rel="author"
          href={SITE.author.bylineHref}
          className="font-semibold text-ink underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {AUTHOR_NAME}
        </Link>
        , founder of {SITE.name}.
        {publishedAt && (
          <>
            {" "}
            Published <time dateTime={publishedAt}>{formatEasternDate(publishedAt)}</time>.
          </>
        )}
        {showUpdated && updatedAt && (
          <>
            {" "}
            Updated <time dateTime={updatedAt}>{formatEasternDate(updatedAt)}</time>.
          </>
        )}
      </p>
      {(period || formatLine) && (
        <p className="mt-1">
          {period && <>Covers {period}. </>}
          {formatLine}
        </p>
      )}
    </div>
  );
}
