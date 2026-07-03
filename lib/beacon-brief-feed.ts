/**
 * Public read layer for The Beacon Brief (the reader-facing blog at /brief).
 *
 * Every query here runs through the anon/authenticated server client, so RLS is
 * the security boundary: `articles` is limited to status = 'published',
 * `news_categories` to is_active rows, and the join tables + players/teams are
 * public reads. Nothing in here uses the service-role client.
 *
 * The admin authoring surface lives separately under /admin/beacon-brief and is
 * unaffected by this module.
 */

import type { createClient } from "@/lib/supabase/server";

type ReaderClient = Awaited<ReturnType<typeof createClient>>;

/** Sentinel used when an entity filter resolves to zero article ids, so the
 * `.in()` clause returns nothing instead of erroring on an empty array. */
const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

/** Default number of article summaries per feed page. */
export const BRIEF_PAGE_SIZE = 9;

/** How many recent published articles we scan to build the sidebar's popular
 * tags and "recently covered" player/team lists. Covers the full library today
 * and scales sensibly as it grows. */
const SIDEBAR_SCAN_LIMIT = 150;

export type FeedArticle = {
  slug: string;
  title: string;
  tlDr: string | null;
  metaDescription: string | null;
  articleType: string;
  publishedAt: string | null;
  lastUpdated: string | null;
  tags: string[];
  category: { slug: string; name: string } | null;
};

export type SidebarCategory = {
  slug: string;
  name: string;
  description: string | null;
  count: number;
};

export type SidebarTag = { tag: string; count: number };

export type SidebarPlayer = {
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
};

export type SidebarTeam = { abbreviation: string; name: string };

export type BriefSidebarData = {
  categories: SidebarCategory[];
  tags: SidebarTag[];
  players: SidebarPlayer[];
  teams: SidebarTeam[];
};

export type ArticlePlayerLink = {
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
};

export type ArticleTeamLink = { abbreviation: string; name: string };

export type FullArticle = {
  id: string;
  slug: string;
  title: string;
  tlDr: string | null;
  metaDescription: string | null;
  contentMd: string | null;
  articleType: string;
  tags: string[];
  publishedAt: string | null;
  lastUpdated: string | null;
  canonicalUrl: string | null;
  category: { slug: string; name: string } | null;
  players: ArticlePlayerLink[];
  teams: ArticleTeamLink[];
};

// PostgREST returns embedded to-one relations as either an object or a single-
// element array depending on the inferred cardinality. Normalize both shapes.
function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapCategory(
  embed: { slug: string; name: string } | { slug: string; name: string }[] | null,
): { slug: string; name: string } | null {
  const c = firstEmbed(embed);
  return c && c.slug ? { slug: c.slug, name: c.name } : null;
}

type FeedRow = {
  slug: string;
  title: string;
  tl_dr: string | null;
  meta_description: string | null;
  article_type: string;
  published_at: string | null;
  last_updated: string | null;
  tags: string[] | null;
  news_categories:
    | { slug: string; name: string }
    | { slug: string; name: string }[]
    | null;
};

function mapFeedRow(row: FeedRow): FeedArticle {
  return {
    slug: row.slug,
    title: row.title,
    tlDr: row.tl_dr,
    metaDescription: row.meta_description,
    articleType: row.article_type,
    publishedAt: row.published_at,
    lastUpdated: row.last_updated,
    tags: row.tags ?? [],
    category: mapCategory(row.news_categories),
  };
}

const FEED_SELECT =
  "slug, title, tl_dr, meta_description, article_type, published_at, last_updated, tags, news_categories(slug, name)";

export type FeedFilter =
  | { kind: "all" }
  | { kind: "category"; categoryId: string }
  | { kind: "tag"; tag: string }
  | { kind: "ids"; articleIds: string[] };

/**
 * Load one page of published article summaries, newest first, optionally scoped
 * by category / tag / a precomputed set of article ids (players and teams).
 * Returns the page plus the total match count for pagination.
 */
export async function loadFeed(
  supabase: ReaderClient,
  filter: FeedFilter,
  page: number,
  pageSize: number = BRIEF_PAGE_SIZE,
): Promise<{ articles: FeedArticle[]; total: number }> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("articles")
    .select(FEED_SELECT, { count: "exact" })
    .eq("status", "published");

  if (filter.kind === "category") {
    query = query.eq("category_id", filter.categoryId);
  } else if (filter.kind === "tag") {
    query = query.contains("tags", [filter.tag]);
  } else if (filter.kind === "ids") {
    query = query.in(
      "id",
      filter.articleIds.length ? filter.articleIds : [NO_MATCH_UUID],
    );
  }

  const { data, count, error } = await query
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (error) {
    console.error("[beacon-brief-feed] loadFeed failed", error);
    return { articles: [], total: 0 };
  }

  return {
    articles: ((data ?? []) as unknown as FeedRow[]).map(mapFeedRow),
    total: count ?? 0,
  };
}

