import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { buildChartGeometry, WAR_CHART_MAX_RANK } from "@/lib/positional-war/chart-geometry";
import {
  BRAND,
  SIZE,
  CHART,
  isValidLeagueId,
  toPositionCurves,
  buildLegendRows,
  buildWarSvg,
  svgToDataUri,
  buildHeadline,
  clip,
  notReadyImage,
  notFoundImage,
} from "./card";

export const runtime = "nodejs";

/**
 * GET /api/og/war/[league_id]
 *
 * 1200x630 OG image for Positional WAR: which positions are scarce in this
 * league, and the shape of the curve that answers it.
 *
 * DRAWING A LINE CHART INSIDE SATORI. next/og renders through Satori, which
 * supports flexbox and a subset of CSS but does not reliably render
 * arbitrary SVG <path> children across versions. Betting the image on that
 * would be a silent regression waiting for a dependency bump. The safe
 * construction, and the one built here: build the SVG document as a string,
 * server side, using buildChartGeometry() (the SAME geometry the on-page
 * chart at components/league-war/positional-war-chart.tsx uses), base64 it,
 * and render it as <img src="data:image/svg+xml;base64,..."> at 1040x380.
 * Satori handles an <img> with a data URI natively. Everything else on the
 * card (wordmark, meta line, legend, headline, footer) is plain flexbox
 * divs, matching the other three OG routes. See card.tsx for the SVG
 * builder and every other pure helper below; a route.ts/route.tsx file can
 * only export the known route config symbols (GET, runtime, etc.), so the
 * testable pieces live in that sibling module instead.
 *
 * THE GEOMETRY IS NEVER RECOMPUTED HERE. Every x, y, and path comes straight
 * out of buildChartGeometry()'s output (E5-2). That is what makes it
 * impossible for this card to disagree with the on-page chart about the same
 * league, the same discipline the Schedules page follows when it reads
 * projections from a cache instead of recomputing them.
 *
 * PARAMETERS. The route accepts only the league id. The three existing OG
 * routes accept ?source=; this one deliberately ignores it (never reads
 * request.url at all), because Positional WAR does not vary by value source
 * or format (CLAUDE.md, "Positional WAR"). Two requests differing only in
 * ?source= are byte-identical (E5-4). The axis is always "depth": a shared
 * card has no reader who chose the other mode.
 *
 * Cached for 1 hour at the CDN edge via cache-control headers, matching the
 * other three OG routes exactly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;

  if (!isValidLeagueId(sleeperLeagueId)) {
    return new Response("Invalid league id", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, total_rosters")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) {
    return notFoundImage(`League ${sleeperLeagueId} not found`);
  }

  const { data: cacheRows } = await supabase
    .from("league_positional_war_cache")
    .select("position, structural_demand, war_rank_1, war_at_demand, cliff_rank, curve")
    .eq("league_id", league.id)
    .eq("season", league.season);

  const curves = toPositionCurves(cacheRows ?? []);
  // `every` rather than `length === 0`, matching the panel and the rail: rows
  // that exist but hold no plotted players draw an empty axis frame with a
  // legend of nothing, which is a worse answer for a shared card than saying
  // the curve is not ready. An empty array satisfies `every`, so the original
  // no-rows case is unchanged.
  if (curves.every((c) => c.curve.length === 0)) {
    return notReadyImage(league.name, league.season);
  }

  const geometry = buildChartGeometry({
    curves,
    // The page's own default. A shared card that drew a different axis from
    // the page it links to would be a different chart of the same league.
    mode: "rank",
    // The same cap the dashboard uses. This is the "any shareable image" half
    // of applying the 36-rank limit consistently: without it the card would
    // draw seventy-odd ranks of flat tail the page does not show.
    maxRank: WAR_CHART_MAX_RANK,
    width: CHART.width,
    height: CHART.height,
    padding: { t: 16, r: 16, b: 16, l: 16 },
  });

  const svg = buildWarSvg(curves, geometry, CHART.width, CHART.height);
  const chartDataUri = svgToDataUri(svg);
  const legendRows = buildLegendRows(curves);
  const headline = buildHeadline(curves) ?? "Positional WAR is still calculating.";
  const { BG, BG_BASE, INK, INK_MUTED, INK_SUBTLE, PURPLE, CYAN } = BRAND;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(180deg, ${BG} 0%, ${BG_BASE} 100%)`,
          color: INK,
          fontFamily: "sans-serif",
          padding: "40px 48px 28px 48px",
          position: "relative",
        }}
      >
        {/* Beacon gradient accent */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 6,
            background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
          }}
        />

        {/* Brand wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>FF Beacon</p>
        </div>

        {/* League meta line, matching the comma separator the other OG routes use */}
        <p style={{ fontSize: 17, color: INK_MUTED, margin: "10px 0 0 0" }}>
          {clip(league.name, 50)}, {league.season}
          {league.total_rosters != null ? `, ${league.total_rosters} teams` : ""}
        </p>

        {/* Card title */}
        <h1
          style={{
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: -0.5,
            margin: "8px 0 0 0",
          }}
        >
          Positional WAR
        </h1>

        {/* The curve */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chartDataUri} width={CHART.width} height={CHART.height} alt="" />
        </div>

        {/* Legend: one chip per plotted position, wraps so a three-position
            league (no K, no DEF, an IDP league) reflows cleanly. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 20,
            marginTop: 8,
          }}
        >
          {legendRows.map((row) => (
            <div key={row.position} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: row.color,
                }}
              />
              <p style={{ fontSize: 18, fontWeight: 600, color: INK, margin: 0, fontFamily: "monospace" }}>
                {row.label}
              </p>
            </div>
          ))}
        </div>

        {/* Deterministic headline, matching the rail summary's template */}
        <p style={{ fontSize: 20, color: INK, margin: "14px 0 0 0", fontWeight: 600 }}>{headline}</p>

        {/* Footer URL */}
        <p
          style={{
            position: "absolute",
            bottom: 24,
            right: 48,
            fontSize: 18,
            color: INK_SUBTLE,
            margin: 0,
          }}
        >
          ffbeacon.com
        </p>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
