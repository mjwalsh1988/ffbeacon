import { getNavViewer } from "@/lib/nav-viewer";
import { buildNavTree } from "@/lib/nav-tree";
import { AppRail } from "./app-rail";

/**
 * Loads the rail's sections and renders the rail.
 *
 * This exists so the root layout can stay synchronous. An `await` in the layout
 * body blocks React from descending into `children` until it resolves, which
 * put one auth round trip in front of every page's own data fetching. As an
 * async child the same work runs alongside the page instead of ahead of it.
 *
 * The tree is cut down here, on the server, because `lib/nav-tree.ts` names
 * every admin route on the site and filtering it in the browser would still
 * have shipped the whole list to everyone.
 */
export async function AppRailSections() {
  const sections = buildNavTree(await getNavViewer());
  return <AppRail sections={sections} />;
}

/**
 * What stands in the rail's place while it loads: the same width, the same
 * border, and nothing in it. The width comes from `--app-rail-w`, so the swap
 * costs no layout shift.
 */
export function AppRailFallback() {
  return (
    <div
      aria-hidden="true"
      className="app-rail sticky top-[4.5rem] hidden h-[calc(100dvh-4.5rem)] shrink-0 self-start border-r border-line bg-surface/50 lg:block"
    />
  );
}
