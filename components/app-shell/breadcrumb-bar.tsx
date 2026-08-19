"use client";

/**
 * The breadcrumb bar that runs across the top of every page, directly under the
 * header, with the beacon hairline along its top edge. It is the same bar
 * League Pulse introduced; this is the version that appears everywhere else.
 *
 * The trail is computed from the pathname (see lib/breadcrumbs.ts) rather than
 * passed down from each page, so a new route gets a breadcrumb the moment it
 * exists. A page that knows a better name for itself than its slug can pass
 * `currentLabel` through the shell and it replaces the last crumb.
 *
 * The bar is a client component, but Next.js still renders it into the initial
 * HTML, so the BreadcrumbList JSON-LD it emits is in the served markup and not
 * something a crawler has to run scripts to find. Routes that already publish
 * their own BreadcrumbList pass `emitJsonLd={false}`, so a page never carries
 * two competing trails.
 */

import { Fragment } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { buildBreadcrumbs, breadcrumbJsonLd } from "@/lib/breadcrumbs";
import { serializeJsonLd } from "@/lib/json-ld";
import { useBreadcrumbLabel } from "./breadcrumb-label";

export function BreadcrumbBar({
  currentLabel,
  emitJsonLd = true,
  visible = true,
  siteUrl,
  actions,
}: {
  /** Replaces the last crumb's label, for pages whose slug reads poorly. */
  currentLabel?: string;
  emitJsonLd?: boolean;
  /** False on a route that draws its own trail. The BreadcrumbList is still
   *  published, because that is the part such a route would otherwise lose. */
  visible?: boolean;
  siteUrl: string;
  /** Page-level controls pinned to the right of the bar. */
  actions?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  // A page that knows a better name for itself than its slug registers one; see
  // breadcrumb-label.tsx. The explicit prop wins over the registration.
  const { label: registeredLabel } = useBreadcrumbLabel();
  const finalLabel = currentLabel ?? registeredLabel;
  const crumbs = buildBreadcrumbs(pathname);
  if (finalLabel && crumbs.length > 0) {
    crumbs[crumbs.length - 1] = { label: finalLabel };
  }

  const jsonLd = emitJsonLd ? breadcrumbJsonLd(pathname, siteUrl) : null;

  // The homepage is the home node; a trail of one crumb pointing at itself is
  // noise. The bar still renders when there are actions to hold.
  const drawBar = visible && (crumbs.length > 0 || Boolean(actions));

  if (!drawBar) {
    return jsonLd ? (
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
    ) : null;
  }

  return (
    <div className="relative overflow-hidden border-b border-line bg-base/40">
      {/* Beacon-gradient hairline along the top edge, decorative. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm">
            <li className="flex items-center">
              <Link
                href="/"
                aria-label="FF Beacon home"
                title="FF Beacon home"
                // The mark stays 20px; the target around it is 44x44, which is
                // the floor for anything you are expected to tap.
                className="-my-2 inline-flex h-11 w-11 items-center justify-center rounded-card transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/img/ff-beacon-mark-96.png"
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
                <Fragment key={`${crumb.label}-${i}`}>
                  <li aria-hidden="true" className="flex items-center text-ink-subtle">
                    <ChevronRight className="h-4 w-4" />
                  </li>
                  <li className="min-w-0">
                    {crumb.href && !isLast ? (
                      <Link
                        href={crumb.href as Route}
                        className="block truncate text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        aria-current={isLast ? "page" : undefined}
                        className={`block truncate ${
                          isLast ? "font-semibold text-ink" : "text-ink-muted"
                        }`}
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
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {jsonLd && (
        <script
          type="application/ld+json"
          // Through the shared helper, per FFB-SEC-006. The pathname reaches
          // this payload, so it is caller-influenced, and the site keeps one
          // tested escaper rather than a second copy per emitter.
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
    </div>
  );
}
