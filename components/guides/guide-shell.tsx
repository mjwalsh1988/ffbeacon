/**
 * The frame a published guide renders inside.
 *
 * A guide used to run in a centred reading column, masthead included, which
 * left it narrower than its own index page and narrower than every tool beside
 * it. The masthead now spans the shell like every other page's does, and the
 * body takes the width with a rail beside it.
 *
 * The prose does NOT take that width. A line of body copy across a dashboard is
 * unreadable, so the main column keeps a measure and the space the rail leaves
 * is space, not longer lines.
 *
 * The rail is on the right from xl and follows you down the page, capped at the
 * viewport and scrolling inside itself. Below xl it leads the content instead,
 * which is where a contents list belongs on a phone and where the glossary's
 * jump list already sat. There is one copy of it either way: the same node
 * moves, so no anchor id is ever in the document twice.
 *
 * DOM order puts the rail first at both sizes. It is navigation for the page, so
 * a keyboard reaches it before the prose, the way a contents page comes before
 * a chapter.
 *
 * Presentational server component.
 */

import type { ReactNode } from "react";
import { PageBody } from "@/components/app-shell/page-body";

export function GuideShell({
  toc,
  children,
}: {
  /** The rail: an on-this-page nav, plus whatever else the guide steers with. */
  toc: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageBody>
      {/* The prose track fills the width it is given and stops at a readable
          measure. Past that the pair centres as a unit rather than leaving the
          rail stranded against the far edge of a very wide screen. */}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,56rem)_18rem] xl:justify-center">
        <aside
          aria-label="Guide contents"
          // Focusable so the scroll inside it is reachable from the keyboard.
          tabIndex={0}
          className="beacon-scroll min-w-0 space-y-6 xl:order-2 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1"
        >
          {toc}
        </aside>

        <div className="min-w-0 max-w-4xl xl:order-1">{children}</div>
      </div>
    </PageBody>
  );
}
