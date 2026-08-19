"use client";

/**
 * The site-wide navigation rail: the sections of FF Beacon running down the
 * left of every page, the height of the viewport, beneath the header.
 *
 * Collapsed to a strip of icons by default so the page keeps its width, and
 * widened by the toggle in the header, which remembers the choice per browser.
 * Sections with sub-pages open a second level in place (see nav-levels.tsx)
 * rather than a flyout, so the rail never covers what you are reading.
 *
 * A route can add its own section to the top of the rail and have it open on
 * arrival: that is how a league's five sections appear once you are inside a
 * league, without a second rail. See rail-sections.tsx.
 *
 * Desktop only, lg and up. Below that the same tree comes from the drawer in
 * app-mobile-nav.tsx. Nothing is dropped on the small layout, only relocated.
 *
 * Sticky rather than fixed, so it stops at the footer instead of floating over
 * it, and so no page needs left padding to compensate for it.
 */

import { usePathname } from "next/navigation";
import { findActiveTrail, type NavNode } from "@/lib/nav-types";
import { NavLevels } from "./nav-levels";
import { useSidebar } from "./sidebar-state";
import { useRailSections } from "./rail-sections";

export function AppRail({ sections }: { sections: NavNode[] }) {
  const pathname = usePathname() ?? "/";
  const { open } = useSidebar();
  const { extra, openId, active } = useRailSections();
  const tree = [...extra, ...sections];
  // Both trails are passed down. A route that contributed sections states
  // which of its rows is current, because those rows can differ only by a query
  // string or by which view is showing and a pathname cannot tell them apart.
  // The pathname trail still marks the site row you are on, which is true at
  // the same time: inside a draft room you are on the Grades view AND on
  // /tools/on-the-clock.
  const trail = findActiveTrail(tree, pathname);

  return (
    // A plain box, not an <aside>: the nav landmark is inside, rendered by
    // NavLevels, and wrapping it in a complementary landmark would file the
    // site's primary navigation under "complementary" in the landmark list.
    // `self-start` is load-bearing: a flex child stretches by default, and a
    // stretched item can never be sticky.
    <div
      id="app-rail"
      className="app-rail sticky top-[4.5rem] hidden h-[calc(100dvh-4.5rem)] shrink-0 self-start flex-col border-r border-line bg-surface/50 lg:flex"
    >
      <NavLevels
        tree={tree}
        activeSectionId={trail.sectionId}
        activeChildId={trail.childId}
        contributedActive={active}
        variant="rail"
        onRequestExpand={open}
        defaultOpenId={openId}
      />
    </div>
  );
}
