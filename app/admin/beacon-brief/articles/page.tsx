import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  ArticlesManager,
  type ArticleRow,
  type CategoryOption,
  type TeamOption,
} from "@/components/admin/beacon-brief/articles-manager";

export const metadata: Metadata = { title: "Articles" };
export const dynamic = "force-dynamic";

const STATUSES = ["draft", "published", "archived"];
const selectClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";

export default async function BeaconBriefArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; q?: string }>;
}) {
  await requireAdmin("/admin/beacon-brief/articles");
  const params = await searchParams;
  const admin = createAdminClient();

  const status = STATUSES.includes(params.status ?? "") ? params.status! : "";
  const categoryId = params.category ?? "";
  const q = (params.q ?? "").trim();

  const [{ data: cats }, { data: teamRows }] = await Promise.all([
    admin
      .from("news_categories")
      .select("id, name")
      .order("display_order", { ascending: true }),
    admin
      .from("teams")
      .select("id, abbreviation, name")
      .order("abbreviation", { ascending: true }),
  ]);
  const categories: CategoryOption[] = (cats ?? []) as CategoryOption[];
  const teams: TeamOption[] = (teamRows ?? []) as TeamOption[];

  // Player/team text filter -> set of article ids.
  let articleIdFilter: string[] | null = null;
  if (q.length >= 2) {
    const token = q.replace(/[(),*%]/g, " ").trim();
    const [{ data: pl }, { data: tm }] = await Promise.all([
      admin
        .from("players")
        .select("id")
        .ilike("full_name", `%${token}%`)
        .limit(50),
      admin
        .from("teams")
        .select("id")
        .or(`abbreviation.ilike.${token},name.ilike.%${token}%`)
        .limit(5),
    ]);
    const playerIds = (pl ?? []).map((r) => r.id);
    const teamIds = (tm ?? []).map((r) => r.id);
    const [{ data: ap }, { data: at }] = await Promise.all([
      playerIds.length
        ? admin
            .from("article_players")
            .select("article_id")
            .in("player_id", playerIds)
        : Promise.resolve({ data: [] as { article_id: string }[] }),
      teamIds.length
        ? admin
            .from("article_teams")
            .select("article_id")
            .in("team_id", teamIds)
        : Promise.resolve({ data: [] as { article_id: string }[] }),
    ]);
    const ids = new Set<string>();
    for (const r of ap ?? []) ids.add(r.article_id);
    for (const r of at ?? []) ids.add(r.article_id);
    articleIdFilter = [...ids];
  }

  let query = admin
    .from("articles")
    .select(
      "id, title, slug, status, category_id, tags, tl_dr, meta_description, content_md",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (status) query = query.eq("status", status);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (articleIdFilter !== null) {
    query = query.in(
      "id",
      articleIdFilter.length
        ? articleIdFilter
        : ["00000000-0000-0000-0000-000000000000"],
    );
  }
  const { data } = await query;
  const rows = data ?? [];
  const ids = rows.map((a) => a.id);

  // Assigned teams + players for the listed articles, so the row can show them at
  // a glance without opening the editor.
  const teamsByArticle = new Map<
    string,
    { id: string; abbreviation: string }[]
  >();
  const playersByArticle = new Map<
    string,
    { id: string; full_name: string }[]
  >();
  // Articles whose source-post ingestion carries a live Discord message id, so the
  // delete UI can offer the "also delete the Discord post" toggle.
  const articlesWithDiscord = new Set<string>();
  if (ids.length > 0) {
    const [{ data: atRows }, { data: apRows }, { data: ingRows }] =
      await Promise.all([
        admin
          .from("article_teams")
          .select("article_id, teams(id, abbreviation)")
          .in("article_id", ids),
        admin
          .from("article_players")
          .select("article_id, players(id, full_name)")
          .in("article_id", ids),
        admin
          .from("news_ingestions")
          .select("article_id, discord_message_id")
          .in("article_id", ids),
      ]);
    for (const r of ingRows ?? []) {
      if (r.article_id && r.discord_message_id)
        articlesWithDiscord.add(r.article_id);
    }
    for (const r of atRows ?? []) {
      const t = (r as { teams?: { id?: string; abbreviation?: string } | null })
        .teams;
      if (t?.id && typeof t.abbreviation === "string") {
        const list = teamsByArticle.get(r.article_id) ?? [];
        list.push({ id: t.id, abbreviation: t.abbreviation });
        teamsByArticle.set(r.article_id, list);
      }
    }
    for (const r of apRows ?? []) {
      const p = (r as { players?: { id?: string; full_name?: string } | null })
        .players;
      if (p?.id && typeof p.full_name === "string") {
        const list = playersByArticle.get(r.article_id) ?? [];
        list.push({ id: p.id, full_name: p.full_name });
        playersByArticle.set(r.article_id, list);
      }
    }
  }

  const articles: ArticleRow[] = rows.map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    status: a.status,
    category_id: a.category_id,
    tags: a.tags ?? [],
    tl_dr: a.tl_dr,
    meta_description: a.meta_description,
    content_md: a.content_md,
    assignedTeams: (teamsByArticle.get(a.id) ?? []).sort((x, y) =>
      x.abbreviation.localeCompare(y.abbreviation),
    ),
    assignedPlayers: (playersByArticle.get(a.id) ?? []).sort((x, y) =>
      x.full_name.localeCompare(y.full_name),
    ),
    hasDiscordPost: articlesWithDiscord.has(a.id),
  }));

  return (
    <BeaconBriefPageShell
      title="Articles"
      description="Every article in the system. Filter by status, category, or a player/team name, then edit the content, reassign category, tags, players, and teams, and view the revision history. Showing up to 50 matches."
    >
      <div className="space-y-6">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Filter articles"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Status</span>
            <select name="status" defaultValue={status} className={selectClass}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Category</span>
            <select
              name="category"
              defaultValue={categoryId}
              className={selectClass}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">
              Player or team
            </span>
            <input
              name="q"
              defaultValue={q}
              className={selectClass}
              placeholder="e.g. Mahomes or KC"
            />
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan"
          >
            Apply filters
          </button>
        </form>

        <ArticlesManager
          articles={articles}
          categories={categories}
          teams={teams}
        />
      </div>
    </BeaconBriefPageShell>
  );
}
