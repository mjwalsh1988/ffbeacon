"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRIEF_DESK_SUBPAGES } from "@/lib/brief-desk-admin-nav";

/** Secondary nav within the Brief desk, so a reader can jump between sibling
 *  sub-pages without returning to the overview. aria-current marks the active
 *  page for assistive tech. The Editions chip stays active on a review page,
 *  and aria-current is read off the same flag as the colour, so the chip that
 *  looks current announces as current too. */
export function BriefDeskSubNav() {
  const pathname = usePathname();
  const chip = (active: boolean) =>
    `inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
      active
        ? "border-brand-purple bg-brand-purple/10 text-ink"
        : "border-line bg-surface text-ink-muted hover:text-ink"
    }`;

  return (
    <nav aria-label="Brief desk sections" className="flex flex-wrap gap-2">
      <Link
        href="/admin/brief-desk"
        aria-current={pathname === "/admin/brief-desk" ? "page" : undefined}
        className={chip(pathname === "/admin/brief-desk")}
      >
        Overview
      </Link>
      {BRIEF_DESK_SUBPAGES.map((p) => {
        const active = pathname === p.href || pathname.startsWith(`${p.href}/`);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={chip(active)}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
