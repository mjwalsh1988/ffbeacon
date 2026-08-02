import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * One node in the breadcrumb trail. A `href` makes it a link; the last crumb is
 * always rendered as the current page regardless of `href`.
 */
export type Crumb = { label: string; href?: string };

/**
 * The site-wide breadcrumb. The first node is the FF Beacon logo linking to
 * whatever "home" means for that surface, followed by a chevron-separated
 * trail whose final crumb carries `aria-current="page"`.
 *
 * This is the single source of truth for the design. League Pulse, the Beacon
 * Brief, and the player profiles all render through it, so a change to spacing,
 * colour, or focus treatment lands everywhere at once.
 */
export function SiteBreadcrumb({
  homeHref,
  homeLabel,
  crumbs,
  className,
}: {
  homeHref: string;
  /** Names the logo's destination for screen readers, e.g. "League Pulse". */
  homeLabel: string;
  crumbs: Crumb[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={`min-w-0 ${className ?? ""}`}>
      <ol className="flex items-center gap-1.5 text-sm">
        <li className="flex items-center">
          <Link
            href={homeHref}
            title={`Back to ${homeLabel}`}
            aria-label={`Back to ${homeLabel} home`}
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
              <li aria-hidden="true" className="flex items-center text-ink-subtle">
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
