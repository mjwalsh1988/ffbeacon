"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  History,
  SlidersHorizontal,
  Flag,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
};

// Source of truth for the admin section nav. Add a surface here and it shows up
// automatically with active styling. Built to grow as admin tooling expands.
const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Overview",
    icon: LayoutDashboard,
    description: "System stats, cron health, and recent activity at a glance.",
  },
  {
    href: "/admin/beacon",
    label: "Player Values & Sources",
    icon: SlidersHorizontal,
    description: "Value engine control: sources, weights, bands, manual signals, and the full ranking review.",
  },
  {
    href: "/admin/signal",
    label: "Signal",
    icon: Flag,
    description: "Creator profile moderation: review reported Wall posts and take them down or restore them.",
  },
  {
    href: "/admin/signal-guide",
    label: "Signal Guide",
    icon: HelpCircle,
    description: "Per-page help content: manage the questions and terms shown to visitors.",
  },
  {
    href: "/admin/crons",
    label: "Cron Logs",
    icon: History,
    description: "Every scheduled job run, with status, timing, and results.",
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="border-b border-line bg-surface/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname?.startsWith(item.href) ?? false;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={`${item.label}. ${item.description}`}
                className={`group relative inline-flex shrink-0 items-center gap-2 border-b-[3px] px-4 py-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan sm:px-5 ${
                  active
                    ? "border-brand-purple text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className={`h-4 w-4 transition-colors ${
                    active ? "text-brand-cyan" : "text-ink-subtle group-hover:text-ink"
                  }`}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
