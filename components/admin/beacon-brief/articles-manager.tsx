"use client";

import { useEffect, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteArticle,
  getArticleDetail,
  searchPlayers,
  updateArticleAssignments,
  updateArticleContent,
  type ArticleDetail,
  type PlayerOption,
} from "@/app/admin/beacon-brief/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatEastern } from "@/lib/datetime";

export interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  category_id: string | null;
  tags: string[];
  tl_dr: string | null;
  meta_description: string | null;
  content_md: string | null;
  /** Teams currently linked to the article, shown at a glance on the row. */
  assignedTeams: { id: string; abbreviation: string }[];
  /** Players currently linked to the article, shown at a glance on the row. */
  assignedPlayers: { id: string; full_name: string }[];
  /** True when the article's source post has a live Discord message that can be
   *  deleted alongside it. */
  hasDiscordPost: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
}
export interface TeamOption {
  id: string;
  abbreviation: string;
  name: string;
}

const inputClass =
  "min-h-[44px] w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50";

function ArticleEditor({
  article,
  categories,
  teams,
  onDeleted,
}: {
  article: ArticleRow;
  categories: CategoryOption[];
  teams: TeamOption[];
  onDeleted: (warning?: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [deleteDiscord, setDeleteDiscord] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<{ msg: string; error: boolean } | null>(
    null,
  );

  const willDeleteDiscord = article.hasDiscordPost && deleteDiscord;
  const performDelete = () =>
    startTransition(async () => {
      setStatus(null);
      const res = await deleteArticle(article.id, {
        deleteDiscordPost: willDeleteDiscord,
      });
      if (res.ok) {
        onDeleted(res.warning);
      } else {
        setStatus({ msg: `Failed: ${res.error}`, error: true });
      }
    });

  // Content state
  const [title, setTitle] = useState(article.title);
  const [tlDr, setTlDr] = useState(article.tl_dr ?? "");
  const [meta, setMeta] = useState(article.meta_description ?? "");
  const [body, setBody] = useState(article.content_md ?? "");
  const [pubStatus, setPubStatus] = useState(article.status);

  // Assignment state
  const [categoryId, setCategoryId] = useState(article.category_id ?? "");
  const [tags, setTags] = useState(article.tags.join(", "));
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [players, setPlayers] = useState<{ id: string; full_name: string }[]>(
    [],
  );
  const [revisions, setRevisions] = useState<ArticleDetail["revisions"]>([]);
  const [detailLoaded, setDetailLoaded] = useState(false);

  // Player search
  const [pQuery, setPQuery] = useState("");
  const [pResults, setPResults] = useState<PlayerOption[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let active = true;
    getArticleDetail(article.id).then((d) => {
      if (!active) return;
      setTeamIds(d.teams.map((t) => t.id));
      setPlayers(d.players);
      setRevisions(d.revisions);
      setDetailLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [article.id]);

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) =>
    startTransition(async () => {
      setStatus(null);
      const res = await fn();
      setStatus(
        res.ok
          ? { msg: okMsg, error: false }
          : { msg: `Failed: ${res.error}`, error: true },
      );
    });

  const doSearch = () =>
    startTransition(async () => {
      const results = await searchPlayers(pQuery);
      setPResults(results);
      setSearched(true);
    });

  const addPlayer = (p: PlayerOption) => {
    if (!players.some((x) => x.id === p.id))
      setPlayers([...players, { id: p.id, full_name: p.full_name }]);
    setPResults([]);
    setPQuery("");
  };

  const toggleTeam = (id: string) =>
    setTeamIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );

  return (
    <div className="mt-3 space-y-5 border-t border-line pt-4">
      {/* Success announces politely; failures announce assertively (role=alert).
          Both regions stay mounted so the screen reader picks up the change. */}
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

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">Content</legend>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Title</span>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">TL;DR</span>
          <input
            className={inputClass}
            value={tlDr}
            onChange={(e) => setTlDr(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">
            Meta description
          </span>
          <input
            className={inputClass}
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">
            Body (markdown)
          </span>
          <textarea
            rows={10}
            className="w-full rounded-card border border-line bg-base px-3 py-2 font-mono text-sm leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Status</span>
          <select
            className={inputClass}
            value={pubStatus}
            onChange={(e) => setPubStatus(e.target.value)}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          className={btnClass}
          onClick={() =>
            run(
              () =>
                updateArticleContent(article.id, {
                  title,
                  meta_description: meta,
                  tl_dr: tlDr,
                  content_md: body,
                  status: pubStatus,
                }),
              "Content saved.",
            )
          }
        >
          Save content
        </button>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">Assignments</legend>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Category</span>
          <select
            className={inputClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">
            Tags (comma separated)
          </span>
          <input
            className={inputClass}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </label>

        <fieldset className="text-sm">
          <legend className="mb-1 block font-medium text-ink">Teams</legend>
          <div className="grid max-h-44 grid-cols-2 gap-1 overflow-auto rounded-card border border-line bg-base p-2 sm:grid-cols-4">
            {teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={teamIds.includes(t.id)}
                  onChange={() => toggleTeam(t.id)}
                  className="h-4 w-4"
                />
                <span>{t.abbreviation}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="text-sm">
          <legend className="mb-1 block font-medium text-ink">Players</legend>
          {!detailLoaded ? (
            <p className="text-xs text-ink-subtle">Loading...</p>
          ) : (
            <ul className="mb-2 flex flex-wrap gap-2">
              {players.map((p) => (
                <li
                  key={p.id}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-line pl-3 text-xs"
                >
                  {p.full_name}
                  <button
                    type="button"
                    aria-label={`Remove ${p.full_name}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-subtle hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
                    onClick={() =>
                      setPlayers(players.filter((x) => x.id !== p.id))
                    }
                  >
                    x
                  </button>
                </li>
              ))}
              {players.length === 0 && (
                <li className="text-xs text-ink-subtle">No players linked.</li>
              )}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} sm:w-64`}
              value={pQuery}
              onChange={(e) => setPQuery(e.target.value)}
              placeholder="Search player by name"
              aria-label="Search player by name"
            />
            <button
              type="button"
              disabled={pending}
              className={btnClass}
              onClick={doSearch}
            >
              Search
            </button>
          </div>
          <div aria-live="polite">
            {searched && pResults.length === 0 && (
              <p className="mt-2 text-xs text-ink-subtle">No players found.</p>
            )}
            {pResults.length > 0 && (
              <p className="sr-only">{pResults.length} players found.</p>
            )}
          </div>
          {pResults.length > 0 && (
            <ul className="mt-2 space-y-1">
              {pResults.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="text-sm text-brand-cyan underline"
                    onClick={() => addPlayer(p)}
                  >
                    Add {p.full_name}{" "}
                    {p.position
                      ? `(${p.position}${p.team ? ` - ${p.team}` : ""})`
                      : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <button
          type="button"
          disabled={pending || !detailLoaded}
          className={btnClass}
          onClick={() =>
            run(
              () =>
                updateArticleAssignments(
                  article.id,
                  categoryId || null,
                  tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  players.map((p) => p.id),
                  teamIds,
                ),
              "Assignments saved.",
            )
          }
        >
          Save assignments
        </button>
      </fieldset>

      <section aria-label="Revision history">
        <h2 className="text-sm font-semibold text-ink">Revision history</h2>
        {revisions.length === 0 ? (
          <p className="mt-1 text-xs text-ink-subtle">No revisions recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-ink-muted">
            {revisions.map((r) => (
              <li key={r.revision_number}>
                <span className="font-mono text-ink-subtle">
                  #{r.revision_number}
                </span>{" "}
                {formatEastern(r.created_at)}
                {r.change_summary ? ` - ${r.change_summary}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby={`danger-${article.id}`}
        className="rounded-card border border-signal-danger/40 p-4"
      >
        <h2
          id={`danger-${article.id}`}
          className="text-sm font-semibold text-signal-danger"
        >
          Danger zone
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Permanently delete this article along with its player and team links
          and its revision history. This cannot be undone.
        </p>
        {article.hasDiscordPost ? (
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={deleteDiscord}
              onChange={(e) => setDeleteDiscord(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Also delete the linked Discord post</span>
          </label>
        ) : (
          <p className="mt-3 text-xs text-ink-subtle">
            No Discord post is linked to this article.
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          className={`${btnClass} mt-3 inline-flex items-center gap-2 hover:border-signal-danger`}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete article permanently
        </button>
      </section>

      {confirmOpen && (
        <ConfirmDialog
          icon={Trash2}
          tone="danger"
          title="Delete this article?"
          description={
            <>
              This permanently deletes{" "}
              <span className="font-semibold text-ink">{article.title}</span>{" "}
              along with its player and team links and its revision history.
              This cannot be undone.
              {article.hasDiscordPost ? (
                <span className="mt-3 block">
                  {willDeleteDiscord
                    ? "The linked Discord post will also be deleted."
                    : "The linked Discord post will be left in place."}
                </span>
              ) : null}
            </>
          }
          confirmLabel="Delete article"
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirmOpen(false);
            performDelete();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

export function ArticlesManager({
  articles,
  categories,
  teams,
}: {
  articles: ArticleRow[];
  categories: CategoryOption[];
  teams: TeamOption[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "Uncategorized";

  const handleDeleted = (id: string, warning?: string) => {
    setDeletedIds((prev) => new Set(prev).add(id));
    setOpenId((cur) => (cur === id ? null : cur));
    setNotice(warning ? `Article deleted. ${warning}` : "Article deleted.");
  };

  const visible = articles.filter((a) => !deletedIds.has(a.id));

  return (
    <div className="space-y-3">
      <p
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem] text-sm text-ink-muted"
      >
        {notice ?? ""}
      </p>
      {visible.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No articles match the current filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((a) => {
            const open = openId === a.id;
            return (
              <li
                key={a.id}
                className="rounded-card border border-line bg-surface/60 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{a.title}</p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      <span className="rounded-full border border-line px-2 py-0.5">
                        {a.status}
                      </span>{" "}
                      <span className="ml-1">
                        <span className="font-medium text-ink-muted">
                          Category:
                        </span>{" "}
                        {categoryName(a.category_id)}
                      </span>
                      {a.tags.length > 0 ? (
                        <span className="ml-2">
                          <span className="font-medium text-ink-muted">
                            Tags:
                          </span>{" "}
                          {a.tags.join(", ")}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      <span className="font-medium text-ink-subtle">
                        Teams:
                      </span>{" "}
                      {a.assignedTeams.length > 0
                        ? a.assignedTeams.map((t) => t.abbreviation).join(", ")
                        : "none"}
                      <span className="ml-3 font-medium text-ink-subtle">
                        Players:
                      </span>{" "}
                      {a.assignedPlayers.length > 0
                        ? a.assignedPlayers.map((p) => p.full_name).join(", ")
                        : "none"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={btnClass}
                    aria-expanded={open}
                    aria-controls={`editor-${a.id}`}
                    onClick={() => setOpenId(open ? null : a.id)}
                  >
                    {open ? "Close" : "Edit"}
                  </button>
                </div>
                {open && (
                  <div id={`editor-${a.id}`}>
                    <ArticleEditor
                      article={a}
                      categories={categories}
                      teams={teams}
                      onDeleted={(warning) => handleDeleted(a.id, warning)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
