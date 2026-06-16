"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MessageSquare,
  Send,
  Pencil,
  Trash2,
  X,
  Check,
  EyeOff,
  Eye,
} from "lucide-react";
import {
  COMMENT_BODY_MAX,
  COMMENT_LINKS_MAX,
  codePointLength,
  countLinks,
  graphemeLength,
} from "@/lib/signal";
import { PostBody } from "@/components/signal/post-body";
import { ReportButton } from "@/components/signal/report-button";
import type { WallComment } from "@/lib/signal-wall";
import {
  createComment,
  updateComment,
  deleteComment,
  moderateComment,
} from "@/app/u/[handle]/comment-actions";

/**
 * Comments under a single Wall post. Renders the existing comments (oldest first)
 * and, for signed-in viewers, a composer. Authors can edit/delete their own
 * comments; the Wall owner and admins can hide/restore any comment; everyone else
 * gets a Report control. The Wall is dynamic, so every mutation calls a server
 * action then router.refresh() to repaint with live data.
 *
 * Accessibility: the composer textarea is labeled with a describedby helper and a
 * grapheme-aware counter; a polite live region confirms success and an assertive
 * region carries errors; edit and moderation focus is managed so keyboard and
 * screen-reader users are never stranded.
 */

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function CommentSection({
  postId,
  comments,
  viewerUserId,
  viewerIsAdmin,
  viewerIsWallOwner,
  canComment,
}: {
  postId: string;
  comments: WallComment[];
  viewerUserId: string | null;
  viewerIsAdmin: boolean;
  viewerIsWallOwner: boolean;
  canComment: boolean;
}) {
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  const count = comments.length;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-4 border-t border-line pt-4"
    >
      <h3
        id={headingId}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted"
      >
        <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
        {count === 0 ? "Comments" : `${count} comment${count === 1 ? "" : "s"}`}
      </h3>

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      <div aria-live="assertive">
        {error && (
          <p role="alert" className="mt-2 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>

      {count > 0 && (
        <ol role="list" className="mt-3 flex flex-col gap-3">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              canModerate={viewerIsWallOwner || viewerIsAdmin}
              isAuthor={
                viewerUserId !== null && viewerUserId === comment.authorUserId
              }
              onAnnounce={setAnnouncement}
              onError={setError}
            />
          ))}
        </ol>
      )}

      {canComment ? (
        viewerUserId ? (
          <Composer
            postId={postId}
            onAnnounce={setAnnouncement}
            onError={setError}
          />
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            <Link
              href="/login"
              className="font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign in
            </Link>{" "}
            to join the conversation.
          </p>
        )
      ) : null}
    </section>
  );
}

