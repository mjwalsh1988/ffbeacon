import { loadBlueprintImage, renderPortrait } from "../card";

export const runtime = "nodejs";

/**
 * GET /api/og/blueprint/[league_id]/[roster_id]/share?source=slug
 *
 * The Team Blueprint portrait share card, 1080 wide and as tall as its
 * sections (plan 11.3). The page's Copy image button fetches this one. Reads
 * the stored view only, with the same validation, canonical redirect and
 * placeholders as the preview.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string; roster_id: string }> },
) {
  const { league_id, roster_id } = await params;
  const load = await loadBlueprintImage(request, league_id, roster_id);
  if (load.kind === "response") return load.response;
  return renderPortrait(load.card);
}
