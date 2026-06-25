"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/signal-check", label: "Settings" },
  { href: "/admin/signal-check/rules", label: "Rules" },
  { href: "/admin/signal-check/regression", label: "Regression" },
];

export function SignalCheckSubnav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Signal Check sections" className="border-b border-line">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="-mb-px flex gap-1">
          {ITEMS.map((item) => {
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
