import { SITE } from "@/lib/site";
import {
  hasPublishedEditions,
  SITEMAP_SECTIONS,
  renderSitemapIndex,
  sectionLastModified,
  sectionPath,
  xmlResponse,
} from "@/lib/sitemap/sections";

/**
 * /sitemap.xml, the index.
 *
 * This URL is what robots.txt advertises and what is submitted in Search Console, and
 * it stays that URL. What changed is what it contains: it used to be one urlset of
 * about a thousand mixed URLs, and it is now an index pointing at four files split by
 * kind of page. Search Console reports coverage per file, which is the whole reason
 * for the split (see lib/sitemap/sections.ts).
 *
 * Written as a route handler rather than through Next's `sitemap.ts` convention
 * because that convention emits a urlset and has no way to emit an index. Its
 * `generateSitemaps` helper produces numbered children at /sitemap/[id].xml but does
 * not generate an index file to tie them together, so /sitemap.xml would have stopped
 * resolving. Keeping the advertised URL working outranks using the convention.
 */

export const revalidate = 3600;

export async function GET() {
  // The articles file carries only Brief editions (lib/sitemap/sections.ts).
  // Until one is published it is an empty urlset, and the sitemap schema wants
  // at least one url in a file (Search Console reports an empty one as an
  // error), so the index points at it only once an edition exists. The file
  // itself keeps resolving either way, because its URL is submitted in Search
  // Console and a 404 there would be a different error.
  const editions = await hasPublishedEditions();
  const sections = SITEMAP_SECTIONS.filter(
    (section) => section !== "articles" || editions,
  );
  const entries = await Promise.all(
    sections.map(async (section) => ({
      loc: `${SITE.url}${sectionPath(section)}`,
      lastModified: await sectionLastModified(section),
    })),
  );
  return xmlResponse(renderSitemapIndex(entries));
}
