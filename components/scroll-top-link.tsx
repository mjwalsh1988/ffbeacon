"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * A Link that puts the window back at the top on the way out.
 *
 * For links that change only the query string. components/route-scroll-reset.tsx
 * watches the pathname, and deliberately ignores query-only changes because
 * those are usually in-page refinements: changing a position filter should not
 * throw the reader back to the top of the list they are reading. Pagination is
 * the exception. "Next" sits at the bottom of a long list and loads a whole new
 * list, so leaving the reader at the bottom drops them at the end of page two
 * without ever seeing its start, and the page looks like it never loaded.
 *
 * Scrolls on click rather than after the navigation lands, so a slow page still
 * answers the tap immediately. Modifier-clicks are left alone: those open a new
 * tab and the current one should not move.
 */
export function ScrollTopLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }}
    />
  );
}
