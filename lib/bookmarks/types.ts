/**
 * The bookmark bar: shared shapes and the rules that hold across every surface.
 *
 * WHAT THIS FEATURE IS. A signed-in reader saves the page they are standing on
 * and gets it back as a one-click shortcut. On a desktop that is a bar under
 * the header, browser-style, with a pull tab that slides it up behind the
 * header. On a phone there is no bar at all: the header carries an icon that
 * opens the same list as a bottom sheet.
 *
 * ABSOLUTE RULE: A BOOKMARK IS A SAME-ORIGIN PATH AND NOTHING ELSE. Every
 * stored value goes through `normalizeBookmarkPath` in ./path.ts before it
 * reaches the database, and the database repeats the check (migration 0279).
 * The value ends up in an `href`, so a protocol-relative or off-origin one must
 * not reach the database.
 *
 * ABSOLUTE RULE: THE ICON IS DERIVED, NEVER STORED. `bookmarkIconFor` in
 * ./icon.ts turns a path into the glyph the navigation already uses for that
 * destination, so a bookmark saved today picks up tomorrow's icon for the tool
 * it points at. A stored icon would be one reader's frozen copy of a decision
 * that belongs to the navigation.
 *
 * A LEAGUE'S OWN LOGO IS DERIVED THE SAME WAY. A bookmark pointing at
 * /leagues/<id> is given that league's Sleeper avatar as its icon, looked up
 * from `leagues.metadata` when the list is read rather than copied onto the
 * bookmark row. A commissioner who changes the league logo changes every
 * reader's bookmark with it, and a league we have not synced yet simply falls
 * back to the same shield the league lists use.
 *
 * ABSOLUTE RULE: SAVING A PAGE THAT IS ALREADY SAVED NEVER CHANGES ITS NAME.
 * The save button derives a default label from the breadcrumb, so an add that
 * overwrote on conflict would quietly revert a bookmark the reader had renamed,
 * and would report it as "Saved". `addBookmark` leaves an existing row alone
 * and says so through `created`.
 *
 * ORDERING. `sortOrder` is a position, 0..n-1 with no gaps, rewritten as one
 * batched upsert whenever a move or a delete disturbs it. Nothing reads it as a
 * weight and nothing depends on the gaps being meaningful; what a reader sees
 * is the array index. The dense invariant is kept because it makes every
 * comparison in the UI trivial, not because anything downstream requires it,
 * and `created_at` breaks any tie a race could leave behind.
 */

/** One saved page. */
export type Bookmark = {
  id: string;
  /** Same-origin path, always starting with a single "/". */
  path: string;
  label: string;
  /** 0-based position in the reader's own list. */
  sortOrder: number;
  /**
   * An icon to paint instead of the derived glyph: today, a league's own
   * Sleeper logo. Null for everything else, and for a league that has not set
   * one, which falls back to the shield `bookmarkIconFor` returns.
   *
   * Resolved at read time, never stored. See the rule above.
   */
  imageUrl: string | null;
};

/**
 * Everything the bookmark UI needs, resolved on the server once per request.
 *
 * `bookmarks` is `null` rather than `[]` when the list was NOT loaded, which
 * is a different fact from "this reader has none". It is null for a signed-out
 * reader and on a phone, where the server deliberately does no bookmark read at
 * all (see lib/bookmarks/load.ts). The client fetches it on demand there.
 */
export type BookmarkState = {
  signedIn: boolean;
  /** Null when the list was not loaded on the server. */
  bookmarks: Bookmark[] | null;
  /** The reader's saved "show the bar" preference. */
  barEnabled: boolean;
  /**
   * True when this request came from a phone or tablet, in which case the bar
   * is not rendered and no bookmark read happened.
   */
  isHandheld: boolean;
};

/** The signed-out answer, and the shape every failed read falls back to. */
export const SIGNED_OUT_BOOKMARK_STATE: BookmarkState = {
  signedIn: false,
  bookmarks: null,
  barEnabled: true,
  isHandheld: false,
};

/**
 * How many pages one reader may keep.
 *
 * The bar has to stay a bar: past a couple of dozen it is a horizontal scroll
 * nobody can scan, and the point of the feature is getting somewhere in one
 * click. It also bounds what a forged payload can make us write. Enforced in
 * `addBookmark` and again by a trigger on the table (migration 0280), so two
 * requests in flight at once cannot slip past a read-then-write check.
 */
export const MAX_BOOKMARKS = 40;

/** Matches the database check on `user_bookmarks.label`. */
export const MAX_BOOKMARK_LABEL_LENGTH = 60;

/** Matches the database check on `user_bookmarks.path`. */
export const MAX_BOOKMARK_PATH_LENGTH = 512;

/** The result shape every bookmark action returns. */
export type BookmarkResult =
  | {
      ok: true;
      bookmarks: Bookmark[];
      barEnabled: boolean;
      /**
       * Only `addBookmark` sets this. False when the page was already saved, so
       * the caller can say "already in your bookmarks" rather than claiming to
       * have done something it deliberately did not do.
       */
      created?: boolean;
    }
  | { ok: false; error: string };
