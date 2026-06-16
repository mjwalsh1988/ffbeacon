import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { signalMediaUrl } from "@/lib/signal-profile";

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

export type WallImage = {
  url: string;
  alt: string;
  width: number;
  height: number;
};

export type WallPost = {
  id: string;
  body: string;
  pinned: boolean;
  hidden: boolean;
  hiddenReason: string | null;
  createdAt: string;
  editedAt: string | null;
  images: WallImage[];
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
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Fetch all images for these posts in one query, grouped by post.
  const imagesByPost = await loadImagesForPosts(rows.map((r) => r.id));

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    pinned: row.pinned,
    hidden: row.hidden,
    hiddenReason: row.hidden_reason,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    images: imagesByPost.get(row.id) ?? [],
  }));
}

/**
 * Load images for a set of posts, ordered within each post, keyed by post id.
 * Shared by the public loader and the owner editor so both render the same shape.
 */
export async function loadImagesForPosts(
  postIds: string[],
): Promise<Map<string, WallImage[]>> {
  const byPost = new Map<string, WallImage[]>();
  if (postIds.length === 0) return byPost;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("signal_post_images")
    .select("post_id, storage_path, alt_text, width, height, ordinal")
    .in("post_id", postIds)
    .order("ordinal", { ascending: true });

  for (const row of data ?? []) {
    const url = signalMediaUrl(row.storage_path);
    if (!url) continue;
    const list = byPost.get(row.post_id) ?? [];
    list.push({ url, alt: row.alt_text, width: row.width, height: row.height });
    byPost.set(row.post_id, list);
  }
  return byPost;
}
