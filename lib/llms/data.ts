/**
 * The public reads behind /llms.txt and /llms-full.txt.
 *
 * Both documents describe the same site, so they read the same rows through one
 * module rather than each growing its own query. Everything here is a PUBLIC
 * table read through the publishable key, so RLS is the guarantee that nothing
 * private can reach either file: there is no service-role client in this
 * directory and there must never be one.
 *
 * Every read is bounded. `articleIndex` takes a cap because the Brief grows
 * without limit and a document a model has to swallow in one fetch cannot.
 * Nothing here fans out per row.
 */

import { createCachedReadClient } from "@/lib/supabase/server";
import type { RankingFormat } from "@/lib/rankings-formats";

/**
 * A format, in the exact shape `lib/rankings-formats.ts` reads.
 *
 * Deliberately that shape rather than a friendlier one of our own, so both
 * documents can call `formatPhrase()` and name a format the same way its own
 * rankings page does. `display_name` is the abbreviated header-popover label
 * ("Dynasty PPR SF"); the phrase is what a reader would type ("Dynasty
 * Superflex PPR"), and a map that calls a page something the page does not
 * call itself is a worse map.
 */
export type FormatRow = RankingFormat;

export type SourceRow = {
  slug: string;
  display: string;
  description: string | null;
  isDefault: boolean;
  supportedFormatSlugs: string[] | null;
};

export type CategoryRow = {
  slug: string;
  name: string;
  description: string | null;
};

export type ArticleRow = {
  slug: string;
  title: string;
  summary: string;
  publishedAt: string | null;
};

export type LlmsData = {
  formats: FormatRow[];
  sources: SourceRow[];
  categories: CategoryRow[];
  articles: ArticleRow[];
  /** Every published article, not just the ones listed above. */
  articleCount: number;
};

/** Collapse any summary to one clean line, so a list item cannot wrap a table. */
export function oneLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3).trimEnd()}...`;
}

/**
 * One round of reads for a whole document.
 *
 * `articleLimit` of 0 skips the article list entirely: /llms.txt is a map and
 * has no business enumerating the Brief, while /llms-full.txt wants an index of
 * it. The count comes back either way, because "how much is here" is a useful
 * thing for a model to know even when the list is not included.
 */
export async function loadLlmsData(articleLimit: number): Promise<LlmsData> {
  const supabase = createCachedReadClient();

  const [formatsRes, sourcesRes, categoriesRes, articlesRes, countRes] =
    await Promise.all([
      supabase
        .from("format_configs")
        .select(
          "slug, display_name, league_type, scoring_type, is_superflex, te_premium_bonus",
        )
        .eq("is_active", true)
        .order("display_order"),
      supabase
        .from("source_registry")
        .select("slug, display_name, description, is_default, supported_format_slugs")
        .eq("is_active", true)
        .order("priority"),
      supabase
        .from("news_categories")
        .select("slug, name, description")
        .eq("is_active", true)
        .order("display_order"),
      articleLimit > 0
        ? supabase
            .from("articles")
            .select("slug, title, tl_dr, meta_description, published_at")
            .eq("status", "published")
            .order("published_at", { ascending: false })
            .limit(articleLimit)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("status", "published"),
    ]);

  // A FAILED READ IS NEVER EVIDENCE ABOUT THE SITE.
  //
  // Every read below coalesces a null `data` to an empty array, which is the
  // right answer for an empty table and a lie for a failed request. Without
  // this check a throttled or briefly unavailable database publishes a document
  // asserting "0 value sources are live", "0 formats are active" and "0
  // articles are published", and `revalidate = 3600` plus a day of
  // stale-while-revalidate then serves that confident wrong answer to every
  // crawler for an hour or more. Throwing makes the route 500, which caches
  // nothing and is the honest outcome: same rule the Sleeper readers follow.
  for (const [name, res] of [
    ["format_configs", formatsRes],
    ["source_registry", sourcesRes],
    ["news_categories", categoriesRes],
    ["articles", articlesRes],
    ["articles count", countRes],
  ] as const) {
    if (res.error) {
      throw new Error(`[llms] ${name} read failed: ${res.error.message}`);
    }
  }

  const formats: FormatRow[] = (formatsRes.data ?? []).map((f) => ({
    slug: f.slug,
    display_name: f.display_name,
    league_type: f.league_type,
    scoring_type: f.scoring_type,
    is_superflex: f.is_superflex,
    te_premium_bonus: f.te_premium_bonus,
  }));

  const sources: SourceRow[] = (sourcesRes.data ?? []).map((s) => ({
    slug: s.slug,
    display: s.display_name,
    description: s.description,
    isDefault: s.is_default,
    supportedFormatSlugs: s.supported_format_slugs,
  }));

  const categories: CategoryRow[] = (categoriesRes.data ?? []).map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
  }));

  const articles: ArticleRow[] = (
    (articlesRes.data ?? []) as Array<{
      slug: string;
      title: string;
      tl_dr: string | null;
      meta_description: string | null;
      published_at: string | null;
    }>
  ).map((a) => ({
    slug: a.slug,
    title: a.title,
    summary: oneLine(a.tl_dr || a.meta_description || ""),
    publishedAt: a.published_at,
  }));

  return {
    formats,
    sources,
    categories,
    articles,
    // `count` is null only on a head request that failed, and the guard above
    // has already thrown in that case, so the fallback is unreachable rather
    // than a silent zero.
    articleCount: countRes.count ?? articles.length,
  };
}
