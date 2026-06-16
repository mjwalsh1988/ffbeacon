import { Pin } from "lucide-react";
import { SignalBlock } from "@/components/signal/signal-block";
import { PostBody } from "@/components/signal/post-body";
import { ReportButton } from "@/components/signal/report-button";
import type { WallPost } from "@/lib/signal-wall";

/**
 * Public Wall block on /u/[handle]. Renders the Signal's posts, pinned first then
 * newest first (already ordered by the loader). The post list is read live (not
 * cached) so new posts appear immediately. Each post carries a Report control for
 * visitors; the control resolves auth at submit time so this block stays
 * viewer-agnostic and the page can keep its cached identity bundle.
 *
 * On the owner-preview path, admin-hidden posts are included and flagged; on the
 * public path the loader has already excluded them.
 */

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function WallBlock({
  posts,
  ownerPreview,
}: {
  posts: WallPost[];
  ownerPreview: boolean;
}) {
  if (posts.length === 0) return null;

  return (
    <SignalBlock id="signal-wall" eyebrow="Wall" title="Posts">
      <ol role="list" className="flex flex-col gap-4">
        {posts.map((post) => {
          const created = new Date(post.createdAt);
          return (
            <li
              key={post.id}
              className="rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <article aria-label={`Post from ${dateFmt.format(created)}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  {post.pinned && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-base px-2 py-0.5 font-semibold text-brand-cyan">
                      <Pin aria-hidden="true" className="h-3 w-3" />
                      Pinned
                    </span>
                  )}
                  {ownerPreview && post.hidden && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-signal-danger/50 bg-base px-2 py-0.5 font-semibold text-signal-danger">
                      Hidden by a moderator
                    </span>
                  )}
                  <time dateTime={created.toISOString()}>
                    {dateFmt.format(created)}
                  </time>
                  {post.editedAt && <span>(edited)</span>}
                </div>

                <div className="mt-2">
                  <PostBody body={post.body} />
                </div>

                {!ownerPreview && (
                  <ReportButton targetType="post" targetId={post.id} />
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </SignalBlock>
  );
}
