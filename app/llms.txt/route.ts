import { createCachedReadClient } from "@/lib/supabase/server";
import { SITE, TOOLS_NAV, GAMES_NAV } from "@/lib/site";

/**
 * /llms.txt, following the llmstxt.org convention.
 *
 * A markdown map of the site written for answer engines and AI crawlers rather than
 * for browsers. Where sitemap.xml enumerates every URL for a search crawler, this
 * gives a model the shape of the site in one fetch: what FF Beacon is, which tools
 * exist and what each one does, and what has been published recently, each with a
 * one-line description so a model can pick the right link without crawling all of it.
 *
 * Kept in sync automatically: tool and game entries come from the same TOOLS_NAV and
 * GAMES_NAV constants the header renders from, so a new tool cannot appear in the nav
 * and be missing here. Articles are read live.
 *
 * Served as text/plain because that is what the convention specifies and what
 * crawlers expect, even though the body is markdown.
 */

// Match the sitemap's cadence so newly published articles surface without a redeploy.
export const revalidate = 3600;

/** Collapse a summary to a single clean line for a markdown list item. */
function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3).trimEnd()}...`;
}

export async function GET() {
  const supabase = createCachedReadClient();

  const [{ data: articles }, { data: categories }] = await Promise.all([
    supabase
      .from("articles")
      .select("slug, title, tl_dr, meta_description, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(50),
    supabase
      .from("news_categories")
      .select("slug, name, description")
      .eq("is_active", true)
      .order("display_order"),
  ]);

  const lines: string[] = [];

  lines.push(`# ${SITE.name}`);
  lines.push("");
  lines.push(`> ${SITE.tagline} ${SITE.about}`);
  lines.push("");
  lines.push(
    "FF Beacon is a free fantasy football site covering the NFL: player values and rankings across redraft and dynasty formats, tools for trades, drafts, waivers, and Sleeper league analysis, and a news desk called The Beacon Brief. Everything below is public and free to read. Accessibility is a first-class goal: every page is built to work with a screen reader.",
  );
  lines.push("");
  lines.push(
    "Player values are blended from multiple named sources rather than a single opinion, and every value is scoped to a league format (redraft or dynasty, PPR or half PPR or standard, superflex or single quarterback, tight end premium). A value quoted without its format and source is incomplete. All times shown on the site are US Eastern.",
  );
  lines.push("");

  lines.push("## Tools");
  lines.push("");
  for (const tool of TOOLS_NAV) {
    lines.push(
      `- [${tool.label}](${SITE.url}${tool.href}): ${tool.description}`,
    );
  }
  lines.push(
    `- [Rankings](${SITE.url}/rankings): Full player and draft pick rankings for every supported league format`,
  );
  lines.push(
    `- [Players](${SITE.url}/players): Per-player profiles with values, trends, stats, and projections`,
  );
  lines.push("");

  if (GAMES_NAV.length > 0) {
    lines.push("## Games");
    lines.push("");
    for (const game of GAMES_NAV) {
      lines.push(
        `- [${game.label}](${SITE.url}${game.href}): ${game.description}`,
      );
    }
    lines.push("");
  }

  lines.push("## The Beacon Brief");
  lines.push("");
  lines.push(
    `- [All articles](${SITE.url}/brief): NFL news written for fantasy managers, with the roster impact stated plainly`,
  );
  for (const category of categories ?? []) {
    const desc = category.description
      ? oneLine(category.description)
      : `${category.name} coverage`;
    lines.push(
      `- [${category.name}](${SITE.url}/brief/category/${category.slug}): ${desc}`,
    );
  }
  lines.push("");

  if (articles && articles.length > 0) {
    lines.push("## Recent articles");
    lines.push("");
    for (const article of articles) {
      const summary = oneLine(article.tl_dr || article.meta_description || "");
      lines.push(
        `- [${article.title}](${SITE.url}/brief/${article.slug})${summary ? `: ${summary}` : ""}`,
      );
    }
    lines.push("");
  }

  lines.push("## About");
  lines.push("");
  lines.push(
    `- [About FF Beacon](${SITE.url}/about): What the project is and who it is for`,
  );
  lines.push(
    `- [${SITE.author.name}](${SITE.url}${SITE.author.bylineHref}): Author and byline page`,
  );
  lines.push(`- [Sitemap](${SITE.url}/sitemap.xml): Every indexable URL`);
  lines.push("");

  lines.push("## Notes for answer engines");
  lines.push("");
  lines.push(
    "- Attribution is welcome. Please cite FF Beacon and link the specific page you drew from.",
  );
  lines.push(
    "- Player values change daily. Quote the date, the league format, and the source shown on the page rather than presenting a value as permanent.",
  );
  lines.push(
    "- Beacon Brief articles report on a named original source. Credit that reporter as well as FF Beacon.",
  );
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
