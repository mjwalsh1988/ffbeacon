/**
 * ManagerShell: the frame the Manager Pulse report renders inside, once a
 * handle has resolved.
 *
 * Composition, top to bottom:
 *   1. A skip link, since Manager Pulse does not inherit the site's rail-based
 *      skip target the way a route-per-section page can (there is no route to
 *      land the skip on; it has to land inside this shell's own main content).
 *   2. ManagerRailSections: registers the eight report sections into the site
 *      navigation rail, opened to their own level, exactly as League Pulse
 *      does for a league (components/league-shell/league-shell.tsx). Renders
 *      nothing visible itself.
 *   3. A thin top bar carrying a back link to the search entry, matching the
 *      breadcrumb treatment other deep views use, sized down because a manager
 *      report has one destination behind it rather than a switcher of leagues.
 *   4. ManagerMobileNav: the section switcher for below lg, where the rail does
 *      not exist.
 *   5. `children`: the report itself (the lens control, then every section).
 *
 * Server component. ManagerRailSections and ManagerMobileNav are the only
 * client code it renders, and neither paints anything on its own; the rail and
 * the dock read their registration from context.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ManagerRailSections } from "./manager-rail-sections";
import { ManagerMobileNav } from "./manager-mobile-nav";

/** The id the skip link and the report's opening heading share. */
export const MANAGER_SHELL_MAIN_ID = "mp-report-start";

export function ManagerShell({
  handle,
  children,
}: {
  /** Sleeper handle, already resolved (not the raw URL segment). Used for the
   *  rail's own section label ("@handle") and nothing else here. */
  handle: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="w-full">
      <a
        href={`#${MANAGER_SHELL_MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-beacon focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand-cyan"
      >
        Skip to {handle}&apos;s report
      </a>

      {/* Manager Pulse's eight sections go into the site rail, opened, rather
          than into a second rail of their own. */}
      <ManagerRailSections handle={handle} />

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
            <div className="px-4 py-4 sm:px-6 lg:px-8">
              <Link
                href="/tools/manager-pulse"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Manager Pulse
              </Link>
            </div>
          </div>

          <div id={MANAGER_SHELL_MAIN_ID} className="scroll-mt-24 px-4 pb-12 pt-4 sm:px-6 lg:px-8 lg:pt-6">
            {/* Below lg there is no rail, so the report keeps a docking bar of
                its own between the back link and the report body. It renders
                nothing at lg, so the desktop spacing below is untouched. */}
            <ManagerMobileNav />
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
