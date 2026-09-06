import { LeagueSwitcher, type SwitcherLeague } from "@/components/league-switcher";
import { CopyLinkButton } from "@/components/copy-link-button";
import type { SleeperViewer } from "@/lib/sleeper-handle/types";

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
 * COPY LINK IS ALWAYS THE CANONICAL URL, with no `?username=`, and that is
 * deliberate rather than an omission: `copyHref` is built clean by all ten
 * pages, including when the reader themselves arrived on a `?username=` link.
 *
 * The reason is what a copied link is FOR. A link that resolves to the
 * RECIPIENT's own saved handle shows them their own team, which is the correct
 * reading of "your team"; forwarding the sender's handle would highlight a
 * stranger's roster on the recipient's screen and give them no way to tell
 * why. In-view navigation is the opposite case and does forward the param when
 * the reader arrived on one (`viewerLinkUsername` in
 * components/league-shell/nav-items.ts), because there the reader is still
 * looking at the identity they asked for.
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
  viewer,
  className,
}: {
  copyHref: string;
  copyAriaLabel: string;
  otherLeagues: SwitcherLeague[];
  /** Who this page is acting for. The switcher names them and decides, from
   *  `viewer.source`, whether its own links carry the handle. */
  viewer: SleeperViewer | null;
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
          <LeagueSwitcher leagues={otherLeagues} viewer={viewer} />
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
