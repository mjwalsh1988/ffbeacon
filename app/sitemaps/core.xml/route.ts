import {
  loadSitemapSection,
  renderUrlSet,
  xmlResponse,
} from "@/lib/sitemap/sections";

/** Home, rankings, tools, guides, and the Brief's index and filter pages. */
export const revalidate = 3600;

export async function GET() {
  return xmlResponse(renderUrlSet(await loadSitemapSection("core")));
}
