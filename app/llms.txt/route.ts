import { buildLlmsTxt } from "@/lib/llms/llms-txt";
import { loadLlmsData } from "@/lib/llms/data";

/**
 * /llms.txt, following the llms.txt v2 shape (llmstxt.org).
 *
 * A curated markdown map of the site written for answer engines and agents
 * rather than for browsers. sitemap.xml enumerates every URL for a crawler that
 * wants all of them; this gives a model the shape of the site in one fetch, so
 * it can pick the two or three pages it actually needs.
 *
 * The document itself is built in lib/llms/llms-txt.ts from registries the rest
 * of the site already reads, so a tool, guide, format, value source or Brief
 * category cannot exist in the product and be missing here.
 *
 * Served as text/plain; charset=utf-8, which is what the convention specifies
 * and what crawlers expect, even though the body is markdown.
 */

// Matches the sitemap's cadence, so a new article count or a new format shows
// up without a redeploy while the response stays a cache hit for an hour.
export const revalidate = 3600;

export async function GET() {
  // 0 articles: /llms.txt is a map and does not enumerate the news desk. The
  // published count still comes back, which is the one thing the map says
  // about the Brief's size.
  const data = await loadLlmsData(0);

  return new Response(buildLlmsTxt(data), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "X-Robots-Tag": "all",
    },
  });
}
