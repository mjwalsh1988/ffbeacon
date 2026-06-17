import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { signalMediaUrl } from "@/lib/signal-profile";
import type { ReactionType } from "@/lib/signal/reactions";

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

/**
 * Reaction data for the Wall picker + counts (Phase 4f COMMIT 2).
 *
 * Counts are read straight off the denormalized signal_reaction_counts table; we
 * never tally signal_reactions rows live on a request. A count may reference a
 * reaction type that has since been disabled (is_active=false): we still surface
 * that historical count, labeled, so taking a reaction out of the catalog does not
 * erase the tallies it already earned. The active catalog drives the picker; the
 * full catalog (active + disabled) is loaded only to label those historical counts.
 *
 * This loader uses the service-role admin client, so it bypasses the
 * signal_reaction_counts visibility gate. That is fine: the page only ever asks
 * for targets it is already rendering (visible posts/comments, or the owner's own
 * preview), so no hidden engagement metadata leaks through here.
 */
export type ReactionCountEntry = { type: ReactionType; count: number };

export type ReactionTargetData = {
  // Every reaction type with a positive count on this target, ordered by the
  // catalog display order. Entries may be disabled types (entry.type.is_active
  // === false) whose historical counts are still shown, labeled.
  counts: ReactionCountEntry[];
  // reaction_type_ids the signed-in viewer has applied to this target. Drives
  // aria-pressed and the toggle. Empty for anonymous viewers.
  viewerReactionTypeIds: string[];
};

export type WallReactions = {
  // The active catalog, ordered, used to render the picker toolbar. Shared by
  // every target on the page.
  activeTypes: ReactionType[];
  byTarget: Map<string, ReactionTargetData>;
};

export const EMPTY_REACTION_TARGET: ReactionTargetData = {
  counts: [],
  viewerReactionTypeIds: [],
};

/** Stable key for the per-target reaction map. */
export function reactionTargetKey(
  targetType: "post" | "comment",
  targetId: string,
): string {
  return `${targetType}:${targetId}`;
}

/**
 * Load the reaction catalog, denormalized counts, and the viewer's own reactions
 * for a set of Wall targets (posts and comments) in a handful of indexed queries.
 */
export async function loadReactionsForTargets(
  targets: { type: "post" | "comment"; id: string }[],
  viewerUserId: string | null,
): Promise<WallReactions> {
  const supabase = createAdminClient();

  // The whole catalog (admin-curated, small). Active rows render the picker;
  // disabled rows are kept only to label historical counts.
  const { data: typeRows } = await supabase
    .from("signal_reaction_types")
    .select("id, slug, label, kind, char, image_path, display_order, is_active")
    .order("display_order", { ascending: true })
    .order("slug", { ascending: true });

  const allTypes: ReactionType[] = (typeRows ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    label: t.label,
    kind: t.kind === "image" ? "image" : "text",
    char: t.char,
    image_path: t.image_path,
    display_order: t.display_order,
    is_active: t.is_active,
  }));
  const typeById = new Map(allTypes.map((t) => [t.id, t] as const));
  const orderIndex = new Map(allTypes.map((t, i) => [t.id, i] as const));
  const activeTypes = allTypes.filter((t) => t.is_active);

  const byTarget = new Map<string, ReactionTargetData>();
  if (targets.length === 0) return { activeTypes, byTarget };

  // Seed an entry for every requested target so the UI can render an empty
  // picker on targets that have no reactions yet.
  for (const t of targets) {
    byTarget.set(reactionTargetKey(t.type, t.id), {
      counts: [],
      viewerReactionTypeIds: [],
    });
  }

  const postIds = targets.filter((t) => t.type === "post").map((t) => t.id);
  const commentIds = targets
    .filter((t) => t.type === "comment")
    .map((t) => t.id);

  const loadCounts = async (
    targetType: "post" | "comment",
    ids: string[],
  ): Promise<void> => {
    if (ids.length === 0) return;
    const { data } = await supabase
      .from("signal_reaction_counts")
      .select("target_id, reaction_type_id, count")
      .eq("target_type", targetType)
      .in("target_id", ids);
    for (const row of data ?? []) {
      if (row.count <= 0) continue;
      const type = typeById.get(row.reaction_type_id);
      if (!type) continue;
      const entry = byTarget.get(reactionTargetKey(targetType, row.target_id));
      if (!entry) continue;
      entry.counts.push({ type, count: row.count });
    }
  };

  const loadViewer = async (
    targetType: "post" | "comment",
    ids: string[],
  ): Promise<void> => {
    if (!viewerUserId || ids.length === 0) return;
    const { data } = await supabase
      .from("signal_reactions")
      .select("target_id, reaction_type_id")
      .eq("target_type", targetType)
      .eq("user_id", viewerUserId)
      .in("target_id", ids);
    for (const row of data ?? []) {
      const entry = byTarget.get(reactionTargetKey(targetType, row.target_id));
      if (!entry) continue;
      entry.viewerReactionTypeIds.push(row.reaction_type_id);
    }
  };

  await Promise.all([
    loadCounts("post", postIds),
    loadCounts("comment", commentIds),
    loadViewer("post", postIds),
    loadViewer("comment", commentIds),
  ]);

  // Stable chip order: follow the catalog display order within each target.
  for (const entry of byTarget.values()) {
    entry.counts.sort(
      (a, b) =>
        (orderIndex.get(a.type.id) ?? 0) - (orderIndex.get(b.type.id) ?? 0),
    );
  }

  return { activeTypes, byTarget };
}
