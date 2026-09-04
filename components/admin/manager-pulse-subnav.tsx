"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MANAGER_PULSE_SUBPAGES } from "@/lib/manager-pulse-admin-nav";

/** Secondary nav within Manager Pulse, so a reader can jump between sibling
 *  sub-pages without returning to the overview. aria-current marks the active
 *  page for assistive tech. */
export function ManagerPulseSubnav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Manager Pulse sections" className="border-b border-line">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="-mb-px flex flex-wrap gap-1">
          {MANAGER_PULSE_SUBPAGES.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-[3px] px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan ${
                  active ? "border-brand-purple text-ink" : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
