import Link from "next/link";

export type LeagueTabId = "overview" | "teams" | "transactions";

const TABS: { id: LeagueTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "teams", label: "Teams" },
  { id: "transactions", label: "Transactions" },
];

/**
 * Shared section tab bar for every League Pulse deep-view surface. Overview
 * and Teams render as inline tabs on `/leagues/[id]`; Transactions is its own
 * full page, so its tab links straight out. Each href forwards the searched
 * username so the in-view switcher and Teams-tab owner default survive the
 * hop, matching the rest of the deep-view navigation.
 *
 * `activeTab` drives which entry shows the purple underline + aria-current.
 * The transactions page passes `"transactions"` so users can navigate back to
 * Overview / Teams from there, the same way they move between the inline tabs.
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
    if (tabId === "transactions") {
      const s = qs.toString();
      return `/leagues/${sleeperLeagueId}/transactions${s ? `?${s}` : ""}`;
    }
    qs.set("tab", tabId);
    return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
  };

  return (
    <nav aria-label="League sections" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ul className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const isActive = t.id === activeTab;
            return (
              <li key={t.id}>
                <Link
                  href={hrefFor(t.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-block min-h-11 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-brand-purple text-ink"
                      : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
