import {
  loadSitemapSection,
  renderUrlSet,
  xmlResponse,
} from "@/lib/sitemap/sections";

/** Public Signal profiles. */
export const revalidate = 3600;

export async function GET() {
  return xmlResponse(renderUrlSet(await loadSitemapSection("profiles")));
}
