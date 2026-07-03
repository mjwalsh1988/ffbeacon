import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * One node in the breadcrumb trail. A `href` makes it a link; the last crumb is
 * always rendered as the current page regardless of `href`.
 */
export type BriefCrumb = { label: string; href?: string };

/**
 * Shared Beacon Brief breadcrumb. Mirrors the League Pulse breadcrumb design:
 * the first crumb is the FF Beacon logo (linking to the Beacon Brief home),
 * followed by a chevron-separated trail. The final crumb renders as
 * `aria-current="page"`.
 *
 * `crumbs[0]` is the home node rendered as the logo (its `href` is the logo
 * link, its `label` names the destination for screen readers). The remaining
 * crumbs render as the text trail.
 */
export function BriefBreadcrumb({
  crumbs,
  className,
}: {
  crumbs: BriefCrumb[];
  className?: string;
}) {
  const [home, ...rest] = crumbs;
  const homeHref = home?.href ?? "/brief";
  const homeLabel = home?.label ?? "The Beacon Brief";

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
        {rest.map((crumb, i) => {
          const isLast = i === rest.length - 1;
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
