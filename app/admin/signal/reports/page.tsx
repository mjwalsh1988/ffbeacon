import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ReportQueue, type ReportGroup } from "@/components/admin/report-queue";

export const metadata: Metadata = { title: "Signal Moderation" };
export const dynamic = "force-dynamic";

/**
 * Admin moderation queue for the Signal Wall. Lists open reports (pending or
 * reviewed) grouped by the reported post, with the post body, author handle, and
 * each report's reason and details. Admins can hide or restore the post and mark
 * individual reports reviewed or dismissed. Reads use the service-role client so
 * hidden and non-public content is visible to the moderator.
 */
export default async function SignalReportsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: reports } = await admin
    .from("signal_reports")
    .select("id, target_id, reason, details, status, created_at")
    .eq("target_type", "post")
    .in("status", ["pending", "reviewed"])
    .order("created_at", { ascending: true });

  const rows = reports ?? [];
  const targetIds = Array.from(new Set(rows.map((r) => r.target_id)));

  const groups: ReportGroup[] = [];
  if (targetIds.length > 0) {
    const { data: posts } = await admin
      .from("signal_posts")
      .select(
        "id, body, hidden, hidden_reason, signals!inner(handle, display_name)",
      )
      .in("id", targetIds);
    const postById = new Map(
      (posts ?? []).map((p) => {
        const s = p.signals as unknown as {
          handle: string;
          display_name: string;
        };
        return [
          p.id,
          {
            body: p.body,
            hidden: p.hidden,
            hiddenReason: p.hidden_reason,
            handle: s.handle,
            displayName: s.display_name,
          },
        ];
      }),
    );

    for (const targetId of targetIds) {
      const post = postById.get(targetId);
      if (!post) continue; // post deleted: its reports were auto-dismissed.
      groups.push({
        postId: targetId,
        body: post.body,
        hidden: post.hidden,
        hiddenReason: post.hiddenReason,
        handle: post.handle,
        displayName: post.displayName,
        reports: rows
          .filter((r) => r.target_id === targetId)
          .map((r) => ({
            id: r.id,
            reason: r.reason,
            details: r.details,
            status: r.status,
            createdAt: r.created_at,
          })),
      });
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Signal Moderation
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Open reports on Wall posts, grouped by post. Hiding a post removes it from
        the public profile and resolves its open reports.
      </p>
      <div className="mt-8">
        <ReportQueue groups={groups} />
      </div>
    </div>
  );
}
