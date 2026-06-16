"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/admin-auth";
import {
  COMMENT_BODY_MAX,
  COMMENT_LINKS_MAX,
  codePointLength,
  countLinks,
  validateGifInput,
  type SignalGifInput,
} from "@/lib/signal";

/**
 * Comment server actions for the Signal Wall. Unlike posts (owned by the profile
 * owner), comments are written by ANY signed-in user, so these actions are not
 * owner-scoped:
 *
 *   - createComment / updateComment / deleteComment run through the caller's
 *     session client and the author-scoped RLS on signal_comments (migration
 *     0072). The BEFORE INSERT/UPDATE trigger is the authoritative backstop
 *     (rate limit, link cap, forced created_at), and the insert RLS additionally
 *     requires the parent post to be publicly commentable.
 *   - moderateComment is the owner/admin take-down path. It re-validates that the
 *     caller is the parent Signal's owner OR an admin, then writes the
 *     service-role-only moderation columns through the admin client. This is the
 *     established league-refresh authz pattern: never trust the client; re-check
 *     server-side and write with the elevated client.
 */

export type CommentActionResult =
  | { ok: true }
  | { ok: false; error: string; needsAuth?: boolean };

// Map a database error (trigger RAISE or constraint violation) to friendly copy.
function mapCommentError(error: { message?: string; code?: string }): string {
  const m = error.message ?? "";
  if (m.includes("wait at least 15 seconds")) {
    return "Slow down. Wait at least 15 seconds between comments.";
  }
  if (m.includes("at most 10 comments per hour")) {
    return "You have reached the limit of 10 comments per hour. Try again later.";
  }
  if (m.includes("at most 40 comments per day")) {
    return "You have reached the limit of 40 comments per day. Try again tomorrow.";
  }
  if (m.includes("too_many_links")) {
    return `Comments can include at most ${COMMENT_LINKS_MAX} links.`;
  }
  if (m.includes("signal_comments_body_check")) {
    return `Comments must be 1 to ${COMMENT_BODY_MAX} characters.`;
  }
  // RLS with-check failure on insert (parent not publicly commentable).
  if (error.code === "42501" || m.includes("row-level security")) {
    return "You cannot comment on this post.";
  }
  return "Could not save your comment. Please try again.";
}

/** Validate a body against the same rules the DB enforces. Returns an error
 * string, or null when acceptable. */
function validateBody(body: string): string | null {
  const len = codePointLength(body);
  if (len < 1) return "Write something first.";
  if (len > COMMENT_BODY_MAX) {
    return `Comments must be ${COMMENT_BODY_MAX} characters or fewer.`;
  }
  if (countLinks(body) > COMMENT_LINKS_MAX) {
    return `Comments can include at most ${COMMENT_LINKS_MAX} links.`;
  }
  return null;
}

const HIDDEN_REASON_MAX = 300;

/** Resolve an untrusted gif payload to an insert-ready value. A comment is text
 * plus an OPTIONAL single GIF (comments have no image uploads), so an absent or
 * null gif is valid and resolves to null. */
function resolveGif(
  gifRaw: unknown,
): { ok: true; gif: SignalGifInput | null } | { ok: false; error: string } {
  if (gifRaw === undefined || gifRaw === null) return { ok: true, gif: null };
  const check = validateGifInput(gifRaw);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, gif: check.gif };
}

export async function createComment(
  postId: string,
  rawBody: string,
  gifRaw?: unknown,
): Promise<CommentActionResult> {
  if (typeof postId !== "string" || postId.length === 0) {
    return { ok: false, error: "Could not find that post." };
  }
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  const bodyError = validateBody(body);
  if (bodyError) return { ok: false, error: bodyError };

  const gifCheck = resolveGif(gifRaw);
  if (!gifCheck.ok) return { ok: false, error: gifCheck.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to comment." };
  }

  // RLS insert-own enforces author = uid AND parent post publicly commentable.
  const { error } = await supabase.from("signal_comments").insert({
    post_id: postId,
    author_user_id: user.id,
    body,
    gif: gifCheck.gif,
  });
  if (error) return { ok: false, error: mapCommentError(error) };

  return { ok: true };
}

