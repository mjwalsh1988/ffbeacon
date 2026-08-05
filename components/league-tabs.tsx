import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  ArrowLeftRight,
  Activity,
  Handshake,
  type LucideIcon,
} from "lucide-react";

export type LeagueTabId =
  | "overview"
  | "teams"
  | "power-pulse"
  | "trade-finder"
  | "transactions";

const TABS: { id: LeagueTabId; label: string; icon: LucideIcon; isNew?: boolean }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "teams", label: "Teams", icon: Users },
  { id: "power-pulse", label: "Power Pulse", icon: Activity },
  { id: "trade-finder", label: "Trade Finder", icon: Handshake, isNew: true },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
];

/**
 * Shared section nav for every League Pulse deep-view surface, styled as the
 * On The Clock cockpit view-switcher: an elevated bar with a beacon hairline and
 * a soft glow, holding one control per section. Overview and Teams render as
 * inline views on `/leagues/[id]`; Transactions is its own full page, so its
 * link routes straight out. Each href forwards the searched username so the
 * in-view switcher and Teams-tab owner default survive the hop.
 *
 * These are navigation LINKS to different routes, not in-place tabs, so the
 * pattern is <nav> + <Link aria-current="page">, not a tablist. `activeTab`
 * drives the cyan active treatment + aria-current.
 */
export function LeagueTabs({
  sleeperLeagueId,
  activeTab,
  searchedUsername,
}: {
  sleeperLeagueId: string;
  activeTab: LeagueTabId;
  searchedUsername: string | null;
}) {
  const hrefFor = (tabId: LeagueTabId): string => {
    const qs = new URLSearchParams();
    if (searchedUsername) qs.set("username", searchedUsername);
    // Transactions, Power Pulse, and Trade Finder are full routes of their own;
    // Overview and Teams are inline views on the deep view.
    if (
      tabId === "transactions" ||
      tabId === "power-pulse" ||
      tabId === "trade-finder"
    ) {
      const s = qs.toString();
      return `/leagues/${sleeperLeagueId}/${tabId}${s ? `?${s}` : ""}`;
    }
    qs.set("tab", tabId);
    return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
  };

  return (
    <nav aria-label="League sections" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/70 p-1.5 shadow-[0_0_70px_-50px_rgba(168,85,247,0.7)] sm:p-2"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
          }}
        >
          {/* Top-edge beacon hairline, decorative (matches the cockpit panels). */}
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
                    {/* "New" is part of the link's accessible name, so a screen
                        reader hears it as one label rather than a stray word. */}
                    {t.isNew && (
                      <span className="ml-0.5 rounded-full bg-beacon px-1.5 py-px text-[9px] font-extrabold uppercase tracking-[0.1em] text-black">
                        New
                      </span>
                    )}
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
