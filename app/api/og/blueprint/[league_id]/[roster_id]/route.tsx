import { loadBlueprintImage, renderPreview } from "./card";

export const runtime = "nodejs";

/**
 * GET /api/og/blueprint/[league_id]/[roster_id]?source=slug
 *
 * The Team Blueprint link preview, 1200 x 630 (plan 11.2). Reads the stored
 * view only; a roster nobody has built yet gets the branded placeholder that
 * says to open the page first. Any query other than ?source= is a 308 to the
 * canonical URL, so junk parameters cannot fill the edge cache.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string; roster_id: string }> },
) {
  const { league_id, roster_id } = await params;
  const load = await loadBlueprintImage(request, league_id, roster_id);
  if (load.kind === "response") return load.response;
  return renderPreview(load.card);
}
