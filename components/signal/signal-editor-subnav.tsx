"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIGNAL_SUBPAGES } from "@/lib/signal/editor-nav";

/**
 * Secondary navigation within the My Signal editor, so a reader can jump
 * between the hub and any sub-page without backing out. Mirrors the admin
 * Player Values sub-nav pattern: pill chips with aria-current marking the
 * active page, 44px minimum tap targets, wrapping to multiple rows on narrow
 * screens so no chip is hidden off-screen.
 */
export function SignalEditorSubNav() {
  const pathname = usePathname();
  const chip = (active: boolean) =>
    `inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
      active
        ? "border-brand-purple bg-brand-purple/10 text-ink"
        : "border-line bg-surface text-ink-muted hover:text-ink"
    }`;

  const overviewActive = pathname === "/my-beacon/signal";

  return (
    <nav aria-label="My Signal sections" className="flex flex-wrap gap-2">
      <Link
        href="/my-beacon/signal"
        aria-current={overviewActive ? "page" : undefined}
        className={chip(overviewActive)}
      >
        Overview
      </Link>
      {SIGNAL_SUBPAGES.map((p) => {
        const active = pathname === p.href;
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
