"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BEACON_SUBPAGES } from "@/lib/beacon-admin-nav";

/** Secondary nav within Values, Rankings, & Sources, so a reader can jump between
 *  sibling sub-pages without returning to the overview. aria-current marks the
 *  active page for assistive tech. */
export function BeaconSubNav() {
  const pathname = usePathname();
  const chip = (active: boolean) =>
    `inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
      active ? "border-brand-purple bg-brand-purple/10 text-ink" : "border-line bg-surface text-ink-muted hover:text-ink"
    }`;

  return (
    <nav aria-label="Values, Rankings, and Sources sections" className="flex flex-wrap gap-2">
      <Link
        href="/admin/beacon"
        aria-current={pathname === "/admin/beacon" ? "page" : undefined}
        className={chip(pathname === "/admin/beacon")}
      >
        Overview
      </Link>
      {BEACON_SUBPAGES.map((p) => {
        const active = pathname === p.href;
        return (
          <Link key={p.href} href={p.href} aria-current={active ? "page" : undefined} className={chip(active)}>
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
