"use server";

/**
 * Every write the bookmark bar makes, and the one read the mobile sheet makes.
 *
 * SECURITY SHAPE, and it is the same on all seven:
 *   1. Re-derive the caller from the request-scoped session client. Nothing is
 *      ever trusted from an argument, and there is no user id in any signature.
 *   2. Validate the payload. A path goes through `normalizeBookmarkPath`, which
 *      is a security boundary rather than a tidying step (see lib/bookmarks/
 *      path.ts): the value ends up in an `href`, so a protocol-relative or
 *      off-origin one must not reach the database.
 *   3. Scope the write by id AND rely on the owner-only RLS policies
 *      (`user_bookmarks_*_own`, migration 0279) as the backstop. A guessed id
 *      matches nothing, and the reply is the same "could not find" a genuinely
 *      missing row gets, so the actions are not an existence oracle either.
 *
 * EVERY ACTION RETURNS THE WHOLE LIST. The client never computes what the new
 * order is; it applies what came back. That is what keeps the bar, the mobile
 * sheet and the manage page from ever showing three different orders for the
 * same account, and it is why a move is one round trip rather than two.
 *
 * NO REVALIDATION CALL, deliberately. The bookmark state is read in the root
 * layout, which renders once per full page load, and every surface that shows
 * bookmarks subscribes to the client store these results feed. Busting the
 * layout would throw away every route's cache to refresh a row of shortcuts.
 *
 * NO RATE LIMIT, deliberately, and this is the considered position rather than
 * an omission. Every action needs a real session, every write is scoped to the
 * caller's own rows, and the row count is capped by a database trigger, so the
 * worst an account can do to itself is spend its own requests. That matches how
 * this codebase treats user-owned CRUD (app/my-beacon/rankings/actions.ts has
 * no limiter either); `lib/rate-limit-claim.ts` is reserved for expensive or
 * unauthenticated surfaces. Revisit if a bookmark write ever grows a Sleeper
 * call or a model run behind it.
 */

import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { readBookmarks } from "@/lib/bookmarks/load";
import {
  normalizeBookmarkLabel,
  normalizeBookmarkPath,
} from "@/lib/bookmarks/path";
import {
  MAX_BOOKMARKS,
  type Bookmark,
  type BookmarkResult,
} from "@/lib/bookmarks/types";

const TABLE = "user_bookmarks";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The origins a pasted absolute URL may carry on the manage page's add form. */
const SITE_ORIGINS = [SITE.url];

type Caller = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

async function requireCaller(): Promise<Caller | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id };
}

const SIGNED_OUT: BookmarkResult = {
  ok: false,
  error: "You need to be signed in to use bookmarks.",
};

/** The caller's list plus their bar preference, in the shape every action returns. */
async function currentState(caller: Caller): Promise<BookmarkResult> {
  const [bookmarks, barEnabled] = await Promise.all([
    readBookmarks(),
    barPreference(caller),
  ]);
  return { ok: true, bookmarks, barEnabled };
}

/**
 * The caller's bookmarks. This is the one READ here, and it exists for the
 * mobile sheet: on a phone the server does no bookmark query at all
 * (lib/bookmarks/load.ts), so the list is fetched once, on the first open.
 */
export async function listBookmarks(): Promise<BookmarkResult> {
  const caller = await requireCaller();
  if (!caller) return SIGNED_OUT;
  return currentState(caller);
}

/**
 * Save a page.
 *
 * A page that is ALREADY saved is left exactly as it is, and comes back with
 * `created: false`. It is not an update, and specifically not an update of the
 * label: the save button derives its label from the breadcrumb, so overwriting
 * on conflict would silently revert a bookmark the reader had renamed and then
 * announce it as "Saved". That mattered most on a phone, where the button does
 * not yet know whether the page is saved when the reader first presses it.
 *
 * A new bookmark lands at the END of the list, which is where a reader who just
 * pressed save expects to find it.
 */
