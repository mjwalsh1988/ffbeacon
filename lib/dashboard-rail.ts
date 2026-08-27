/**
 * Which My Beacon pages take the right-hand rail for themselves.
 *
 * The rail normally carries the account summary: your Signal, your format and
 * source, when you joined. That is right for most of the space, and wrong for a
 * live draft board, where the one thing worth having beside the list is the team
 * you are building.
 *
 * WHY A ROUTE TEST AND NOT A CLAIM FROM THE PAGE. The page cannot tell the
 * layout anything before it renders: a layout and its page render as siblings,
 * and a claim registered in an effect only lands after hydration. Deciding from
 * the pathname is available during the server render, so the rail is right in
 * the very first HTML rather than showing the account summary and then swapping
 * it out under the reader a second later.
 *
 * The cost is that a page taking the rail has to say so here as well as render
 * the content. That is one line, in one greppable place, and it is checked by
 * lib/dashboard-rail.test.ts.
 */

/** The rail a page has taken, or null when the account summary keeps it. */
export type PageRailOwner = { label: string } | null;

/** A draft board id, and nothing else. `new` is the setup wizard, not a board. */
const DRAFT_BOARD = /^\/my-beacon\/draft-tracker\/(?!new$)[^/]+$/;

export function pageOwnsRail(pathname: string | null | undefined): PageRailOwner {
  if (!pathname) return null;
  // Trailing slashes are not how this app links, but a pasted URL can carry one.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (DRAFT_BOARD.test(path)) {
    return { label: "Your team so far" };
  }
  return null;
}
