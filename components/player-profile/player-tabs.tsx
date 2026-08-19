/**
 * Switching profile section on a phone.
 *
 * The four sections live in the site navigation rail, which is where navigation
 * belongs and which is the whole point of the rail. But the rail only exists
 * from lg up. Below that the same rows are in the site navigation drawer, and
 * reaching them costs opening a modal from the header, finding the section, and
 * pressing a row. So below lg the profile carries this strip instead, sitting
 * where the old full-width tab bar used to.
 *
 * The rail rows remain the canonical switcher, and this reads the same list
 * (nav-items.ts), so the two can never disagree. Nothing here is exclusive to
 * the small layout: every row exists in the rail and in the drawer.
 *
 * These are navigation LINKS, not a client tablist: each section is its own
 * server render that fetches only its own data. Server component.
 */

import Link from "next/link";
import { navIcon } from "@/components/app-shell/nav-icons";
import { PLAYER_NAV_ITEMS, playerTabHref, type PlayerTabId } from "./nav-items";

export type { PlayerTabId } from "./nav-items";

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
  return (
    <nav
      aria-label="Player sections"
      className="px-4 pt-4 sm:px-6 lg:hidden"
    >
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
          {PLAYER_NAV_ITEMS.map((item) => {
            const isActive = item.id === activeTab;
            const Icon = navIcon(item.icon);
            return (
              <li key={item.id}>
                <Link
                  href={playerTabHref(slug, item.id, source, format)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-1.5 rounded-card border border-l-2 px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    isActive
                      ? "border-transparent border-l-brand-purple bg-ink/[0.07] text-ink"
                      : "border-transparent bg-base/50 text-ink-muted hover:bg-ink/[0.05] hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  {item.label}
                  {/* The hint belongs to the accessible name here too, so a row
                      announces the same thing in this strip as it does in the
                      rail and the drawer. */}
                  <span className="sr-only">. {item.hint}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
