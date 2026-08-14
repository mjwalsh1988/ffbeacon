import {
  loadSitemapSection,
  renderUrlSet,
  xmlResponse,
} from "@/lib/sitemap/sections";

/** Beacon Brief articles that clear the quality floor. */
export const revalidate = 3600;

export async function GET() {
  return xmlResponse(renderUrlSet(await loadSitemapSection("articles")));
}
