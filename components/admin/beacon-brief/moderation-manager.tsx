"use client";

import { useState, useTransition } from "react";
import {
  approveModeration,
  dismissMatch,
  rejectModeration,
  resolveMatch,
  retryModerationTask,
  searchPlayers,
  skipModerationTask,
  type PlayerOption,
} from "@/app/admin/beacon-brief/actions";
import { formatEastern } from "@/lib/datetime";

/** The ingested source post a moderation item refers to, shown for context. */
export interface IngestedPost {
  authorHandle: string | null;
  text: string;
  externalUrl: string | null;
  media: { type: string; url: string }[];
  quoted: { authorHandle: string | null; text: string } | null;
  retweeted: { authorHandle: string | null; text: string } | null;
}

export interface DeletionItem {
  type: "deletion";
  id: string;
  created_at: string;
  articleTitle: string | null;
  articleSlug: string | null;
  detail: string;
  post: IngestedPost | null;
}

export interface MatchItem {
  type: "player_match" | "team_match";
  id: string;
  created_at: string;
  rawName: string;
  candidates: { id: string; label: string }[];
  articleTitle: string | null;
  articleSlug: string | null;
  articleReady: boolean;
  post: IngestedPost | null;
}

export interface FailedTaskItem {
  type: "failed_task";
  id: string;
  created_at: string;
  jobType: string;
  error: string | null;
  attempts: number | null;
  articleTitle: string | null;
  articleSlug: string | null;
  post: IngestedPost | null;
}

export type ModerationItem = DeletionItem | MatchItem | FailedTaskItem;

export interface TeamOption {
  id: string;
  abbreviation: string;
  name: string;
}

type Status = { msg: string; error: boolean } | null;
type RunFn = (
  fn: () => Promise<{ ok: boolean; error?: string }>,
  okMsg: string,
) => void;

const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50";
const inputClass =
  "min-h-[44px] w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";

/**
 * The ingested source post this item is about, so the reviewer has the full
 * context (text, quoted/retweeted content, attachments, link) needed to decide
 * which player/team to link or whether to approve a deletion.
 */
