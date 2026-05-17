"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { ReactNode } from "react";

export function HeaderNavLink({
  href,
  children,
}: {
  href: Route;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-card px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-surface text-ink"
          : "text-ink-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
