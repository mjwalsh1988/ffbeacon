"use client";

/**
 * Puts The Beacon Brief's categories into the site navigation rail.
 *
 * The Brief already has a row in the site tree. This contributes the same
 * section, by the same id, with the categories hung under it as a second level,
 * and the rail swaps its own copy for this one (see `mergeRailSections` in
 * components/app-shell/rail-sections.tsx). So the Brief moves to the top of the
 * rail and opens onto its categories while you are inside it, and there is still
 * exactly one "The Beacon Brief" row.
 *
 * Categories are DB rows, which is why they arrive from the page rather than
 * living in lib/nav-tree.ts. That file is loaded on every route, and it should
 * not have to query for a list only the Brief uses.
 *
 * Renders nothing.
 */

import { useMemo } from "react";
import type { Route } from "next";
import type { NavNode } from "@/lib/nav-types";
import type { NavIconName } from "@/components/app-shell/nav-icons";
import { RegisterRailSections } from "@/components/app-shell/rail-sections";
import type { SidebarCategory } from "@/lib/beacon-brief-feed";
import { CATEGORY_ICONS } from "./category-icons";

/** Matches the `brief` section in lib/nav-tree.ts, which this replaces. */
export const BRIEF_RAIL_SECTION_ID = "brief";

/**
 * Says that no row in the section is the current page: a tag view, a player
 * view, a team view, or an article. Naming it beats passing a category slug that
 * matches nothing, and it keeps aria-current off "All articles" on views that
 * are not the index.
 */
const NO_CURRENT_ROW = "brief-no-current-row";



/**
 * The row's one-line hint: how many articles are in the category, then the first
 * sentence of its description. The count is there because the filter rail shows
 * one beside every category and this row is where that number lives now.
 */
function categoryHint(category: SidebarCategory): string {
  const count = `${category.count} ${category.count === 1 ? "article" : "articles"}`;
  const first = (category.description ?? "").split(". ")[0]?.trim();
  return first ? `${count}. ${first}.` : count;
}

export function BriefRailSections({
  categories,
  /** True on /brief itself, where the section's own index row is the page. */
  isIndex,
  /** The category being viewed, when one is. */
  activeCategorySlug = null,
}: {
  categories: SidebarCategory[];
  isIndex: boolean;
  activeCategorySlug?: string | null;
}) {
  const sections = useMemo<NavNode[]>(
    () => [
      {
        id: BRIEF_RAIL_SECTION_ID,
        label: "The Beacon Brief",
        href: "/brief" as Route,
        hint: "News, injuries, and transactions",
        icon: "newspaper",
        indexLabel: "All articles",
        children: categories.map((category) => ({
          id: `brief-category-${category.slug}`,
          label: category.name,
          href: `/brief/category/${category.slug}` as Route,
          hint: categoryHint(category),
          icon: CATEGORY_ICONS[category.slug] ?? "newspaper",
        })),
      },
    ],
    [categories],
  );

  return (
    <RegisterRailSections
      sections={sections}
      openId={BRIEF_RAIL_SECTION_ID}
      active={{
        sectionId: BRIEF_RAIL_SECTION_ID,
        childId: isIndex
          ? null
          : activeCategorySlug
            ? `brief-category-${activeCategorySlug}`
            : NO_CURRENT_ROW,
      }}
    />
  );
}