export async function addBookmark(
  rawPath: unknown,
  rawLabel: unknown,
): Promise<BookmarkResult> {
  const caller = await requireCaller();
  if (!caller) return SIGNED_OUT;

  const path = normalizeBookmarkPath(rawPath, SITE_ORIGINS);
  if (!path) {
    return { ok: false, error: "That is not a page on FF Beacon." };
  }
  const label = normalizeBookmarkLabel(rawLabel);
  if (!label) {
    return { ok: false, error: "Give this bookmark a name." };
  }

  const existing = await readBookmarks();
  if (existing.some((bookmark) => bookmark.path === path)) {
    const state = await currentState(caller);
    return state.ok ? { ...state, created: false } : state;
  }

  if (existing.length >= MAX_BOOKMARKS) {
    return {
      ok: false,
      error: `You can keep ${MAX_BOOKMARKS} bookmarks. Remove one to make room.`,
    };
  }

  // One past the highest position rather than `existing.length`, so a value
  // freed by an earlier delete cannot be handed out twice.
  const nextPosition =
    existing.reduce((max, bookmark) => Math.max(max, bookmark.sortOrder), -1) + 1;

  // `ignoreDuplicates` so the read-then-write above cannot turn a double press
  // into an error. On conflict the existing row is left alone, which is the
  // same answer the early return gives.
  const { error } = await caller.supabase.from(TABLE).upsert(
    {
      user_id: caller.userId,
      path,
      label,
      sort_order: nextPosition,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,path", ignoreDuplicates: true },
  );
  if (error) {
    // The cap trigger (migration 0280) speaks here when two adds race past the
    // check above. Its message is a Postgres exception, so it is replaced with
    // the one the reader was going to get anyway.
    if (/bookmark limit/i.test(error.message)) {
      return {
        ok: false,
        error: `You can keep ${MAX_BOOKMARKS} bookmarks. Remove one to make room.`,
      };
    }
    return { ok: false, error: "Could not save that bookmark. Please try again." };
  }

  const state = await currentState(caller);
  return state.ok ? { ...state, created: true } : state;
}

/** Change a bookmark's name. The page it points at never changes. */
export async function renameBookmark(
  bookmarkId: unknown,
  rawLabel: unknown,
): Promise<BookmarkResult> {
  const caller = await requireCaller();
  if (!caller) return SIGNED_OUT;
  if (typeof bookmarkId !== "string" || !UUID_RE.test(bookmarkId)) {
    return { ok: false, error: "Could not find that bookmark." };
  }
  const label = normalizeBookmarkLabel(rawLabel);
  if (!label) return { ok: false, error: "Give this bookmark a name." };

  const { data, error } = await caller.supabase
    .from(TABLE)
    .update({ label, updated_at: new Date().toISOString() })
    .eq("id", bookmarkId)
    // Redundant with RLS by design. If a policy is ever loosened, the write is
    // still scoped to the caller by the query itself.
    .eq("user_id", caller.userId)
    .select("id");
  if (error) {
    return { ok: false, error: "Could not rename that bookmark. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Could not find that bookmark." };
  }

  return currentState(caller);
}

/**
 * Remove a bookmark, then close the gap it left so the remaining positions stay
 * dense. A failed reindex is reported rather than swallowed: the positions
 * would still READ correctly (the tie breaks on created_at), but the caller
 * would have been told a write succeeded that half happened.
 */
export async function deleteBookmark(bookmarkId: unknown): Promise<BookmarkResult> {
  const caller = await requireCaller();
  if (!caller) return SIGNED_OUT;
  if (typeof bookmarkId !== "string" || !UUID_RE.test(bookmarkId)) {
    return { ok: false, error: "Could not find that bookmark." };
  }

  const { data, error } = await caller.supabase
    .from(TABLE)
    .delete()
    .eq("id", bookmarkId)
    .eq("user_id", caller.userId)
    .select("id");
  if (error) {
    return { ok: false, error: "Could not remove that bookmark. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Could not find that bookmark." };
  }

  const failed = await reindex(caller, await readBookmarks());
  if (failed) {
    // The bookmark IS gone, so this is not a failed delete. Saying so would
    // send the reader back to press it again on a row that no longer exists.
    return {
      ok: false,
      error: "Removed, but the order could not be tidied up. Reload to see it.",
    };
  }
  return currentState(caller);
}

/**
 * Move a bookmark one place along the list.
 *
 * "earlier" is left on the desktop bar and up in the mobile sheet; "later" is
 * right and down. One verb pair for both, because it is one list read two ways,
 * and a direction named after a screen edge would be wrong on the other one.
 */
export async function moveBookmark(
  bookmarkId: unknown,
  direction: unknown,
): Promise<BookmarkResult> {
  const caller = await requireCaller();
  if (!caller) return SIGNED_OUT;
  if (typeof bookmarkId !== "string" || !UUID_RE.test(bookmarkId)) {
    return { ok: false, error: "Could not find that bookmark." };
  }
  if (direction !== "earlier" && direction !== "later") {
    return { ok: false, error: "That is not a direction." };
  }

  const bookmarks = await readBookmarks();
  const index = bookmarks.findIndex((b) => b.id === bookmarkId);
  if (index < 0) return { ok: false, error: "Could not find that bookmark." };

  const swapWith = direction === "earlier" ? index - 1 : index + 1;
  // Already at the end it is being pushed towards. Not an error: a reader
  // holding a key down should stop, not be told off.
  if (swapWith < 0 || swapWith >= bookmarks.length) {
    return { ok: true, bookmarks, barEnabled: await barPreference(caller) };
  }

  const reordered = [...bookmarks];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

  const failed = await reindex(caller, reordered);
  if (failed) {
    return { ok: false, error: "Could not reorder your bookmarks. Please try again." };
  }
  return currentState(caller);
}

/** Show or hide the bar. Follows the reader to every device, unlike whether
 * the bar is minimised, which is per-device and lives in local storage. */
export async function setBookmarkBarEnabled(
  enabled: unknown,
): Promise<BookmarkResult> {
  const caller = await requireCaller();
  if (!caller) return SIGNED_OUT;
  if (typeof enabled !== "boolean") {
    return { ok: false, error: "Could not read that setting." };
  }

  // Upsert rather than update: a reader who has never saved a preference has no
  // row yet, and the first thing they change should not silently do nothing.
  const { error } = await caller.supabase.from("user_preferences").upsert(
    {
      user_id: caller.userId,
      bookmarks_bar_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return { ok: false, error: "Could not save that setting. Please try again." };
  }

  return currentState(caller);
}

/** The reader's bar preference. */
async function barPreference(caller: Caller): Promise<boolean> {
  const { data } = await caller.supabase
    .from("user_preferences")
    .select("bookmarks_bar_enabled")
    .eq("user_id", caller.userId)
    .maybeSingle();
  return data?.bookmarks_bar_enabled ?? true;
}

/**
 * Write positions 0..n-1 over the given order, in ONE request.
 *
 * It used to send one UPDATE per changed row in parallel, which is fine for a
 * move (two neighbours swap) and is not fine for a delete: removing the first
 * of forty bookmarks rewrote thirty-nine positions, so a single press fired
 * thirty-nine concurrent statements at the pooler to maintain a number nothing
 * renders. One upsert keyed on the primary key does the same work in one round
 * trip whatever the list looks like.
 *
 * `path` and `label` ride along because an upsert has to carry every NOT NULL
 * column; they are the values just read, so nothing changes. Returns true when
 * the write failed, so the caller can say so rather than reporting a reorder
 * that did not happen.
 */
async function reindex(caller: Caller, ordered: Bookmark[]): Promise<boolean> {
  const changed = ordered
    .map((bookmark, position) => ({ bookmark, position }))
    .filter(({ bookmark, position }) => bookmark.sortOrder !== position);
  if (changed.length === 0) return false;

  const nowIso = new Date().toISOString();
  const { error } = await caller.supabase.from(TABLE).upsert(
    changed.map(({ bookmark, position }) => ({
      id: bookmark.id,
      user_id: caller.userId,
      path: bookmark.path,
      label: bookmark.label,
      sort_order: position,
      updated_at: nowIso,
    })),
    { onConflict: "id" },
  );
  return Boolean(error);
}
