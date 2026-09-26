import { renderHeadlineCard } from "@/lib/og/headline-card";

export const runtime = "nodejs";

/**
 * GET /api/og/join
 *
 * 1200x630 OG image for the /join Discord invite landing page. Drawn by the
 * shared headline card (lib/og/headline-card.tsx), so it carries the same
 * logo, typeface and layout as every other fixed page.
 *
 * Static: no params, cached aggressively at the edge.
 */
export async function GET() {
  return renderHeadlineCard({
    eyebrow: "Discord invite",
    headlineTop: "Join the FF Beacon",
    headlineBottom: "Discord community",
    subhead:
      "Fantasy football tools, rankings talk, and trade reactions, built for everyone, including screen readers.",
    footerLeft: "ffbeacon.com/join",
    badge: "#fantasyfootball",
  });
}
