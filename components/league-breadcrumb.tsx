import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * One node in the breadcrumb trail. A `href` makes it a link; the last
 * crumb is always rendered as the current page regardless of `href`.
 */
export type LeagueCrumb = { label: string; href?: string };

/**
 * Shared League Pulse breadcrumb. The first crumb is always the FF Beacon
 * logo linking back to the League Pulse home (with the searched username
 * forwarded by the caller via `homeHref`), followed by a chevron-separated
 * trail. The final crumb renders as `aria-current="page"`.
 *
 * This is the single source of truth for the breadcrumb design so the
 * league overview, transactions feed, and team detail pages all match.
 */
export function LeagueBreadcrumb({
  homeHref,
  crumbs,
  className,
}: {
  homeHref: string;
  crumbs: LeagueCrumb[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={`min-w-0 ${className ?? ""}`}>
      <ol className="flex items-center gap-1.5 text-sm">
        <li className="flex items-center">
          <Link
            href={homeHref}
            title="Back to League Pulse"
            aria-label="Back to League Pulse home"
            className="inline-flex items-center rounded-card p-0.5 transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/ff-beacon-logo.png"
              alt=""
              width={20}
              height={20}
              style={{ width: 20, height: 20 }}
              className="flex-shrink-0 rounded-sm"
            />
          </Link>
        </li>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={i}>
              <li
                aria-hidden="true"
                className="flex items-center text-ink-subtle"
              >
                <ChevronRight className="h-4 w-4" />
              </li>
              <li className="min-w-0">
                {crumb.href && !isLast ? (
                  <Link
                    href={crumb.href}
                    className="block truncate text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className="block truncate text-ink-muted"
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
