import { LeagueSwitcher, type SwitcherLeague } from "@/components/league-switcher";
import { CopyLinkButton } from "@/components/copy-link-button";

/**
 * Shared header action cluster for every League Pulse deep-view surface
 * (overview, teams, transactions feed, team detail): the in-view League
 * Switcher, shown only when the searched user has other leagues, and a Copy
 * link button.
 *
 * ONE ROW ON A PHONE. The switcher takes the width and Copy link is a square
 * glyph on the right, because switching leagues is the control people reach for
 * and copying a link is the one they occasionally do. Both were 50/50 before,
 * which gave a button that says one word the same room as a picker naming a
 * league. From sm up the wrapper dissolves via `display:contents`, the copy
 * button grows its label back, and both sit inline and right aligned.
 *
 * Refresh used to live here and is now a row in the league's section of the
 * navigation rail (components/league-shell/league-rail-sections.tsx). It is an
 * occasional maintenance action rather than something you reach for while
 * reading a league, and it was the only control here that could push the row
 * onto a second line.
 *
 * `w-full` on mobile is load-bearing. Most deep-view headers put this cluster
 * in a `flex flex-wrap` row beside the breadcrumb, where a flex item sizes to
 * its content: without it the whole cluster shrank to a narrow column against
 * the right edge instead of spanning the container.
 */
export function LeagueHeaderActions({
  copyHref,
  copyAriaLabel,
  otherLeagues,
  searchedUsername,
  className,
}: {
  copyHref: string;
  copyAriaLabel: string;
  otherLeagues: SwitcherLeague[];
  searchedUsername: string | null;
  className?: string;
}) {
  return (
    <div
      className={`flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end ${className ?? ""}`}
    >
      <div
        className={`grid gap-2 sm:contents ${
          otherLeagues.length > 0
            ? "grid-cols-[minmax(0,1fr)_auto]"
            : "grid-cols-1"
        }`}
      >
        {otherLeagues.length > 0 && (
          <LeagueSwitcher
            leagues={otherLeagues}
            searchedUsername={searchedUsername}
          />
        )}
        <CopyLinkButton
          href={copyHref}
          ariaLabel={copyAriaLabel}
          compactBelowSm={otherLeagues.length > 0}
        />
      </div>
    </div>
  );
}
