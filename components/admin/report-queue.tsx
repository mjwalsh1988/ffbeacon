"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Eye } from "lucide-react";
import { PostBody } from "@/components/signal/post-body";
import { hidePost, unhidePost, setReportStatus } from "@/app/admin/signal/actions";
import { moderateComment } from "@/app/u/[handle]/comment-actions";

/**
 * Interactive moderation queue. Renders one card per reported target (post or
 * comment) with its reports and the hide/restore + per-report resolve actions.
 * All actions call server actions that re-validate authorization server-side
 * (requireAdmin for posts; owner-or-admin for comments, where admin satisfies the
 * check) and router.refresh() to repaint. A shared polite live region announces
 * outcomes; an assertive region carries errors.
 */

export type ReportItem = {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
};

export type PostReportGroup = {
  kind: "post";
  postId: string;
  body: string;
  hidden: boolean;
  hiddenReason: string | null;
  handle: string;
  displayName: string;
  reports: ReportItem[];
};

export type CommentReportGroup = {
  kind: "comment";
  commentId: string;
  body: string;
  hidden: boolean;
  hiddenReason: string | null;
  authorName: string;
  authorHandle: string | null;
  postBody: string;
  reports: ReportItem[];
};

export type ReportGroup = PostReportGroup | CommentReportGroup;

const REASON_LABEL: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  violence: "Violence or threats",
  other: "Something else",
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function groupKey(group: ReportGroup): string {
  return group.kind === "post" ? group.postId : group.commentId;
}

export function ReportQueue({ groups }: { groups: ReportGroup[] }) {
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      {/* Single assertive live region for errors: the wrapper IS the live
          region, so the inner paragraph must not also carry role="alert" (that
          nests two live regions and double-announces on NVDA). */}
      <div aria-live="assertive">
        {error && (
          <p className="mb-4 text-sm text-signal-danger">{error}</p>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-base/40 p-6 text-sm text-ink-muted">
          No open reports. New reports appear here for review.
        </p>
      ) : (
        <ul role="list" className="flex flex-col gap-5">
          {groups.map((group) => (
            <GroupCard
              key={`${group.kind}:${groupKey(group)}`}
              group={group}
              onAnnounce={setAnnouncement}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupCard({
  group,
  onAnnounce,
  onError,
}: {
  group: ReportGroup;
  onAnnounce: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    successMessage: string,
  ) => {
    onError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        onAnnounce(successMessage);
        router.refresh();
      } else {
        onError(res.error);
      }
    });
  };

  const hide = () =>
    group.kind === "post"
      ? run(() => hidePost(group.postId, reason), "Post hidden.")
      : run(() => moderateComment(group.commentId, true, reason), "Comment hidden.");

  const restore = () =>
    group.kind === "post"
      ? run(() => unhidePost(group.postId), "Post restored.")
      : run(() => moderateComment(group.commentId, false), "Comment restored.");

  const kindLabel = group.kind === "post" ? "post" : "comment";

  return (
    <li className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span className="rounded-full border border-line bg-base px-2 py-0.5 font-semibold uppercase tracking-wide text-brand-cyan">
          {kindLabel}
        </span>
        {group.kind === "post" ? (
          <>
            <span className="font-semibold text-ink">{group.displayName}</span>
            <span className="font-mono">@{group.handle}</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-ink">{group.authorName}</span>
            {group.authorHandle && (
              <span className="font-mono">@{group.authorHandle}</span>
            )}
          </>
        )}
        <span>
          {group.reports.length} open report
          {group.reports.length === 1 ? "" : "s"}
        </span>
        {group.hidden && (
          <span className="inline-flex items-center gap-1 rounded-full border border-signal-danger/50 bg-base px-2 py-0.5 font-semibold text-signal-danger">
            Hidden
          </span>
        )}
      </div>

      {group.kind === "comment" && (
        <div className="mt-3 rounded-card border border-dashed border-line bg-base/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            On post
          </p>
          <div className="mt-1 text-sm text-ink-muted">
            <PostBody body={group.postBody} />
          </div>
        </div>
      )}

      <div className="mt-3 rounded-card border border-line bg-base p-3">
        <PostBody body={group.body} />
      </div>

      <ul role="list" className="mt-3 flex flex-col gap-2">
        {group.reports.map((report) => (
          <li
            key={report.id}
            className="rounded-card border border-line/60 bg-base/50 p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">
                {REASON_LABEL[report.reason] ?? report.reason}
              </span>
              <time
                dateTime={report.createdAt}
                className="text-xs text-ink-muted"
              >
                {dateFmt.format(new Date(report.createdAt))}
              </time>
            </div>
            {report.details && (
              <p className="mt-1 text-ink-muted">{report.details}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setReportStatus(report.id, "reviewed"),
                    "Report marked reviewed.",
                  )
                }
                className="inline-flex h-9 items-center rounded-card border border-line px-3 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                Mark reviewed
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setReportStatus(report.id, "dismissed"),
                    "Report dismissed.",
                  )
                }
                className="inline-flex h-9 items-center rounded-card border border-line px-3 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-line pt-4">
        {group.hidden ? (
          <button
            type="button"
            disabled={pending}
            onClick={restore}
            className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-semibold text-ink hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
          >
            <Eye aria-hidden="true" className="h-4 w-4" />
            Restore {kindLabel}
          </button>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-ink">
              Reason (optional, shown to the author)
              <input
                type="text"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 block w-full min-w-[16rem] rounded-card border border-line bg-base px-3 py-2 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={hide}
              className="inline-flex h-11 items-center gap-2 rounded-card border border-signal-danger/60 px-4 text-sm font-semibold text-signal-danger hover:bg-signal-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
            >
              <EyeOff aria-hidden="true" className="h-4 w-4" />
              Hide {kindLabel}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
