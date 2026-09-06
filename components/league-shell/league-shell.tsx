/**
 * LeagueShell: the frame every League Pulse deep-view surface renders inside,
 * once a league has been picked.
 *
 * The navigation is not here. The league's five sections go into the site rail
 * through LeagueRailSections, opened to their own level, so a league gets a
 * sidebar without the site growing a second one and every site section stays
 * one Back press away.
 *
 * Composition, top to bottom:
 *   1. Top bar: breadcrumb on the left, the shared action cluster on the right.
 *      League Pulse draws its own trail rather than taking the site-wide bar,
 *      because it needs the league's real name where the URL only has a Sleeper
 *      id, and because the action cluster belongs beside it.
 *   2. Masthead: the league name and its context, identical on every section.
 *   3. `children`: whatever that section renders.
 *
 * Server component. LeagueRailSections is the only client code it renders, and
 * it paints nothing.
 */

import type { ReactNode } from "react";
import { LeagueBreadcrumb, type LeagueCrumb } from "@/components/league-breadcrumb";
import { LeagueHeaderActions } from "@/components/league-header-actions";
import type { SwitcherLeague } from "@/components/league-switcher";
import type { SleeperViewer } from "@/lib/sleeper-handle/types";
import { LeagueRailSections } from "./league-rail-sections";
import { LeagueMobileNav } from "./league-mobile-nav";
import { LeagueMasthead, type LeagueMastheadProps } from "./league-masthead";
import type { LeagueTabId } from "./nav-items";

export function LeagueShell({
  sleeperLeagueId,
  activeTab,
  viewer,
  homeHref,
  crumbs,
  copyHref,
  copyAriaLabel,
  otherLeagues,
  masthead,
  alert,
  children,
}: {
  sleeperLeagueId: string;
  activeTab: LeagueTabId;
  /** Who this page is acting for: the ?username= handle when there is one,
   *  otherwise the reader's saved handle. Every link built below carries the
   *  handle only when the reader arrived on one. */
  viewer: SleeperViewer | null;
  /** Back-link for the League Pulse crumb. Carries the handle only for a
   *  ?username= reader; /tools/league-pulse resolves a saved one itself. */
  homeHref: string;
  crumbs: LeagueCrumb[];
  copyHref: string;
  copyAriaLabel: string;
  otherLeagues: SwitcherLeague[];
  masthead: LeagueMastheadProps;
  /** A page-level alert rendered above the masthead (a failed refresh, say). */
  alert?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main" className="w-full">
      {/* The league's five sections go into the site rail, opened, rather than
          into a second rail of their own. */}
      <LeagueRailSections
        sleeperLeagueId={sleeperLeagueId}
        leagueName={masthead.leagueName}
        activeTab={activeTab}
        viewer={viewer}
      />
      <div className="w-full">
        <div className="min-w-0 flex-1">
          <div className="relative overflow-hidden border-b border-line bg-base/40">
            {/* Beacon-gradient accent bar, decorative. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
              <LeagueBreadcrumb homeHref={homeHref} crumbs={crumbs} />
              <LeagueHeaderActions
                copyHref={copyHref}
                copyAriaLabel={copyAriaLabel}
                otherLeagues={otherLeagues}
                viewer={viewer}
              />
            </div>
          </div>

          <div className="px-4 pb-12 pt-4 sm:px-6 lg:px-8 lg:pt-6">
            {alert}
            <LeagueMasthead {...masthead} />
            {/* Below lg there is no rail, so the sections keep a docking bar of
                their own between the masthead and the section body. It carries
                its own margins, and renders nothing at lg, so the desktop
                spacing below is untouched. */}
            <LeagueMobileNav
              sleeperLeagueId={sleeperLeagueId}
              activeTab={activeTab}
              viewer={viewer}
            />
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
