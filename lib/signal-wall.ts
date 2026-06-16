import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Server-only data layer for the Signal Wall (public posts on /u/[handle]).
 *
 * DYNAMIC, NOT CACHED (approved Phase 4 decision): the Wall is interactive and,
 * once comments and reactions land, written by arbitrary signed-in users, not
 * just the profile owner. Folding it into the cached signal:{handle} bundle would
 * either serve stale posts for up to an hour or force every stranger's write to
 * bust the owner's whole profile + board caches. So the Wall reads live here via
 * the service-role client, and the public profile page renders dynamically. The
 * reads are cheap (one indexed select), and post counts (later: reaction counts)
 * are denormalized so public reads never aggregate rows live.
 *
 * Visibility gating is the caller's job: the page resolves whether the parent
 * Signal is live (published + public + not hidden) and passes includeHidden only
 * on the owner-preview path. This loader additionally never returns hidden posts
 * unless includeHidden is set, so a public render cannot leak a taken-down post.
 */

export type WallPost = {
  id: string;
  body: string;
  pinned: boolean;
  hidden: boolean;
  hiddenReason: string | null;
  createdAt: string;
  editedAt: string | null;
};

/**
 * Load a Signal's posts, pinned first then newest first. Public callers pass
 * includeHidden=false (the default) so admin-hidden posts never render; the
 * owner-preview path passes includeHidden=true and flags hidden posts in the UI.
 */
export async function loadWallPosts(
  signalId: string,
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Promise<WallPost[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("signal_posts")
    .select("id, body, pinned, hidden, hidden_reason, created_at, edited_at")
    .eq("signal_id", signalId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (!includeHidden) query = query.eq("hidden", false);

  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    pinned: row.pinned,
    hidden: row.hidden,
    hiddenReason: row.hidden_reason,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  }));
}
