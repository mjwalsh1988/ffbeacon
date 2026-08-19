"use client";

/**
 * The frame every page renders inside: the navigation rail down the left, the
 * breadcrumb bar across the top of the content column, and then the page.
 *
 * It is a client component only because the two decisions it makes both depend
 * on the pathname: whether the route brings its own breadcrumb (League Pulse
 * does, and it carries the league action cluster alongside it), and whether the
 * route already publishes its own BreadcrumbList. Making the layout read the
 * pathname on the server would mean opting the whole site out of static
 * rendering for two booleans. The page itself is a server-rendered child passed
 * straight through, so nothing about it moves to the client.
 */

import { usePathname } from "next/navigation";
import { hasOwnBreadcrumb, hasOwnBreadcrumbJsonLd } from "@/lib/breadcrumbs";
import { BreadcrumbBar } from "./breadcrumb-bar";

export function AppShell({
  rail,
  siteUrl,
  children,
}: {
  /** The navigation rail, rendered on the server and handed in as a slot so
   *  the layout above does not have to await anything to build this frame. */
  rail: React.ReactNode;
  siteUrl: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const ownBreadcrumb = hasOwnBreadcrumb(pathname);

  return (
    <div className="flex w-full flex-1 items-start">
      {rail}
      <div className="min-w-0 flex-1">
        {/* `visible={false}` on a route with its own trail: the bar draws
            nothing but still publishes the BreadcrumbList, which is otherwise
            the one thing League Pulse would lose by drawing its own. */}
        <BreadcrumbBar
          siteUrl={siteUrl}
          visible={!ownBreadcrumb}
          emitJsonLd={!hasOwnBreadcrumbJsonLd(pathname)}
        />
        {children}
      </div>
    </div>
  );
}
