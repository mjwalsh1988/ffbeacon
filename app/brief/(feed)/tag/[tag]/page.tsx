import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import {
  loadFeed,
  loadSidebar,
  anyPlayerCurrentlyRanked,
  BRIEF_PAGE_SIZE,
} from "@/lib/beacon-brief-feed";
import {
  countArticleWords,
  isArticleIndexable,
  THIN_ARTICLE_WORDS,
} from "@/lib/beacon-brief/index-quality";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";

type PageProps = {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ page?: string }>;
};

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** URL-decode the tag segment. Tags are stored as free text (mixed case, spaces)
 * and encoded with encodeURIComponent when linked, so decode to match. */
function decodeTag(raw: string): string {
  try {
    return decodeURIComponent(raw).slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

/** How many of a tag's newest published articles this checks before giving up
 * on finding three indexable ones. Bounded rather than a full scan: a tag
 * either clears the floor in its first handful of articles or it does not,
 * and this page renders on every request. */
const TAG_INDEX_SCAN_LIMIT = 20;

/** A tag needs at least this many indexable articles to be worth advertising
 * to search engines. Free-text tags are author-typed and unbounded in count,
 * so most carry one or two thin mentions with nothing to say for themselves. */
const TAG_MIN_INDEXABLE_ARTICLES = 3;

type TagArticleRow = { id: string; content_md: string | null };

/**
 * Does this tag clear the quality floor? Reuses isArticleIndexable, the exact
 * rule the article page (app/brief/[slug]/page.tsx) applies to itself, rather
 * than a second copy of it. An article is indexable on word count alone in the
 * common case, so the per-article ranked-player check only runs for the thin
 * ones, and the whole scan stops the moment three indexable articles are
 * found.
 */
async function tagIsIndexable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tag: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("articles")
    .select("id, content_md")
    .eq("status", "published")
    .contains("tags", [tag])
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(TAG_INDEX_SCAN_LIMIT);

  const articles = (data ?? []) as TagArticleRow[];

  // Three waves, never a loop of awaits: the articles above, ONE read for the
  // players of every thin article, then the ranked checks in parallel. The
  // sequential loop this replaced cost up to 41 round trips on every render of
  // a tag page, crawler hits included (SEO-T994).
  const thinIds = new Set(
    articles
      .filter((article) => countArticleWords(article.content_md) < THIN_ARTICLE_WORDS)
      .map((article) => article.id),
  );
  const playersByArticle = new Map<string, string[]>();
  if (thinIds.size > 0) {
    const { data: links } = await supabase
      .from("article_players")
      .select("article_id, player_id")
      .in("article_id", [...thinIds]);
    for (const link of links ?? []) {
      const list = playersByArticle.get(link.article_id) ?? [];
      list.push(link.player_id);
      playersByArticle.set(link.article_id, list);
    }
  }

  const rankedFlags = await Promise.all(
    articles.map((article) =>
      thinIds.has(article.id)
        ? anyPlayerCurrentlyRanked(supabase, playersByArticle.get(article.id) ?? [])
        : Promise.resolve(false),
    ),
  );

  const indexableCount = articles.filter((article, i) =>
    isArticleIndexable({ contentMd: article.content_md, hasRankedPlayer: rankedFlags[i] }),
  ).length;
  return indexableCount >= TAG_MIN_INDEXABLE_ARTICLES;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { tag: rawTag } = await params;
  const { page } = await searchParams;
  const tag = decodeTag(rawTag);
  const currentPage = parsePage(page);
  const base = `${SITE.url}/brief/tag/${encodeURIComponent(tag)}`;
  const canonical = currentPage > 1 ? `${base}?page=${currentPage}` : base;
  const title = `${tag} - The Beacon Brief`;
  const description = `Fantasy football articles tagged "${tag}" from The Beacon Brief.`;
  // Tags are free text an author types while drafting an article, not a
  // curated taxonomy, so most exist to cover one or two articles and are not
  // worth a search result of their own. index only once the tag has earned
  // it; follow stays true either way so a crawler that lands here still
  // walks out to the articles and, through them, the player profiles.
  const supabase = await createClient();
  const indexable = await tagIsIndexable(supabase, tag);
  return {
    title,
    description,
    alternates: { canonical },
    robots: {
      index: indexable,
      follow: true,
      googleBot: {
        index: indexable,
        follow: true,
      },
    },
    // Filtered views of the Brief share the Brief's own card. The headline
    // and the description below still name the filter, so the preview reads
    // correctly even though the artwork is the section's.
    ...pageShareMetadata({ key: "brief", title, description, path: "/brief" }),
  };
}

export default async function BriefTagPage({ params, searchParams }: PageProps) {
  const { tag: rawTag } = await params;
  const { page } = await searchParams;
  const tag = decodeTag(rawTag);
  const currentPage = parsePage(page);
  const supabase = await createClient();

  const [sidebarData, feed] = await Promise.all([
    loadSidebar(supabase),
    loadFeed(supabase, { kind: "tag", tag }, currentPage),
  ]);

  return (
    <BriefFeed
      eyebrow="Tag"
      heading={tag}
      description={`Every Beacon Brief article tagged "${tag}", newest first.`}
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: tag },
      ]}
      sidebarData={sidebarData}
      active={{ type: "tag", value: tag }}
      articles={feed.articles}
      total={feed.total}
      currentPage={currentPage}
      pageSize={BRIEF_PAGE_SIZE}
      basePath={`/brief/tag/${encodeURIComponent(tag)}`}
    />
  );
}