function Composer({
  postId,
  onAnnounce,
  onError,
}: {
  postId: string;
  onAnnounce: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const fieldId = useId();
  const helpId = useId();
  const countId = useId();
  const router = useRouter();

  const codePoints = codePointLength(body);
  const links = countLinks(body);
  const overLength = codePoints > COMMENT_BODY_MAX;
  const overLinks = links > COMMENT_LINKS_MAX;
  const disabled =
    pending || body.trim().length === 0 || overLength || overLinks;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onError(null);
    if (disabled) return;
    startTransition(async () => {
      const res = await createComment(postId, body.trim());
      if (res.ok) {
        setBody("");
        onAnnounce("Comment posted.");
        router.refresh();
      } else {
        onError(res.error);
      }
    });
  };

  return (
    <form onSubmit={submit} className="mt-4">
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        Add a comment
      </label>
      <p id={helpId} className="mt-1 text-xs text-ink-muted">
        Up to {COMMENT_BODY_MAX} characters and {COMMENT_LINKS_MAX} links. Emoji
        can count as several characters, so the limit is measured the way the
        server stores it.
      </p>
      <textarea
        id={fieldId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={`${helpId} ${countId}`}
        aria-invalid={overLength || overLinks}
        rows={3}
        placeholder="Share your reply."
        className="mt-2 w-full resize-y rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none"
      />
      <div
        id={countId}
        className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs"
      >
        <span
          className={
            overLength ? "font-semibold text-signal-danger" : "text-ink-muted"
          }
        >
          {graphemeLength(body)} characters
          {overLength ? " (over the limit)" : ` of ${COMMENT_BODY_MAX}`}
        </span>
        <span
          className={
            overLinks ? "font-semibold text-signal-danger" : "text-ink-muted"
          }
        >
          {links} of {COMMENT_LINKS_MAX} links
        </span>
      </div>
      <div className="mt-3">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {pending ? "Posting..." : "Comment"}
        </button>
      </div>
    </form>
  );
}

function CommentRow({
  comment,
  canModerate,
  isAuthor,
  onAnnounce,
  onError,
}: {
  comment: WallComment;
  canModerate: boolean;
  isAuthor: boolean;
  onAnnounce: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const editFieldId = useId();
  const editCountId = useId();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);

  const codePoints = codePointLength(draft);
  const links = countLinks(draft);
  const overLength = codePoints > COMMENT_BODY_MAX;
  const overLinks = links > COMMENT_LINKS_MAX;
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

  const created = new Date(comment.createdAt);

  return (
    <li className="rounded-card border border-line bg-base p-3">
      <article
        aria-label={`Comment by ${comment.authorName}, ${dateFmt.format(created)}`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          {comment.authorHandle ? (
            <Link
              href={`/u/${comment.authorHandle}`}
              className="font-semibold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {comment.authorName}
            </Link>
          ) : (
            <span className="font-semibold text-ink">{comment.authorName}</span>
          )}
          <time dateTime={created.toISOString()}>
            {dateFmt.format(created)}
          </time>
          {comment.editedAt && <span>(edited)</span>}
          {comment.hidden && (
            <span className="inline-flex items-center gap-1 rounded-full border border-signal-danger/50 bg-surface px-2 py-0.5 font-semibold text-signal-danger">
              Hidden by a moderator
            </span>
          )}
        </div>

        {comment.hidden && comment.hiddenReason && (
          <p className="mt-1 text-xs text-ink-muted">
            Reason: {comment.hiddenReason}
          </p>
        )}

        {editing ? (
          <div className="mt-2">
            <label htmlFor={editFieldId} className="sr-only">
              Edit comment
            </label>
            <textarea
              id={editFieldId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-describedby={editCountId}
              aria-invalid={overLength || overLinks}
              rows={3}
              className="w-full resize-y rounded-card border border-line bg-surface px-3 py-2 text-base text-ink caret-brand-purple focus:border-brand-purple focus:outline-none"
            />
            <div
              id={editCountId}
              className="mt-1 flex flex-wrap items-center justify-between gap-x-4 text-xs"
            >
              <span
                className={
                  overLength
                    ? "font-semibold text-signal-danger"
                    : "text-ink-muted"
                }
              >
                {graphemeLength(draft)} characters
                {overLength ? " (over the limit)" : ` of ${COMMENT_BODY_MAX}`}
              </span>
              <span
                className={
                  overLinks
                    ? "font-semibold text-signal-danger"
                    : "text-ink-muted"
                }
              >
                {links} of {COMMENT_LINKS_MAX} links
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending || draftInvalid}
                onClick={() =>
                  run(
                    () => updateComment(comment.id, draft.trim()),
                    "Comment updated.",
                    () => {
                      setEditing(false);
                      requestAnimationFrame(() =>
                        editButtonRef.current?.focus(),
                      );
                    },
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
                  setDraft(comment.body);
                  setEditing(false);
                  requestAnimationFrame(() => editButtonRef.current?.focus());
                }}
                className="inline-flex h-11 items-center gap-2 rounded-card border border-line px-4 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <X aria-hidden="true" className="h-4 w-4" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <PostBody body={comment.body} />
          </div>
        )}

        {!editing && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isAuthor && !comment.hidden && (
              <button
                ref={editButtonRef}
                type="button"
                disabled={pending}
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(true);
                }}
                className="inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
              >
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                Edit
              </button>
            )}

            {isAuthor &&
              (confirmingDelete ? (
                <span
                  role="group"
                  aria-label="Delete this comment?"
                  className="inline-flex flex-wrap items-center gap-2"
                >
                  <span className="text-xs text-ink-muted">
                    Delete this comment?
                  </span>
                  <button
                    ref={confirmDeleteRef}
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => deleteComment(comment.id), "Comment deleted.")
                    }
                    className="inline-flex h-11 items-center rounded-card border border-signal-danger/60 px-3 text-xs font-semibold text-signal-danger hover:bg-signal-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setConfirmingDelete(false);
                      requestAnimationFrame(() =>
                        deleteTriggerRef.current?.focus(),
                      );
                    }}
                    className="inline-flex h-11 items-center rounded-card border border-line px-3 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  ref={deleteTriggerRef}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmingDelete(true);
                    requestAnimationFrame(() =>
                      confirmDeleteRef.current?.focus(),
                    );
                  }}
                  className="inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  Delete
                </button>
              ))}

            {canModerate &&
              (comment.hidden ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => moderateComment(comment.id, false),
                      "Comment restored.",
                    )
                  }
                  className="inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
                >
                  <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => moderateComment(comment.id, true),
                      "Comment hidden.",
                    )
                  }
                  className="inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
                >
                  <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
                  Hide
                </button>
              ))}

            {!isAuthor && !comment.hidden && (
              <ReportButton targetType="comment" targetId={comment.id} />
            )}
          </div>
        )}
      </article>
    </li>
  );
}
