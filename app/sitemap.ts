import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";

// Revalidate the sitemap hourly so newly published profiles appear without a
// redeploy.
export const revalidate = 3600;

// Core public pages that always belong in the sitemap.
const STATIC_PATHS: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/rankings", priority: 0.9 },
  { path: "/players", priority: 0.7 },
  { path: "/tools", priority: 0.7 },
  { path: "/tools/beacon-breakdown", priority: 0.6 },
  { path: "/tools/league-pulse", priority: 0.6 },
  { path: "/tools/faab", priority: 0.6 },
  { path: "/brief", priority: 0.7 },
  { path: "/guides", priority: 0.5 },
  { path: "/about", priority: 0.4 },
  { path: "/author/michael", priority: 0.4 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map(({ path, priority }) => ({
    url: `${SITE.url}${path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority,
  }));

  // Only live Signal profiles (published + public + not hidden) are indexable.
  // Drafts and private profiles are excluded by contract.
  const supabase = createAdminClient();
  const { data: profiles } = await supabase
    .from("signals")
    .select("handle, updated_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("hidden", false)
    .order("updated_at", { ascending: false })
    .limit(5000);

  for (const profile of profiles ?? []) {
    entries.push({
      url: `${SITE.url}/${profile.handle}`,
      lastModified: profile.updated_at ? new Date(profile.updated_at) : now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  // The Beacon Brief: every published article plus its category filter pages.
  const [{ data: articles }, { data: categories }] = await Promise.all([
    supabase
      .from("articles")
      .select("slug, last_updated, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(5000),
    supabase
      .from("news_categories")
      .select("slug")
      .eq("is_active", true),
  ]);

  for (const article of articles ?? []) {
    entries.push({
      url: `${SITE.url}/brief/${article.slug}`,
      lastModified: article.last_updated
        ? new Date(article.last_updated)
        : article.published_at
          ? new Date(article.published_at)
          : now,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  for (const category of categories ?? []) {
    entries.push({
      url: `${SITE.url}/brief/category/${category.slug}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.5,
    });
  }

  return entries;
}
