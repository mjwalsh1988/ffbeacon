import { SiteBreadcrumb, type Crumb } from "@/components/site-breadcrumb";

/**
 * One node in the breadcrumb trail. A `href` makes it a link; the last crumb is
 * always rendered as the current page regardless of `href`.
 */
export type BriefCrumb = Crumb;

/**
 * Beacon Brief breadcrumb. A thin wrapper over the site breadcrumb.
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

  return (
    <SiteBreadcrumb
      homeHref={home?.href ?? "/brief"}
      homeLabel={home?.label ?? "The Beacon Brief"}
      crumbs={rest}
      className={className}
    />
  );
}
