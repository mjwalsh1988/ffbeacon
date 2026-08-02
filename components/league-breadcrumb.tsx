import { SiteBreadcrumb, type Crumb } from "@/components/site-breadcrumb";

/**
 * One node in the breadcrumb trail. A `href` makes it a link; the last
 * crumb is always rendered as the current page regardless of `href`.
 */
export type LeagueCrumb = Crumb;

/**
 * League Pulse breadcrumb. A thin wrapper over the site breadcrumb that fixes
 * the home node to League Pulse; the caller supplies `homeHref` so the
 * searched username rides along back to the results the user came from.
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
    <SiteBreadcrumb
      homeHref={homeHref}
      homeLabel="League Pulse"
      crumbs={crumbs}
      className={className}
    />
  );
}
