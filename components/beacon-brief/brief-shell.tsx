import type { ReactNode } from "react";
import { PageBody } from "@/components/app-shell/page-body";
import { MobileNavDock, type DockMenu } from "@/components/mobile-nav-dock";
import type { SidebarCategory } from "@/lib/beacon-brief-feed";
import { CATEGORY_ICONS } from "./category-icons";

/**
 * The two-column frame every Beacon Brief surface renders inside: the listing
 * pages and the articles themselves.
 *
 * From xl the filter rail sits on the right and follows you down the page, the
 * way the League Pulse and player-profile rails do, capped at the viewport and
 * scrolling inside itself because it is longer than one. The content takes the
 * rest of the width.
 *
 * Below xl the rail collapses into the site's docking bar: two controls side by
 * side, Category and Filter, each opening a sheet. Category is the Brief's
 * structure and used to be reachable on a phone only through the site
 * navigation drawer; Filter is the same rail markup, so the links stay real,
 * tappable navigation. THE BAR FOLLOWS YOU DOWN. See
 * components/mobile-nav-dock.tsx, which owns the docking, the sheets, the focus
 * handling, and closing on navigation.
 *
 * `sidebar` is rendered server-side and passed in as a node, so the same markup
 * serves the desktop rail and the sheet. Server component: the only client code
 * it renders is the dock.
 */
export function BriefShell({
  sidebar,
  categories,
  activeCategorySlug = null,
  activeFilterLabel = null,
  isIndex = false,
  children,
}: {
  sidebar: ReactNode;
  /** The Brief's categories, for the Browse menu on the docking bar. */
  categories: SidebarCategory[];
  /** The category being viewed, when one is. */
  activeCategorySlug?: string | null;
  /**
   * The written name of the player, team, or tag being viewed, when one is.
   * Shown on the Filter control so the bar says "Ja'Marr Chase" rather than a
   * generic word while you are inside his coverage.
   */
  activeFilterLabel?: string | null;
  /** True on /brief itself, where "All articles" is the current page. */
  isIndex?: boolean;
  children: ReactNode;
}) {
  const activeCategory = categories.find((c) => c.slug === activeCategorySlug) ?? null;
  // A player, team, or tag view spans every category, so "All articles" is the
  // honest reading of the Browse control there, not a category name.
  const currentCategoryLabel = activeCategory?.name ?? "All articles";

  const menus: DockMenu[] = [
    {
      key: "category",
      eyebrow: "Browse",
      currentLabel: currentCategoryLabel,
      heading: "Browse by category",
      summary: "Every kind of coverage in the Brief",
      icon: "newspaper",
      activeId: isIndex ? "all" : (activeCategorySlug ?? ""),
      items: [
        {
          id: "all",
          label: "All articles",
          hint: "Everything, newest first",
          icon: "newspaper" as const,
          href: "/brief",
        },
        ...categories.map((category) => ({
          id: category.slug,
          label: category.name,
          hint: `${category.count} ${category.count === 1 ? "article" : "articles"}`,
          icon: CATEGORY_ICONS[category.slug] ?? ("newspaper" as const),
          href: `/brief/category/${category.slug}`,
        })),
      ],
    },
    {
      key: "filter",
      eyebrow: "Filter",
      currentLabel: activeFilterLabel ?? "Players and teams",
      heading: "Filter by player, team, or tag",
      summary: "Everything written about one player, team, or topic",
      icon: "sliders",
      content: sidebar,
    },
  ];

  return (
    <PageBody>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <MobileNavDock menus={menus} hideAboveClass="xl:hidden" className="mb-5" />
          {children}
        </div>

        {/* The rail. Hidden below xl, where the Filter sheet carries the same
            markup, because rendering both at once would put two copies of every
            filter link and every heading id in the document. */}
        <aside
          aria-label="Beacon Brief filters"
          // Focusable so the scroll inside it is reachable from the keyboard.
          tabIndex={0}
          className="beacon-scroll hidden xl:sticky xl:top-[5.5rem] xl:block xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1"
        >
          {sidebar}
        </aside>
      </div>
    </PageBody>
  );
}