export function PostContext({
  post,
  label = "Post being moderated",
}: {
  post: IngestedPost | null;
  label?: string;
}) {
  if (!post) return null;
  const context = post.retweeted ?? post.quoted;
  // Skip the quoted/retweeted block when its text is the same as the main text
  // (a retweet promotes the original text into the body), to avoid showing it twice.
  const showContext =
    context !== null && context.text.trim() !== post.text.trim();
  const contextLabel = post.retweeted ? "Retweeted post" : "Quoted post";

  return (
    <figure className="mb-3 rounded-card border border-line bg-base/60 p-3">
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
        <span className="font-semibold text-ink-muted">{label}</span>
        {post.authorHandle ? (
          <span className="font-mono">@{post.authorHandle}</span>
        ) : null}
        {post.externalUrl ? (
          <a
            href={post.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-cyan underline"
            aria-label="View the original post on X (opens in a new tab)"
          >
            View on X
          </a>
        ) : null}
      </figcaption>
      {post.text ? (
        <p className="whitespace-pre-wrap text-sm text-ink">{post.text}</p>
      ) : (
        <p className="text-sm text-ink-subtle">(this post has no text)</p>
      )}
      {showContext && context ? (
        <div className="mt-2 border-l-2 border-line pl-3">
          <p className="text-xs text-ink-subtle">
            {contextLabel}
            {context.authorHandle ? ` from @${context.authorHandle}` : ""}
          </p>
          <p className="whitespace-pre-wrap text-sm text-ink-muted">
            {context.text}
          </p>
        </div>
      ) : null}
      {post.media.length > 0 ? (
        <p className="mt-2 text-xs text-ink-subtle">
          {post.media.length}{" "}
          {post.media.length === 1 ? "attachment" : "attachments"} (
          {post.media.map((m) => m.type).join(", ")}). Open the post to view.
        </p>
      ) : null}
    </figure>
  );
}

function DeletionRow({
  item,
  pending,
  run,
}: {
  item: DeletionItem;
  pending: boolean;
  run: RunFn;
}) {
  return (
    <>
      <p className="font-medium text-ink">
        {item.articleTitle ?? "(untitled article)"}
      </p>
      {item.articleSlug && (
        <p className="mt-1 text-xs text-ink-subtle">
          <span className="font-mono">{item.articleSlug}</span>{" "}
          <a
            href="/admin/beacon-brief/articles"
            className="ml-2 font-semibold text-brand-cyan underline"
          >
            Open in Articles to review
          </a>
        </p>
      )}
      <p className="mt-1 text-sm text-ink-muted">
        The source post for this article appears to have been deleted. Approve
        to unpublish the article and patch the Discord message to a retracted
        state, or reject to keep the article as is.
      </p>
      <p className="mt-1 text-xs text-ink-subtle">
        Detected {formatEastern(item.created_at)}
        {item.detail ? ` | ${item.detail}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={`${btnClass} hover:border-signal-danger`}
          onClick={() => {
            if (
              confirm(
                "Approve deletion? This unpublishes the article and retracts the Discord post.",
              )
            ) {
              run(() => approveModeration(item.id), "Deletion approved.");
            }
          }}
        >
          Approve deletion
        </button>
        <button
          type="button"
          disabled={pending}
          className={btnClass}
          onClick={() =>
            run(() => rejectModeration(item.id), "Kept the article.")
          }
        >
          Reject (keep article)
        </button>
      </div>
    </>
  );
}

function MatchResolver({
  item,
  teams,
  pending,
  run,
}: {
  item: MatchItem;
  teams: TeamOption[];
  pending: boolean;
  run: RunFn;
}) {
  const isPlayer = item.type === "player_match";
  const kindLabel = isPlayer ? "player" : "team";

  // Player search state (only used for player_match).
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerOption[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, startSearch] = useTransition();

  // Team picker state (only used for team_match).
  const [teamId, setTeamId] = useState("");

  const doSearch = () =>
    startSearch(async () => {
      const r = await searchPlayers(query);
      setResults(r);
      setSearched(true);
    });

  const resultsId = `match-results-${item.id}`;

  return (
    <>
      <p className="font-medium text-ink">
        Unmatched {kindLabel}:{" "}
        <span className="text-brand-cyan">{item.rawName}</span>
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        This {kindLabel} name could not be confidently matched, so it was not
        auto-linked. Choose the correct {kindLabel} below to link it to the
        article, or dismiss it.
      </p>
      {item.articleTitle && (
        <p className="mt-1 text-xs text-ink-subtle">
          Article: {item.articleTitle}
          {item.articleSlug ? (
            <>
              {" "}
              <span className="font-mono">{item.articleSlug}</span>
            </>
          ) : null}{" "}
          <a
            href="/admin/beacon-brief/articles"
            className="ml-1 font-semibold text-brand-cyan underline"
          >
            Open in Articles
          </a>
        </p>
      )}
      {!item.articleReady && (
        <p className="mt-1 text-xs text-signal-warning">
          The article is still being written. You can resolve this once it
          exists (usually within a minute).
        </p>
      )}
      <p className="mt-1 text-xs text-ink-subtle">
        Flagged {formatEastern(item.created_at)}
      </p>

      {item.candidates.length > 0 && (
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium text-ink">
            Suggested matches
          </legend>
          <ul className="flex flex-wrap gap-2">
            {item.candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={pending}
                  className={btnClass}
                  onClick={() =>
                    run(() => resolveMatch(item.id, c.id), `Linked ${c.label}.`)
                  }
                >
                  Link {c.label}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {isPlayer ? (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} sm:w-64`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a different player"
              aria-label={`Search for a different player to match "${item.rawName}"`}
            />
            <button
              type="button"
              disabled={searching}
              className={btnClass}
              onClick={doSearch}
            >
              Search
            </button>
          </div>
          <div aria-live="polite" aria-busy={searching} id={resultsId}>
            {searched && results.length === 0 && (
              <p className="mt-2 text-xs text-ink-subtle">No players found.</p>
            )}
            {results.length > 0 && (
              <p className="sr-only">{results.length} players found.</p>
            )}
          </div>
          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={pending}
                    className={btnClass}
                    onClick={() =>
                      run(
                        () => resolveMatch(item.id, p.id),
                        `Linked ${p.full_name}.`,
                      )
                    }
                  >
                    Link {p.full_name}
                    {p.position
                      ? ` (${p.position}${p.team ? ` - ${p.team}` : ""})`
                      : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">
              Choose the correct team
            </span>
            <select
              className={`${inputClass} sm:w-64`}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">Select a team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.abbreviation})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !teamId}
            className={btnClass}
            onClick={() =>
              run(() => resolveMatch(item.id, teamId), "Linked the team.")
            }
          >
            Link selected team
          </button>
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          disabled={pending}
          className={btnClass}
          onClick={() =>
            run(() => dismissMatch(item.id), "Dismissed (no link).")
          }
        >
          Dismiss (no link)
        </button>
      </div>
    </>
  );
}

const JOB_TYPE_LABELS: Record<string, string> = {
  discord_post: "Post to Discord",
  discord_patch: "Update the Discord post",
  article_write: "Write the article",
  deletion_sweep: "Re-check whether source posts were deleted",
  deletion_check: "Check whether the source post was deleted",
};

function jobTypeLabel(jobType: string): string {
  return JOB_TYPE_LABELS[jobType] ?? jobType;
}

function FailedTaskRow({
  item,
  pending,
  run,
}: {
  item: FailedTaskItem;
  pending: boolean;
  run: RunFn;
}) {
  return (
    <>
      <p className="font-medium text-ink">
        Failed task: {jobTypeLabel(item.jobType)}
      </p>
      {item.articleTitle && (
        <p className="mt-1 text-xs text-ink-subtle">
          Article: {item.articleTitle}
          {item.articleSlug ? (
            <>
              {" "}
              <span className="font-mono">{item.articleSlug}</span>
            </>
          ) : null}{" "}
          <a
            href="/admin/beacon-brief/articles"
            className="ml-1 font-semibold text-brand-cyan underline"
          >
            Open in Articles
          </a>
        </p>
      )}
      <p className="mt-1 text-sm text-ink-muted">
        This task failed on every retry attempt
        {item.attempts !== null ? ` (${item.attempts} attempts)` : ""}. Retry
        sends only this task back to the queue; it does not repeat any part of
        the pipeline that already succeeded (for example, a Discord post that
        already went out will not be posted again). Skip leaves it failed and
        removes it from this list.
      </p>
      {item.error && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-signal-danger">
          {item.error}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-subtle">
        Failed {formatEastern(item.created_at)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnClass}
          onClick={() =>
            run(() => retryModerationTask(item.id), "Task re-queued.")
          }
        >
          Retry
        </button>
        <button
          type="button"
          disabled={pending}
          className={`${btnClass} hover:border-signal-danger`}
          onClick={() =>
            run(() => skipModerationTask(item.id), "Task skipped.")
          }
        >
          Skip / Ignore
        </button>
      </div>
    </>
  );
}

export function ModerationManager({
  items,
  teams,
}: {
  items: ModerationItem[];
  teams: TeamOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  const run: RunFn = (fn, okMsg) =>
    startTransition(async () => {
      setStatus(null);
      const res = await fn();
      setStatus(
        res.ok
          ? { msg: okMsg, error: false }
          : { msg: `Failed: ${res.error}`, error: true },
      );
    });

  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing needs your attention right now.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem] text-sm text-ink-muted"
      >
        {status && !status.error ? status.msg : ""}
      </p>
      <p
        role="alert"
        aria-live="assertive"
        className="text-sm text-signal-danger"
      >
        {status && status.error ? status.msg : ""}
      </p>
      <ul className="space-y-3">
        {items.map((m) => (
          <li
            key={m.id}
            className="rounded-card border border-line bg-surface/60 p-4"
          >
            <PostContext post={m.post} />
            {m.type === "deletion" ? (
              <DeletionRow item={m} pending={pending} run={run} />
            ) : m.type === "failed_task" ? (
              <FailedTaskRow item={m} pending={pending} run={run} />
            ) : (
              <MatchResolver
                item={m}
                teams={teams}
                pending={pending}
                run={run}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
