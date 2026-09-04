"use client";

/**
 * Puts Manager Pulse's eight report sections into the site navigation rail.
 *
 * League Pulse's rail links to eight separate routes. Manager Pulse is one
 * page, so every row here is an in-page anchor instead: pressing one scrolls to
 * that section rather than navigating anywhere (docs/manager-pulse-plan.md
 * 7.5). Because the URL pathname never changes, the "current" row cannot come
 * from a route match the way League Pulse's rail can (see lib/nav-types.ts
 * findActiveTrail, which only ever matches an href). `useManagerActiveSection`
 * below watches each section with an IntersectionObserver instead, and reports
 * whichever one is nearest the top of the viewport, so the rail (and the
 * mobile dock in manager-mobile-nav.tsx, which imports the same hook) agree on
 * one answer to "where am I".
 *
 * Renders a live region and nothing else, matching LeagueRailSections: the
 * rail itself paints from the registration this hands to
 * components/app-shell/rail-sections.tsx.
 */

import { useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import type { NavNode } from "@/lib/nav-types";
import { RegisterRailSections } from "@/components/app-shell/rail-sections";
import {
  MANAGER_NAV_ITEMS,
  managerSectionElementId,
  managerSectionHref,
  type ManagerSection,
} from "./nav-items";

export const MANAGER_RAIL_SECTION_ID = "manager-pulse-sections";

/** The vertical band, from the top of the viewport, a section has to cross
 *  before it stops counting as "current". 96px clears the fixed site header;
 *  the -70% bottom margin means a section only becomes active once it has
 *  reached roughly the top third of the screen, matching how a reader actually
 *  reads down the page rather than flipping the active row the instant a new
 *  heading appears at the very bottom edge. */
const SCROLL_SPY_ROOT_MARGIN = "-96px 0px -70% 0px";

/** Which report section is nearest the top of the viewport right now. Shared
 *  by the rail and the mobile dock so the two never disagree. Defaults to the
 *  first section (Overview) before the observer has measured anything, which
 *  is also the correct answer on first paint. */
export function useManagerActiveSection(): ManagerSection {
  const [activeId, setActiveId] = useState<ManagerSection>(MANAGER_NAV_ITEMS[0].id);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const targets = MANAGER_NAV_ITEMS.map((item) => ({
      id: item.id,
      el: document.getElementById(managerSectionElementId(item.id)),
    })).filter((entry): entry is { id: ManagerSection; el: HTMLElement } => entry.el != null);

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        // Among the sections currently in the watched band, the one closest to
        // the top of the viewport is the one a reader is actually looking at.
        const nearest = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        const match = targets.find((entry) => entry.el === nearest.target);
        if (match) setActiveId(match.id);
      },
      { rootMargin: SCROLL_SPY_ROOT_MARGIN, threshold: 0 },
    );

    for (const target of targets) observer.observe(target.el);
    return () => observer.disconnect();
  }, []);

  return activeId;
}

export function ManagerRailSections({ handle }: { handle: string }) {
  const activeId = useManagerActiveSection();

  const sections = useMemo<NavNode[]>(
    () => [
      {
        id: MANAGER_RAIL_SECTION_ID,
        label: `@${handle}`,
        hint: "Everything about this manager",
        icon: "radio",
        children: MANAGER_NAV_ITEMS.map((item) => ({
          id: `mp-nav-${item.id}`,
          label: item.label,
          href: managerSectionHref(item.id) as Route,
          hint: item.hint,
          icon: item.icon,
        })),
      },
    ],
    [handle],
  );

  return (
    <RegisterRailSections
      sections={sections}
      openId={MANAGER_RAIL_SECTION_ID}
      active={{ sectionId: MANAGER_RAIL_SECTION_ID, childId: `mp-nav-${activeId}` }}
    />
  );
}
