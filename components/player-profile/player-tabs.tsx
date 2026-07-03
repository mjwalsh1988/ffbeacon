/**
 * Player profile section nav, styled as the On The Clock / League Pulse
 * view-switcher: an elevated bar with a beacon hairline and a soft glow. These
 * are navigation LINKS (server-rendered tabs via ?tab=), not a client tablist,
 * so each tab is its own server render that fetches only its own data. The
 * global source/format params are preserved across tab hops so the header
 * selection continues to drive the profile. Overview is the default.
 */

import Link from "next/link";
import { LayoutDashboard, BarChart3, ArrowLeftRight, Newspaper, type LucideIcon } from "lucide-react";

export type PlayerTabId = "overview" | "statistics" | "trades" | "beacon-brief";

const TABS: { id: PlayerTabId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "statistics", label: "Statistics", icon: BarChart3 },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
  { id: "beacon-brief", label: "Beacon Brief", icon: Newspaper },
];

export function PlayerTabs({
  slug,
  activeTab,
  source,
  format,
}: {
  slug: string;
  activeTab: PlayerTabId;
  source?: string;
  format?: string;
}) {
  const hrefFor = (tabId: PlayerTabId): string => {
    const qs = new URLSearchParams();
    if (tabId !== "overview") qs.set("tab", tabId);
    if (source) qs.set("source", source);
    if (format) qs.set("format", format);
    const s = qs.toString();
    return `/players/${slug}${s ? `?${s}` : ""}`;
  };

  return (
    <nav aria-label="Player sections" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/70 p-1.5 shadow-[0_0_70px_-50px_rgba(168,85,247,0.7)] sm:p-2"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <ul className="flex flex-wrap gap-1.5">
            {TABS.map((t) => {
              const isActive = t.id === activeTab;
              const Icon = t.icon;
              return (
                <li key={t.id}>
                  <Link
                    href={hrefFor(t.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-1.5 rounded-card border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-0 ${
                      isActive
                        ? "border-brand-cyan/70 bg-brand-cyan/15 text-brand-cyan shadow-[0_0_22px_-8px_rgba(34,211,238,0.85)]"
                        : "border-transparent bg-base/50 text-ink-muted hover:bg-surface hover:text-ink"
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
