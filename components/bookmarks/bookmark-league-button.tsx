"use client";

/**
 * Save a whole league, from the sheet that describes it.
 *
 * WHY THIS EXISTS. League Pulse opens a league in a slide-up sheet WITHOUT
 * changing the address, so a reader looking at a league is, as far as the URL
 * is concerned, still standing on /tools/league-pulse. The save button in the
 * breadcrumb bar behind the sheet therefore saves the tool page, which is
 * correct and was also baffling: pressing it while a league was open looked
 * like it should save the league, and instead un-saved the tool. This is the
 * control that means what the reader thought that one meant.
 *
 * It saves the league's OVERVIEW (`/leagues/<id>`) under the league's own name.
 * Individual sections inside a league are saved from the deep view itself,
 * where each one has its own address and the button in the breadcrumb row picks
 * it up: `/leagues/<id>?tab=teams`, `/leagues/<id>/lineups` and the rest are
 * each a bookmark of their own.
 *
 * IT RENDERS FOR NOBODY WHO IS SIGNED OUT. There is no server slot this deep in
 * a page, so it asks the shared store instead: something signed-in has mounted
 * in the page chrome by the time any of this is on screen, and if nothing has,
 * this stays absent rather than offering a control that would only be able to
 * tell the reader to sign in.
 *
 * TWO SHAPES, ONE BEHAVIOUR. `block` is the full-width labelled button under
 * the sheet's primary action, on a phone. `icon` is the 36px square at the end
 * of each row of the desktop league tables, where a labelled button would cost
 * a column of width that the league names need more. The accessible name is the
 * same full sentence either way, so nothing about what a screen reader hears
 * depends on which one is on screen.
 */

import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { useBookmarkAudience } from "./store";
import { useBookmarkTarget } from "./use-bookmark-target";

export function BookmarkLeagueButton({
  sleeperLeagueId,
  leagueName,
  variant = "block",
}: {
  sleeperLeagueId: string;
  /** Saved as the bookmark's name, and spoken in the button's label. */
  leagueName: string;
  variant?: "block" | "icon";
}) {
  const audience = useBookmarkAudience();
  return audience?.signedIn ? (
    <SaveLeague
      sleeperLeagueId={sleeperLeagueId}
      leagueName={leagueName}
      barEnabled={audience.barEnabled}
      variant={variant}
    />
  ) : null;
}

/**
 * Split out so the hook below runs only for a reader who can actually use it.
 * `useBookmarkTarget` subscribes to the store and can fetch, and neither is
 * worth doing for someone the button is not being offered to.
 */
function SaveLeague({
  sleeperLeagueId,
  leagueName,
  barEnabled,
  variant,
}: {
  sleeperLeagueId: string;
  leagueName: string;
  barEnabled: boolean;
  variant: "block" | "icon";
}) {
  const { saved, busy, message, warm, toggle } = useBookmarkTarget({
    // Already canonical: no `?username=`, no `?name=`. Those two describe who
    // is looking rather than which page this is, so a bookmark carrying one
    // would pin somebody else's handle forever.
    path: `/leagues/${sleeperLeagueId}`,
    label: leagueName,
    // The chrome has the list; this reads it from the store. On a handheld
    // there is none and `warm` fetches it on the first sign of intent.
    initial: { bookmarks: null, barEnabled },
  });

  const Icon = saved ? BookmarkCheck : BookmarkPlus;
  const tone = saved
    ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan hover:border-brand-cyan"
    : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink";

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        onPointerEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        // `aria-disabled`, never `disabled`: this is the control holding focus
        // when the write starts, and a disabled element loses focus to `body`
        // with nothing to hand it back.
        aria-disabled={busy || undefined}
        aria-busy={busy}
        aria-label={
          saved
            ? `Remove ${leagueName} from your bookmarks`
            : `Bookmark ${leagueName} so you can open it in one press`
        }
        className={
          variant === "icon"
            ? // 36px box with a 44px target around it, the same trick the
              // header controls use to meet the target-size rule without
              // spending the width.
              `relative inline-flex h-9 w-9 items-center justify-center rounded-card border transition-colors before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60 ${tone}`
            : `flex min-h-11 w-full items-center justify-center gap-2 rounded-card border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60 ${tone}`
        }
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
        {/* The state is in the words as well as in the glyph and the colour,
            wherever there is room for words. */}
        {variant === "block" ? (saved ? "Bookmarked" : "Bookmark this league") : null}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </>
  );
}
