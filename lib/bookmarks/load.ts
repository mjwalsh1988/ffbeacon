import "server-only";

/**
 * Everything the bookmark UI needs, resolved once per request.
 *
 * WHY THIS IS `cache`d AND WHY THAT MATTERS. Three places want the same answer
 * in one render: the bar under the header, the save button in the breadcrumb
 * bar, and (on a league page, which draws its own breadcrumb) the save button
 * in League Pulse's own action cluster. React's `cache` hands all three the
 * same in-flight Promise, so they cost one query between them and, more to the
 * point, they cannot disagree. Two of those render inside the same Suspense
 * boundary and one renders in a page far below it; without the shared Promise
 * the third would have had to hydrate from the client and would have flashed
 * an empty state on every league page.
 *
 * ABSOLUTE RULE: NO BOOKMARK READ HAPPENS ON A HANDHELD. The bar is desktop
 * only, so the query would be paid for a thing that is never painted. The
 * mobile sheet fetches the list itself, once, when the reader opens it. The
 * `bookmarks: null` this returns says "not loaded", which is deliberately a
 * different fact from `[]`, "this reader has none" (see ./types.ts).
 *
 * The signed-in check and the bar preference both come from `getNavViewer`,
 * which the layout and the header already call, so neither costs a round trip
 * of its own.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getNavViewer } from "@/lib/nav-viewer";
import { isHandheldRequest } from "@/lib/device";
import { sleeperAvatarUrl } from "@/lib/sleeper-avatar-url";
import { sleeperLeagueIdFromPath } from "./path";
import {
  MAX_BOOKMARKS,
  SIGNED_OUT_BOOKMARK_STATE,
  type Bookmark,
  type BookmarkState,
} from "./types";

export const loadBookmarkState = cache(async (): Promise<BookmarkState> => {
  const [viewer, isHandheld] = await Promise.all([
    getNavViewer(),
    isHandheldRequest(),
  ]);

  if (!viewer.isAuthenticated) {
    return { ...SIGNED_OUT_BOOKMARK_STATE, isHandheld };
  }

  const barEnabled = viewer.bookmarksBarEnabled;

  if (isHandheld) {
    return { signedIn: true, bookmarks: null, barEnabled, isHandheld: true };
  }

  return {
    signedIn: true,
    bookmarks: await readBookmarks(),
    barEnabled,
    isHandheld: false,
  };
});

/**
 * One reader's bookmarks, in display order.
 *
 * SCOPED TWICE, deliberately. The owner-only RLS policy
 * (`user_bookmarks_select_own`) is the guarantee, and `.eq("user_id", ...)` on
 * the query itself is the belt: every WRITE in app/actions/bookmarks.ts already
 * doubles up this way, and this read is the one place that did not. Nothing is
 * exploitable today, but a policy loosened later, or this client swapped for a
 * service-role one during some caching change, would silently render other
 * people's paths, and a path is itself data (a Sleeper league id, a draft id).
 *
 * The limit matches the cap the write path enforces, so a row set that somehow
 * grew past it is truncated for display rather than rendered as an endless bar.
 */
export async function readBookmarks(): Promise<Bookmark[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("user_bookmarks")
      .select("id, path, label, sort_order")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(MAX_BOOKMARKS);
    if (error || !data) return [];

    const logos = await leagueLogos(
      supabase,
      data.map((row) => row.path),
    );

    return data.map((row) => ({
      id: row.id,
      path: row.path,
      label: row.label,
      sortOrder: row.sort_order,
      imageUrl: logos.get(sleeperLeagueIdFromPath(row.path) ?? "") ?? null,
    }));
  } catch {
    // A bookmark bar is chrome. It never takes a page down with it.
    return [];
  }
}

/**
 * Sleeper logo URLs for whichever of these paths point at a league.
 *
 * ONE QUERY, and only when there is a league bookmark to resolve. It reads a
 * single jsonb key rather than `metadata`, which is the whole raw Sleeper
 * league object and would be several kilobytes per row for a value that is 32
 * characters long. `leagues` is public-read, and the ids come out of a
 * digits-only pattern (see sleeperLeagueIdFromPath), so nothing shaped like a
 * second path segment reaches the filter.
 *
 * A league we have never synced is simply absent from the map, which is the
 * same answer as a league with no logo: the shield.
 */
async function leagueLogos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(
      paths
        .map((path) => sleeperLeagueIdFromPath(path))
        .filter((id): id is string => id !== null),
    ),
  );
  const logos = new Map<string, string>();
  if (ids.length === 0) return logos;

  const { data, error } = await supabase
    .from("leagues")
    .select("sleeper_league_id, avatar:metadata->>avatar")
    .in("sleeper_league_id", ids);
  if (error || !data) return logos;

  for (const row of data as { sleeper_league_id: string; avatar: string | null }[]) {
    // `sleeperAvatarUrl` validates the id before it becomes a host-bearing URL,
    // which matters because this value is a raw external object we stored
    // verbatim. Null in, null out, and null stays out of the map.
    const url = sleeperAvatarUrl(row.avatar, "thumb");
    if (url) logos.set(row.sleeper_league_id, url);
  }
  return logos;
}
