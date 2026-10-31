"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/orders/new", label: "New order" },
  { href: "/admin/orders/products", label: "Products" },
  { href: "/admin/orders/coupons", label: "Coupons" },
  { href: "/admin/orders/settings", label: "Settings" },
];

export function OrdersSubnav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Orders sections" className="mt-4 border-b border-line">
      <div className="-mb-px flex flex-wrap gap-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href as Route}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center border-b-[3px] px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan sm:px-4 ${
                active ? "border-brand-purple text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
