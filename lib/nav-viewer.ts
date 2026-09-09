import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Who is looking, and what they have saved.
 *
 * The header and the root layout both need this in the same render. Before this
 * was shared they each validated the session with the auth server and each read
 * `user_preferences`, so every page cost two round trips to learn one thing.
 * Wrapping it in React's `cache` collapses that back to one.
 *
 * `isAdmin` decides whether the Admin section appears in the navigation. That is
 * navigation, not authorization: every route behind it re-checks the session
 * through `requireAdmin()`, so a wrong answer here shows or hides a link and
 * nothing more. A failed read resolves to signed out, which renders the smaller
 * tree rather than a broken one, and fails closed by construction.
 *
 * `auth.getUser()` rather than `getSession()`, so the token is validated against
 * the auth server instead of trusted from the cookie.
 */
export type NavViewerState = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** The viewer's saved default format, when they have one. */
  defaultFormatConfigId: string | null;
  /** The viewer's saved default value source, when they have one. */
  defaultSourceSlug: string | null;
  /**
   * Whether the bookmark bar shows under the header. Read here rather than in
   * its own query for the same reason everything else in this object is: the
   * layout, the header and the bookmark loader all want a piece of
   * `user_preferences` in the same render, and one cached read serves all
   * three.
   */
  bookmarksBarEnabled: boolean;
};

const SIGNED_OUT: NavViewerState = {
  isAuthenticated: false,
  isAdmin: false,
  defaultFormatConfigId: null,
  defaultSourceSlug: null,
  bookmarksBarEnabled: true,
};

export const getNavViewer = cache(async (): Promise<NavViewerState> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return SIGNED_OUT;

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select(
        "is_admin, default_format_config_id, default_source_slug, bookmarks_bar_enabled",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    return {
      isAuthenticated: true,
      isAdmin: Boolean(prefs?.is_admin),
      defaultFormatConfigId: prefs?.default_format_config_id ?? null,
      defaultSourceSlug: prefs?.default_source_slug ?? null,
      // A reader with no preferences row yet gets the bar, which is the same
      // answer the column's default gives.
      bookmarksBarEnabled: prefs?.bookmarks_bar_enabled ?? true,
    };
  } catch {
    return SIGNED_OUT;
  }
});
