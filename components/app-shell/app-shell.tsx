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
  bookmarkAction,
  siteUrl,
  children,
}: {
  /** The navigation rail, rendered on the server and handed in as a slot so
   *  the layout above does not have to await anything to build this frame. */
  rail: React.ReactNode;
  /**
   * The save-this-page button, pinned to the right of the breadcrumb bar. A
   * slot for the same reason the rail is: it needs an auth read, and the layout
   * above must not await one.
   *
   * A route with its own breadcrumb draws its own copy of this button beside
   * its own trail (League Pulse does), because the shared bar is not painted
   * there at all.
   */
  bookmarkAction?: React.ReactNode;
  siteUrl: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const ownBreadcrumb = hasOwnBreadcrumb(pathname);
  // The homepage is the home node, so it has no trail and draws no bar. Handing
  // it an action would make one appear there for the first time, holding a
  // logo, a save button, and nothing else. It is also the one page nobody needs
  // a shortcut back to.
  const isHome = pathname === "/";

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
          actions={ownBreadcrumb || isHome ? undefined : bookmarkAction}
        />
        {children}
      </div>
    </div>
  );
}
