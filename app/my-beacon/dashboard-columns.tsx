"use client";

/**
 * The two columns every My Beacon page sits in.
 *
 * Same arrangement and the same 340px track as PageColumns, which this replaces
 * for this space only. The difference is that the rail is not always the account
 * summary: a page listed in lib/dashboard-rail.ts takes it instead, and this
 * decides which of the two is rendering before the first paint.
 *
 * WHEN A PAGE OWNS THE RAIL, THE COLUMN DISAPPEARS BELOW xl. Above xl the rail
 * is a real second column. Below it there is no second column and the aside
 * simply stacks under the page, which is the right answer for an account summary
 * and the wrong one for a draft board: the board's own small-screen home is a
 * sheet behind a docked button, so the same content would be on the page twice.
 * Hiding the whole aside also keeps an empty landmark out of the tab order,
 * which is what would be left if only its contents were hidden.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageBody } from "@/components/app-shell/page-body";
import { usePageRailSlot } from "@/components/app-shell/page-rail";
import { pageOwnsRail } from "@/lib/dashboard-rail";

export function DashboardColumns({
  rail,
  railLabel,
  children,
}: {
  /** The account summary, rendered on the server by the layout. */
  rail: ReactNode;
  /** Names the rail's landmark when the account summary is in it. */
  railLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const owner = pageOwnsRail(pathname);
  const slotRef = usePageRailSlot();

  return (
    <PageBody>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">{children}</div>

        <aside
          aria-label={owner ? owner.label : railLabel}
          tabIndex={0}
          className={`beacon-scroll min-w-0 space-y-6 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1 ${
            owner ? "hidden xl:block" : ""
          }`}
        >
          {/* The portal target. Always present, so a page that takes the rail
              has somewhere to render whenever it mounts. */}
          <div ref={slotRef} />
          {!owner && rail}
        </aside>
      </div>
    </PageBody>
  );
}
