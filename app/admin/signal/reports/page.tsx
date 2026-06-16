import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  ReportQueue,
  type ReportGroup,
  type ReportItem,
} from "@/components/admin/report-queue";

export const metadata: Metadata = { title: "Signal Moderation" };
export const dynamic = "force-dynamic";

/**
 * Admin moderation queue for the Signal Wall. Lists open reports (pending or
 * reviewed) grouped by the reported target (post or comment), oldest report
 * first. Each group shows the content, its author, the parent post (for
 * comments), and each report's reason and details. Admins can hide or restore the
 * target and mark individual reports reviewed or dismissed. Reads use the
 * service-role client so hidden and non-public content is visible to the
 * moderator.
 */
export default async function SignalReportsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: reports } = await admin
    .from("signal_reports")
    .select("id, target_type, target_id, reason, details, status, created_at")
    .in("status", ["pending", "reviewed"])
    .order("created_at", { ascending: true });

  const rows = reports ?? [];
  const postIds = Array.from(
    new Set(rows.filter((r) => r.target_type === "post").map((r) => r.target_id)),
  );
  const commentIds = Array.from(
    new Set(
      rows.filter((r) => r.target_type === "comment").map((r) => r.target_id),
    ),
  );

  // Load reported posts.
  const postById = new Map<
    string,
    { body: string; hidden: boolean; hiddenReason: string | null; handle: string; displayName: string }
  >();
  if (postIds.length > 0) {
    const { data: posts } = await admin
      .from("signal_posts")
      .select("id, body, hidden, hidden_reason, signals!inner(handle, display_name)")
      .in("id", postIds);
    for (const p of posts ?? []) {
      const s = p.signals as unknown as { handle: string; display_name: string };
      postById.set(p.id, {
        body: p.body,
        hidden: p.hidden,
        hiddenReason: p.hidden_reason,
        handle: s.handle,
        displayName: s.display_name,
      });
    }
  }

  // Load reported comments, with their parent post body for context.
  const commentById = new Map<
    string,
    {
      body: string;
      hidden: boolean;
      hiddenReason: string | null;
      authorUserId: string;
      postBody: string;
    }
  >();
  if (commentIds.length > 0) {
    const { data: comments } = await admin
      .from("signal_comments")
      .select("id, body, hidden, hidden_reason, author_user_id, signal_posts!inner(body)")
      .in("id", commentIds);
    for (const c of comments ?? []) {
      const parent = c.signal_posts as unknown as { body: string };
      commentById.set(c.id, {
        body: c.body,
        hidden: c.hidden,
        hiddenReason: c.hidden_reason,
        authorUserId: c.author_user_id,
        postBody: parent.body,
      });
    }
  }

  // Resolve comment authors' display names + (live-only) handles from Signals.
  const authorIds = Array.from(
    new Set(Array.from(commentById.values()).map((c) => c.authorUserId)),
  );
  const authorById = new Map<
    string,
    { name: string; handle: string | null }
  >();
  if (authorIds.length > 0) {
    const { data: authors } = await admin
      .from("signals")
      .select("user_id, handle, display_name, status, visibility, hidden")
      .in("user_id", authorIds);
    for (const a of authors ?? []) {
      const live =
        a.status === "published" && a.visibility === "public" && a.hidden === false;
      authorById.set(a.user_id, {
        name: a.display_name || "FF Beacon member",
        handle: live ? a.handle : null,
      });
    }
  }

  const reportsFor = (type: string, id: string): ReportItem[] =>
    rows
      .filter((r) => r.target_type === type && r.target_id === id)
      .map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.created_at,
      }));

  // Build groups in the order reports first appear (rows are oldest-first).
  const groups: ReportGroup[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.target_type}:${r.target_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (r.target_type === "post") {
      const post = postById.get(r.target_id);
      if (!post) continue; // post deleted: its reports were auto-dismissed.
      groups.push({
        kind: "post",
        postId: r.target_id,
        body: post.body,
        hidden: post.hidden,
        hiddenReason: post.hiddenReason,
        handle: post.handle,
        displayName: post.displayName,
        reports: reportsFor("post", r.target_id),
      });
    } else if (r.target_type === "comment") {
      const comment = commentById.get(r.target_id);
      if (!comment) continue; // comment deleted: its reports were auto-dismissed.
      const author = authorById.get(comment.authorUserId);
      groups.push({
        kind: "comment",
        commentId: r.target_id,
        body: comment.body,
        hidden: comment.hidden,
        hiddenReason: comment.hiddenReason,
        authorName: author?.name ?? "FF Beacon member",
        authorHandle: author?.handle ?? null,
        postBody: comment.postBody,
        reports: reportsFor("comment", r.target_id),
      });
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Signal Moderation
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Open reports on Wall posts and comments, grouped by the reported content.
        Hiding a post or comment removes it from the public profile and resolves
        its open reports.
      </p>
      <div className="mt-8">
        <ReportQueue groups={groups} />
      </div>
    </div>
  );
}
