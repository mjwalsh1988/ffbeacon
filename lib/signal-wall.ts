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

// A GIF (GIPHY) attached to a post or comment. previewUrl is the static still
// shown by default; url is the animated rendition revealed on play. alt is always
// present (the DB CHECK requires it). giphyId is carried so an editor can re-send
// an existing GIF unchanged.
export type WallGif = {
  giphyId: string;
  url: string;
  previewUrl: string;
  alt: string;
  width: number;
  height: number;
};

/**
 * Parse the stored gif jsonb into a render-ready WallGif, or null. This re-checks
 * the shape on the read path (defense in depth beyond the write-time validation and
 * the DB CHECK): a malformed or non-https value, or one missing alt text, is
 * dropped rather than rendered.
 */
export function parseWallGif(raw: unknown): WallGif | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const giphyId = typeof r.giphy_id === "string" ? r.giphy_id : "";
  const url = typeof r.url === "string" ? r.url : "";
  const previewUrl = typeof r.preview_url === "string" ? r.preview_url : "";
  const alt = typeof r.alt === "string" ? r.alt : "";
  const width = Number(r.width);
  const height = Number(r.height);
  if (giphyId.length === 0) return null;
  if (!/^https:\/\//.test(url) || !/^https:\/\//.test(previewUrl)) return null;
  if (alt.trim().length === 0) return null;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  return { giphyId, url, previewUrl, alt, width, height };
}

export type WallComment = {
  id: string;
  postId: string;
  body: string;
  authorUserId: string;
  // Display name for the comment author. Falls back to a neutral label when the
  // author has not set up a Signal profile.
  authorName: string;
  // The author's handle, present only when their Signal is live (so the link
  // never points at a non-public profile). null otherwise.
  authorHandle: string | null;
  hidden: boolean;
  hiddenReason: string | null;
  createdAt: string;
  editedAt: string | null;
  gif: WallGif | null;
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
  gif: WallGif | null;
  comments: WallComment[];
};

const COMMENT_AUTHOR_FALLBACK = "FF Beacon member";

/**
 * Load a Signal's posts, pinned first then newest first. Public callers pass
 * includeHidden=false (the default) so admin-hidden posts never render; the
 * owner-preview path passes includeHidden=true and flags hidden posts in the UI.
 */
export async function loadWallPosts(
  signalId: string,
  {
    includeHidden = false,
    includeHiddenComments = false,
  }: { includeHidden?: boolean; includeHiddenComments?: boolean } = {},
): Promise<WallPost[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("signal_posts")
    .select("id, body, pinned, hidden, hidden_reason, created_at, edited_at, gif")
    .eq("signal_id", signalId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (!includeHidden) query = query.eq("hidden", false);

  const { data } = await query;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const postIds = rows.map((r) => r.id);
  // Fetch all images and comments for these posts, grouped by post.
  const [imagesByPost, commentsByPost] = await Promise.all([
    loadImagesForPosts(postIds),
    loadCommentsForPosts(postIds, { includeHidden: includeHiddenComments }),
  ]);

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    pinned: row.pinned,
    hidden: row.hidden,
    hiddenReason: row.hidden_reason,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    images: imagesByPost.get(row.id) ?? [],
    gif: parseWallGif(row.gif),
    comments: commentsByPost.get(row.id) ?? [],
  }));
}

/**
 * Load comments for a set of posts, oldest first within each post, keyed by post
 * id. Public callers pass includeHidden=false so admin-hidden comments never
 * render; the wall owner / admin moderation view passes includeHidden=true and
 * flags hidden comments in the UI.
 *
 * Author identity is resolved from the author's Signal (the product's public
 * identity projection). Authors without a Signal show a neutral fallback label,
 * and the @handle link is included only when the author's Signal is live, so a
 * link never points at a draft/private/hidden profile.
 */
export async function loadCommentsForPosts(
  postIds: string[],
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Promise<Map<string, WallComment[]>> {
  const byPost = new Map<string, WallComment[]>();
  if (postIds.length === 0) return byPost;

  const supabase = createAdminClient();
  let query = supabase
    .from("signal_comments")
    .select(
      "id, post_id, author_user_id, body, hidden, hidden_reason, created_at, edited_at, gif",
    )
    .in("post_id", postIds)
    .order("created_at", { ascending: true })
    .limit(500);

  if (!includeHidden) query = query.eq("hidden", false);

  const { data } = await query;
  const rows = data ?? [];
  if (rows.length === 0) return byPost;

  // Resolve author display from their Signal in one query.
  const authorIds = Array.from(new Set(rows.map((r) => r.author_user_id)));
  const { data: authorRows } = await supabase
    .from("signals")
    .select("user_id, handle, display_name, status, visibility, hidden")
    .in("user_id", authorIds);
  const authorById = new Map(
    (authorRows ?? []).map((a) => [a.user_id, a] as const),
  );

  for (const row of rows) {
    const author = authorById.get(row.author_user_id);
    const live =
      author?.status === "published" &&
      author?.visibility === "public" &&
      author?.hidden === false;
    const list = byPost.get(row.post_id) ?? [];
    list.push({
      id: row.id,
      postId: row.post_id,
      body: row.body,
      authorUserId: row.author_user_id,
      authorName: author?.display_name || COMMENT_AUTHOR_FALLBACK,
      authorHandle: live && author ? author.handle : null,
      hidden: row.hidden,
      hiddenReason: row.hidden_reason,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      gif: parseWallGif(row.gif),
    });
    byPost.set(row.post_id, list);
  }
  return byPost;
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
