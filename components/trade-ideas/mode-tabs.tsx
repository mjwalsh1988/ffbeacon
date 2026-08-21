import Link from "next/link";
import { Lightbulb, Wrench } from "lucide-react";

/**
 * The two ways into Trade Ideas: a deal we found, or a deal you typed in.
 *
 * WHY THESE ARE LINKS AND NOT A CLIENT TOGGLE
 *   A tab component holding its own state would make "build a trade" a place you
 *   can only reach by clicking, which means it cannot be bookmarked, cannot be
 *   sent to a leaguemate, and cannot be server rendered. Both modes are real
 *   URLs (`?mode=suggested` and `?mode=build`), so the server picks the surface
 *   before a single byte of JavaScript runs and the back button does what a
 *   reader expects. `aria-current="page"` marks the active one, which is the
 *   correct value here because the two tabs really are two pages.
 *
 * Every identity param the page depends on rides along. Dropping `username`,
 * `source`, or `roster` on a tab press would silently re-ask "which team is
 * yours?" or quietly change the value source underneath the reader, and a
 * navigation that resets your context is worse than no navigation.
 *
 * Server component: nothing here holds state or listens for an event.
 */

export type TradeIdeasMode = "suggested" | "build";

const TABS: {
  mode: TradeIdeasMode;
  label: string;
  sub: string;
  Icon: typeof Lightbulb;
}[] = [
  { mode: "suggested", label: "Suggested", sub: "Deals we found", Icon: Lightbulb },
  { mode: "build", label: "Build a trade", sub: "Check any deal", Icon: Wrench },
];

export function ModeTabs({
  active,
  sleeperLeagueId,
  searchedUsername,
  source,
  rosterId,
}: {
  active: TradeIdeasMode;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  source: string | null;
  rosterId: number | null;
}) {
  function href(mode: TradeIdeasMode): string {
    const qs = new URLSearchParams();
    qs.set("mode", mode);
    if (searchedUsername) qs.set("username", searchedUsername);
    if (source) qs.set("source", source);
    if (rosterId !== null) qs.set("roster", String(rosterId));
    return `/leagues/${sleeperLeagueId}/trade-ideas?${qs.toString()}`;
  }

  return (
    <nav aria-label="Trade Ideas modes">
      {/* Below sm the two split the row evenly so neither reads as the minor
          one; from sm up they shrink to their content and sit left. */}
      <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {TABS.map(({ mode, label, sub, Icon }) => {
          const isActive = mode === active;
          return (
            <li key={mode}>
              <Link
                href={href(mode)}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-11 flex-col justify-center rounded-card border px-3 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:px-4 ${
                  isActive
                    ? "border-line-accent bg-surface-elevated"
                    : "border-line bg-surface/40 hover:border-brand-cyan/50"
                }`}
              >
                <span
                  className={`flex items-center gap-1.5 text-sm font-semibold ${
                    isActive ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  <Icon
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? "text-brand-cyan" : "text-ink-subtle"
                    }`}
                  />
                  {label}
                </span>
                <span className="mt-0.5 text-[11px] leading-tight text-ink-subtle">
                  {sub}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