export async function updateComment(
  commentId: string,
  rawBody: string,
  gifRaw?: unknown,
): Promise<CommentActionResult> {
  if (typeof commentId !== "string" || commentId.length === 0) {
    return { ok: false, error: "Could not find that comment." };
  }
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  const bodyError = validateBody(body);
  if (bodyError) return { ok: false, error: bodyError };

  const gifCheck = resolveGif(gifRaw);
  if (!gifCheck.ok) return { ok: false, error: gifCheck.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to edit your comment." };
  }

  const nowIso = new Date().toISOString();
  // RLS update-own scopes this to the caller's own comments; match
  // author_user_id too so a guessed id on someone else's comment affects 0 rows.
  // The edit form holds the full GIF state, so an absent GIF clears it.
  const { data, error } = await supabase
    .from("signal_comments")
    .update({ body, gif: gifCheck.gif, edited_at: nowIso, updated_at: nowIso })
    .eq("id", commentId)
    .eq("author_user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: mapCommentError(error) };
  if (!data) return { ok: false, error: "Could not find that comment." };

  return { ok: true };
}

export async function deleteComment(
  commentId: string,
): Promise<CommentActionResult> {
  if (typeof commentId !== "string" || commentId.length === 0) {
    return { ok: false, error: "Could not find that comment." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to delete your comment." };
  }

  const { data, error } = await supabase
    .from("signal_comments")
    .delete()
    .eq("id", commentId)
    .eq("author_user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, error: "Could not delete that comment. Please try again." };
  }
  if (!data) return { ok: false, error: "Could not find that comment." };

  return { ok: true };
}

/**
 * Owner/admin moderation of a comment. Re-validates that the caller is the parent
 * Signal's owner OR an admin, then writes the service-role-only moderation
 * columns with the admin client. Hiding also resolves the comment's open reports.
 */
export async function moderateComment(
  commentId: string,
  hidden: boolean,
  reason?: string,
): Promise<CommentActionResult> {
  if (typeof commentId !== "string" || commentId.length === 0) {
    return { ok: false, error: "Could not find that comment." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to moderate comments." };
  }

  const admin = createAdminClient();
  const { data: comment } = await admin
    .from("signal_comments")
    .select("id, post_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { ok: false, error: "Could not find that comment." };

  const { data: post } = await admin
    .from("signal_posts")
    .select("signal_id")
    .eq("id", comment.post_id)
    .maybeSingle();
  const { data: signal } = post
    ? await admin
        .from("signals")
        .select("user_id")
        .eq("id", post.signal_id)
        .maybeSingle()
    : { data: null };

  const isOwner = !!signal && signal.user_id === user.id;
  const isAdmin = isOwner ? false : await getIsAdmin(supabase);
  if (!isOwner && !isAdmin) {
    return { ok: false, error: "You are not allowed to moderate this comment." };
  }

  const cleanReason =
    typeof reason === "string" ? reason.trim().slice(0, HIDDEN_REASON_MAX) : "";

  const { error } = await admin
    .from("signal_comments")
    .update(
      hidden
        ? {
            hidden: true,
            hidden_reason: cleanReason.length > 0 ? cleanReason : null,
            hidden_at: new Date().toISOString(),
            hidden_by: user.id,
          }
        : {
            hidden: false,
            hidden_reason: null,
            hidden_at: null,
            hidden_by: null,
          },
    )
    .eq("id", commentId);
  if (error) {
    return { ok: false, error: "Could not update that comment. Please try again." };
  }

  if (hidden) {
    await admin
      .from("signal_reports")
      .update({ status: "actioned" })
      .eq("target_type", "comment")
      .eq("target_id", commentId)
      .in("status", ["pending", "reviewed"]);
  }

  return { ok: true };
}
