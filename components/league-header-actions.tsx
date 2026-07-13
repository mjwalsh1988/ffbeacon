import { LeagueSwitcher, type SwitcherLeague } from "@/components/league-switcher";
import { CopyLinkButton } from "@/components/copy-link-button";
import { RefreshButton } from "@/components/refresh-button";

/**
 * Shared header action cluster for every League Pulse deep-view surface
 * (overview, teams, transactions feed, team detail). Renders, in order:
 * the in-view League Switcher (only when the searched user has other
 * leagues), a Copy link button, and the public Refresh button.
 *
 * Layout matches the league overview header: on mobile the switcher and
 * copy link share a row (50/50 when both present, full width when the
 * switcher is absent) and Refresh drops to a full-width line below; at sm+
 * the inner wrapper dissolves via `display:contents` so every control sits
 * inline, right aligned. Pass `className` to position the cluster inside a
 * parent grid (e.g. the overview header's `sm:col-start-2 sm:row-start-1`).
 */
export function LeagueHeaderActions({
  sleeperLeagueId,
  copyHref,
  copyAriaLabel,
  otherLeagues,
  searchedUsername,
  className,
}: {
  sleeperLeagueId: string;
  copyHref: string;
  copyAriaLabel: string;
  otherLeagues: SwitcherLeague[];
  searchedUsername: string | null;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end ${className ?? ""}`}
    >
      <div
        className={`grid gap-2 sm:contents ${
          otherLeagues.length > 0 ? "grid-cols-2" : "grid-cols-1"
        }`}
      >
        {otherLeagues.length > 0 && (
          <LeagueSwitcher
            leagues={otherLeagues}
            searchedUsername={searchedUsername}
          />
        )}
        <CopyLinkButton href={copyHref} ariaLabel={copyAriaLabel} />
      </div>
      <RefreshButton sleeperLeagueId={sleeperLeagueId} mobileFullWidth />
    </div>
  );
}
