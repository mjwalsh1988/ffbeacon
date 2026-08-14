import {
  loadSitemapSection,
  renderUrlSet,
  xmlResponse,
} from "@/lib/sitemap/sections";

/** Player profiles for everyone currently ranked. The biggest section by a distance. */
export const revalidate = 3600;

export async function GET() {
  return xmlResponse(renderUrlSet(await loadSitemapSection("players")));
}