/** Article ids that mention a given player, newest article first. */
export async function articleIdsForPlayer(
  supabase: ReaderClient,
  playerId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("article_players")
    .select("article_id")
    .eq("player_id", playerId);
  return Array.from(new Set((data ?? []).map((r) => r.article_id).filter(Boolean)));
}

/** Article ids that mention a given team. */
export async function articleIdsForTeam(
  supabase: ReaderClient,
  teamId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("article_teams")
    .select("article_id")
    .eq("team_id", teamId);
  return Array.from(new Set((data ?? []).map((r) => r.article_id).filter(Boolean)));
}

export async function resolveCategory(
  supabase: ReaderClient,
  slug: string,
): Promise<{ id: string; slug: string; name: string; description: string | null } | null> {
  const { data } = await supabase
    .from("news_categories")
    .select("id, slug, name, description")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}

export async function resolvePlayer(
  supabase: ReaderClient,
  slug: string,
): Promise<{ id: string; slug: string; name: string; position: string | null; team: string | null } | null> {
  const { data } = await supabase
    .from("players")
    .select("id, slug, full_name, first_name, last_name, position, team")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.full_name ?? `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
    position: data.position,
    team: data.team,
  };
}

export async function resolveTeam(
  supabase: ReaderClient,
  abbreviation: string,
): Promise<{ id: string; abbreviation: string; name: string } | null> {
  const { data } = await supabase
    .from("teams")
    .select("id, abbreviation, name")
    .eq("abbreviation", abbreviation.toUpperCase())
    .maybeSingle();
  return data ?? null;
}

/**
 * Build the sidebar: active categories (with published counts), the most-used
 * tags, and the players / teams covered most recently. Everything derives from
 * the recent published set so the lists stay current without extra bookkeeping.
 */
export async function loadSidebar(
  supabase: ReaderClient,
): Promise<BriefSidebarData> {
  const [catsRes, pubRes] = await Promise.all([
    supabase
      .from("news_categories")
      .select("id, slug, name, description, display_order")
      .order("display_order", { ascending: true }),
    supabase
      .from("articles")
      .select("id, category_id, tags, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(SIDEBAR_SCAN_LIMIT),
  ]);

  const published = (pubRes.data ?? []) as {
    id: string;
    category_id: string | null;
    tags: string[] | null;
    published_at: string | null;
  }[];

  // Per-category published counts.
  const countByCategoryId = new Map<string, number>();
  for (const a of published) {
    if (a.category_id) {
      countByCategoryId.set(a.category_id, (countByCategoryId.get(a.category_id) ?? 0) + 1);
    }
  }
  const categories: SidebarCategory[] = ((catsRes.data ?? []) as {
    id: string;
    slug: string;
    name: string;
    description: string | null;
  }[])
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      count: countByCategoryId.get(c.id) ?? 0,
    }))
    // Hide categories with no published coverage so the filter never leads to
    // an empty page.
    .filter((c) => c.count > 0);

  // Popular tags across the recent set.
  const tagCounts = new Map<string, number>();
  for (const a of published) {
    for (const raw of a.tags ?? []) {
      const tag = raw.trim();
      if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const tags: SidebarTag[] = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 18);

  // Recency rank of each recent article (0 = newest), used to order entities by
  // the freshest article they appear in.
  const recentIds = published.map((a) => a.id);
  const rankById = new Map(recentIds.map((id, i) => [id, i]));

  const [apRes, atRes] = await Promise.all([
    recentIds.length
      ? supabase.from("article_players").select("article_id, player_id").in("article_id", recentIds)
      : Promise.resolve({ data: [] as { article_id: string; player_id: string }[] }),
    recentIds.length
      ? supabase.from("article_teams").select("article_id, team_id").in("article_id", recentIds)
      : Promise.resolve({ data: [] as { article_id: string; team_id: string }[] }),
  ]);

  const bestRankByPlayer = new Map<string, number>();
  for (const r of (apRes.data ?? []) as { article_id: string; player_id: string }[]) {
    const rank = rankById.get(r.article_id);
    if (rank === undefined) continue;
    const prev = bestRankByPlayer.get(r.player_id);
    if (prev === undefined || rank < prev) bestRankByPlayer.set(r.player_id, rank);
  }
  const bestRankByTeam = new Map<string, number>();
  for (const r of (atRes.data ?? []) as { article_id: string; team_id: string }[]) {
    const rank = rankById.get(r.article_id);
    if (rank === undefined) continue;
    const prev = bestRankByTeam.get(r.team_id);
    if (prev === undefined || rank < prev) bestRankByTeam.set(r.team_id, rank);
  }

  // Only the 5 players and 5 teams mentioned in the most recent articles.
  const topPlayerIds = [...bestRankByPlayer.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5)
    .map(([id]) => id);
  const topTeamIds = [...bestRankByTeam.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5)
    .map(([id]) => id);

  const [playersRes, teamsRes] = await Promise.all([
    topPlayerIds.length
      ? supabase
          .from("players")
          .select("id, slug, full_name, first_name, last_name, position, team")
          .in("id", topPlayerIds)
      : Promise.resolve({ data: [] as never[] }),
    topTeamIds.length
      ? supabase.from("teams").select("id, abbreviation, name").in("id", topTeamIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const players: SidebarPlayer[] = ((playersRes.data ?? []) as {
    id: string;
    slug: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    team: string | null;
  }[])
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.position,
      team: p.team,
    }))
    .sort((a, b) => (bestRankByPlayer.get(a.id) ?? 0) - (bestRankByPlayer.get(b.id) ?? 0))
    .map(({ slug, name, position, team }) => ({ slug, name, position, team }));

  const teams: SidebarTeam[] = ((teamsRes.data ?? []) as {
    id: string;
    abbreviation: string;
    name: string;
  }[])
    .sort((a, b) => (bestRankByTeam.get(a.id) ?? 0) - (bestRankByTeam.get(b.id) ?? 0))
    .map(({ abbreviation, name }) => ({ abbreviation, name }));

  return { categories, tags, players, teams };
}

/** Load a single published article by slug with its category, players, teams. */
export async function loadArticle(
  supabase: ReaderClient,
  slug: string,
): Promise<FullArticle | null> {
  const { data, error } = await supabase
    .from("articles")
    .select(
      "id, slug, title, tl_dr, meta_description, content_md, article_type, tags, published_at, last_updated, canonical_url, news_categories(slug, name)",
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error || !data) return null;

  const [apRes, atRes] = await Promise.all([
    supabase
      .from("article_players")
      .select("players(slug, full_name, first_name, last_name, position, team)")
      .eq("article_id", data.id),
    supabase
      .from("article_teams")
      .select("teams(abbreviation, name)")
      .eq("article_id", data.id),
  ]);

  const players: ArticlePlayerLink[] = ((apRes.data ?? []) as {
    players:
      | {
          slug: string;
          full_name: string | null;
          first_name: string | null;
          last_name: string | null;
          position: string | null;
          team: string | null;
        }
      | null;
  }[])
    .map((r) => r.players)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.position,
      team: p.team,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const teams: ArticleTeamLink[] = ((atRes.data ?? []) as {
    teams: { abbreviation: string; name: string } | null;
  }[])
    .map((r) => r.teams)
    .filter((t): t is NonNullable<typeof t> => Boolean(t?.abbreviation))
    .map((t) => ({ abbreviation: t.abbreviation, name: t.name }))
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    tlDr: data.tl_dr,
    metaDescription: data.meta_description,
    contentMd: data.content_md,
    articleType: data.article_type,
    tags: data.tags ?? [],
    publishedAt: data.published_at,
    lastUpdated: data.last_updated,
    canonicalUrl: data.canonical_url,
    category: mapCategory(data.news_categories),
    players,
    teams,
  };
}

/** Recent published articles in the same category, excluding the current one. */
export async function loadRelatedArticles(
  supabase: ReaderClient,
  article: FullArticle,
  limit = 4,
): Promise<FeedArticle[]> {
  if (!article.category) return [];
  const category = await resolveCategory(supabase, article.category.slug);
  if (!category) return [];

  const { data } = await supabase
    .from("articles")
    .select(FEED_SELECT)
    .eq("status", "published")
    .eq("category_id", category.id)
    .neq("slug", article.slug)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return ((data ?? []) as unknown as FeedRow[]).map(mapFeedRow);
}
