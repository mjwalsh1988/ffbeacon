"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff, Pencil, Trash2, X, Check } from "lucide-react";
import {
  POST_BODY_MAX,
  POST_LINKS_MAX,
  codePointLength,
  countLinks,
  graphemeLength,
} from "@/lib/signal";
import { PostBody } from "@/components/signal/post-body";
import { PostImages } from "@/components/signal/post-images";
import type { WallPost } from "@/lib/signal-wall";
import { updatePost, deletePost, setPostPinned } from "./wall-actions";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Owner-facing list of the owner's own Wall posts, in the My Signal editor. Each
 * post can be pinned/unpinned, edited inline, or deleted. Posts hidden by a
 * moderator are shown with their reason and cannot be edited or pinned (the owner
 * can still delete them). All mutations call the owner-only server actions and
 * router.refresh() to repaint. A shared polite live region announces results; an
 * assertive region carries errors.
 */
export function WallManager({ posts }: { posts: WallPost[] }) {
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (posts.length === 0) {
    return (
      <>
        <p aria-live="polite" role="status" className="sr-only">
          {announcement}
        </p>
        <p className="rounded-card border border-dashed border-line bg-base/40 p-5 text-sm text-ink-muted">
          You have not posted yet. Your posts appear here and on your public
          profile.
        </p>
      </>
    );
  }

  return (
    <div>
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      <div aria-live="assertive">
        {error && (
          <p role="alert" className="mb-3 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>
      <ol role="list" className="flex flex-col gap-4">
        {posts.map((post) => (
          <PostRow
            key={post.id}
            post={post}
            onAnnounce={setAnnouncement}
            onError={setError}
          />
        ))}
      </ol>
    </div>
  );
}

function PostRow({
  post,
  onAnnounce,
  onError,
}: {
  post: WallPost;
  onAnnounce: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const editFieldId = useId();

  const codePoints = codePointLength(draft);
  const links = countLinks(draft);
  const overLength = codePoints > POST_BODY_MAX;
  const overLinks = links > POST_LINKS_MAX;
  const draftInvalid = draft.trim().length === 0 || overLength || overLinks;

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    successMessage: string,
    after?: () => void,
  ) => {
    onError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        onAnnounce(successMessage);
        after?.();
        router.refresh();
      } else {
        onError(res.error);
      }
    });
  };

  const created = new Date(post.createdAt);

  return (
    <li className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        {post.pinned && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-base px-2 py-0.5 font-semibold text-brand-cyan">
            <Pin aria-hidden="true" className="h-3 w-3" />
            Pinned
          </span>
        )}
        {post.hidden && (
          <span className="inline-flex items-center gap-1 rounded-full border border-signal-danger/50 bg-base px-2 py-0.5 font-semibold text-signal-danger">
            Hidden by a moderator
          </span>
        )}
        <time dateTime={created.toISOString()}>{dateFmt.format(created)}</time>
        {post.editedAt && <span>(edited)</span>}
      </div>

      {post.hidden && post.hiddenReason && (
        <p className="mt-2 text-xs text-ink-muted">Reason: {post.hiddenReason}</p>
      )}

      {editing ? (
        <div className="mt-3">
          <label htmlFor={editFieldId} className="sr-only">
            Edit post
          </label>
          <textarea
            id={editFieldId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={overLength || overLinks}
            rows={4}
            className="w-full resize-y rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple focus:border-brand-purple focus:outline-none"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 text-xs">
            <span className={overLength ? "font-semibold text-signal-danger" : "text-ink-subtle"}>
              {graphemeLength(draft)} characters
              {overLength ? " (over the limit)" : ` of ${POST_BODY_MAX}`}
            </span>
            <span className={overLinks ? "font-semibold text-signal-danger" : "text-ink-subtle"}>
              {links} of {POST_LINKS_MAX} links
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || draftInvalid}
              onClick={() =>
                run(() => updatePost(post.id, draft.trim()), "Post updated.", () =>
                  setEditing(false),
                )
              }
              className="inline-flex h-11 items-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
            >
              <Check aria-hidden="true" className="h-4 w-4" />
              Save changes
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setDraft(post.body);
                setEditing(false);
              }}
              className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-semibold text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <X aria-hidden="true" className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <PostBody body={post.body} />
          <PostImages images={post.images} />
        </div>
      )}

      {!editing && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {!post.hidden && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setPostPinned(post.id, !post.pinned),
                    post.pinned ? "Post unpinned." : "Post pinned.",
                  )
                }
                className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                {post.pinned ? (
                  <PinOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Pin aria-hidden="true" className="h-4 w-4" />
                )}
                {post.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setDraft(post.body);
                  setEditing(true);
                }}
                className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                <Pencil aria-hidden="true" className="h-4 w-4" />
                Edit
              </button>
            </>
          )}
          {confirmingDelete ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-muted">Delete this post?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => deletePost(post.id), "Post deleted.")
                }
                className="inline-flex h-11 items-center gap-2 rounded-card border border-signal-danger/60 px-4 text-sm font-semibold text-signal-danger hover:bg-signal-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                Yes, delete
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmingDelete(false)}
                className="inline-flex h-11 items-center rounded-card border border-line px-4 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-medium text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}
