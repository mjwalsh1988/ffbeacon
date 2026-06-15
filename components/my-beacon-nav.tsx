"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListOrdered,
  Trophy,
  Settings,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Used as the announced description for the active section. */
  description: string;
};

// Source of truth for the My Beacon section nav. Adding a new dashboard
// surface? Add the entry here and it picks up the sliding-highlight
// treatment automatically.
const NAV_ITEMS: NavItem[] = [
  {
    href: "/my-beacon",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Overview of your account, preferences, and activity.",
  },
  {
    href: "/my-beacon/rankings",
    label: "My Rankings",
    icon: ListOrdered,
    description: "Build and reorder your own custom player ranking boards.",
  },
  {
    href: "/my-beacon/sleeper-leagues",
    label: "My Sleeper Leagues",
    icon: Trophy,
    description: "Saved Sleeper username and every active league synced from it.",
  },
  {
    href: "/my-beacon/account",
    label: "Account Settings",
    icon: Settings,
    description:
      "Manage linked sign-in providers, password, email, and active sessions.",
  },
];

export function MyBeaconNav() {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [highlight, setHighlight] = useState<{ left: number; width: number } | null>(null);
  // `animate` gates the CSS transition. We snap to the active tab on first
  // measure (no animation), then turn transitions on so subsequent
  // navigations glide between tabs.
  const [animate, setAnimate] = useState(false);

  // Exact-match for /my-beacon (so the parent doesn't claim active on child
  // routes), prefix-match for everything else.
  const activeIndex = NAV_ITEMS.findIndex((item) =>
    item.href === "/my-beacon"
      ? pathname === "/my-beacon"
      : pathname?.startsWith(item.href) ?? false,
  );

  useLayoutEffect(() => {
    const measure = () => {
      if (activeIndex < 0 || !containerRef.current) {
        setHighlight(null);
        return;
      }
      const tab = tabRefs.current[activeIndex];
      if (!tab) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      setHighlight({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      });
    };
    measure();
    // Re-measure on resize so the highlight stays glued to the active tab
    // when the viewport changes (mobile rotation, devtools open, etc).
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeIndex, pathname]);

  // After the very first measure, enable the transition. Without this gate
  // the highlight would animate from `left: 0` into position on initial
  // page load, which looks like a glitch.
  useEffect(() => {
    if (highlight && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(id);
    }
  }, [highlight, animate]);

  return (
    <nav aria-label="My Beacon sections" className="border-b border-line bg-surface/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          ref={containerRef}
          className="relative -mb-px flex gap-1 overflow-x-auto"
        >
          {highlight && (
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-beacon ${
                animate
                  ? "motion-safe:transition-[left,width] motion-safe:duration-300 motion-safe:ease-out"
                  : ""
              }`}
              style={{
                left: highlight.left,
                width: highlight.width,
                boxShadow: "0 0 18px -4px rgba(168, 85, 247, 0.55)",
              }}
            />
          )}
          {NAV_ITEMS.map((item, i) => {
            const Icon = item.icon;
            const active = i === activeIndex;
            return (
              <Link
                key={item.href}
                href={item.href}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                aria-current={active ? "page" : undefined}
                aria-label={`${item.label}. ${item.description}`}
                className={`group relative inline-flex shrink-0 items-center gap-2 px-4 py-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan sm:px-5 ${
                  active
                    ? "text-ink"
                    : "text-ink-muted hover:text-ink"
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
