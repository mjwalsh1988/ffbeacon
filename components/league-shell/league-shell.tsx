/**
 * LeagueShell: the frame every League Pulse deep-view surface renders inside,
 * once a league has been picked. It replaces the old centered `max-w-7xl`
 * column with a full-bleed dashboard: a section rail down the left running the
 * height of the viewport, and a content column that uses the rest of the width
 * at every breakpoint.
 *
 * Composition, top to bottom in the content column:
 *   1. Top bar: breadcrumb on the left, the shared action cluster on the right.
 *   2. Mobile section bar (below lg): the rail's contents behind one button
 *      that docks under the site header on scroll.
 *   3. Masthead: the league name and its context, identical on every section.
 *   4. `children`: whatever that section renders.
 *
 * The rail is `sticky` under the 72px site header rather than `fixed`, so it
 * never overlaps the footer and needs no page-level padding compensation.
 *
 * Server component. The two nav pieces are the only client code, and they own
 * nothing but their own open/collapsed state.
 */

import type { ReactNode } from "react";
import { LeagueBreadcrumb, type LeagueCrumb } from "@/components/league-breadcrumb";
import { LeagueHeaderActions } from "@/components/league-header-actions";
import type { SwitcherLeague } from "@/components/league-switcher";
import { LeagueSideNav } from "./league-side-nav";
import { LeagueMobileNav } from "./league-mobile-nav";
import { LeagueMasthead, type LeagueMastheadProps } from "./league-masthead";
import type { LeagueTabId } from "./nav-items";

export function LeagueShell({
  sleeperLeagueId,
  activeTab,
  searchedUsername,
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
  searchedUsername: string | null;
  /** Back-link for the League Pulse crumb, with the searched handle attached. */
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
      <div className="flex w-full items-start">
        <LeagueSideNav
          sleeperLeagueId={sleeperLeagueId}
          activeTab={activeTab}
          searchedUsername={searchedUsername}
        />

        <div className="min-w-0 flex-1">
          <div className="relative overflow-hidden border-b border-line">
            {/* Beacon-gradient accent bar, decorative. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
              <LeagueBreadcrumb homeHref={homeHref} crumbs={crumbs} />
              <LeagueHeaderActions
                sleeperLeagueId={sleeperLeagueId}
                copyHref={copyHref}
                copyAriaLabel={copyAriaLabel}
                otherLeagues={otherLeagues}
                searchedUsername={searchedUsername}
              />
            </div>
          </div>

          <LeagueMobileNav
            sleeperLeagueId={sleeperLeagueId}
            activeTab={activeTab}
            searchedUsername={searchedUsername}
          />

          <div className="px-4 pb-12 pt-4 sm:px-6 lg:px-8 lg:pt-6">
            {alert}
            <LeagueMasthead {...masthead} />
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
