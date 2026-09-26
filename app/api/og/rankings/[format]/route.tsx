import { ImageResponse } from "next/og";
import { createCachedReadClient } from "@/lib/supabase/server";
import { describeSource, getActiveFormats, getAvailableSources, resolveSourceForFormat } from "@/lib/source";
import { formatPhrase, type RankingFormat } from "@/lib/rankings-formats";
import { loadRemoteImages, sleeperPlayerImageUrl } from "@/lib/og/assets";
import { renderHeadlineCard } from "@/lib/og/headline-card";
import { fitText, OG_COLORS as C, OG_ROOT_STYLE, OgAccentBar, OgBrandMark, ogResponseOptions } from "@/lib/og/brand";

export const runtime = "nodejs";

const CACHE = "public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400";
const TOP = 5;
const TILE_GAP = 16;
const TILE_WIDTH = Math.floor((1072 - TILE_GAP * (TOP - 1)) / TOP);
const PHOTO = 112;

type Row = {
  overall_rank: number | null;
  position_rank: number | null;
  players: { full_name: string | null; position: string | null; team: string | null; external_ids: Record<string, unknown> | null } | null;
};

/**
 * GET /api/og/rankings/[format]
 *
 * The share card for one rankings board: the format's name and the top five
 * players on it. Every format used to share one generic rankings card, so a
 * link to Dynasty Superflex previewed the same as Redraft PPR.
 *
 * WHICH SOURCE. The format comes from the path; the source is the registry's
 * default for that format, through resolveSourceForFormat, exactly as a reader
 * with no preference sees the page. A share image is cached and seen by
 * strangers, so the sharer's own cookie cannot pick it. The source's
 * display_name is printed on the card, never its slug (CLAUDE.md, Source and
 * Format Sync, rule 5).
 *
 * A slug that names no active format, or a format with no ranked players,
 * gets the generic rankings card instead.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ format: string }> }) {
  const { format: slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return genericCard();

  const supabase = createCachedReadClient();
  const [formats, registry] = await Promise.all([getActiveFormats(supabase), getAvailableSources(supabase)]);
  const format = formats.find((f) => f.slug === slug) as unknown as (RankingFormat & { id: string }) | undefined;
  if (!format) return genericCard();

  const source = resolveSourceForFormat(registry, "rankings", slug, null).source;
  if (!source) return genericCard();

  const { data } = await supabase
    .from("rankings")
    .select("overall_rank, position_rank, players!inner(full_name, position, team, external_ids)")
    .eq("format_config_id", format.id)
    .eq("source", source)
    .is("week", null)
    .not("overall_rank", "is", null)
    .order("overall_rank", { ascending: true })
    .limit(TOP);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.players?.full_name && r.overall_rank !== null);
  if (rows.length === 0) return genericCard();

  const photos = await loadRemoteImages(
    rows.map((r) => {
      const ids = r.players?.external_ids ?? {};
      const sleeperId = typeof ids.sleeper === "string" ? ids.sleeper : null;
      return sleeperPlayerImageUrl(sleeperId, r.players?.position);
    }),
  );

  const title = fitText(`${formatPhrase(format)} Rankings`, { width: 1072, maxSize: 60, minSize: 38, maxLines: 1 });

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "52px 64px 40px 64px" }}>
        <OgAccentBar />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <OgBrandMark />
          <p style={{ fontSize: 20, fontWeight: 900, color: C.cyan, margin: 0, letterSpacing: 4, textTransform: "uppercase" }}>
            Player rankings
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", minHeight: 0 }}>
          <p style={{ fontSize: title.fontSize, fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.1, margin: 0 }}>{title.text}</p>
          <p style={{ fontSize: 23, color: C.inkMuted, margin: "10px 0 0 0" }}>
            Updated daily, with the seven-day move beside every player
          </p>

          <div style={{ display: "flex", gap: TILE_GAP, marginTop: 30 }}>
            {rows.map((r, i) => {
              const p = r.players!;
              const name = fitText(p.full_name ?? "", { width: TILE_WIDTH - 24, maxSize: 20, minSize: 15, maxLines: 2 });
              const photo = photos[i];
              return (
                <div
                  key={`${r.overall_rank}-${i}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: TILE_WIDTH,
                    padding: "16px 12px",
                    borderRadius: 16,
                    border: `1px solid ${i === 0 ? C.purple : C.line}`,
                    background: "rgba(15,15,26,0.8)",
                  }}
                >
                  <p style={{ fontSize: 22, fontWeight: 900, color: C.cyan, margin: 0 }}>#{r.overall_rank}</p>
                  {photo ? (
                    // Satori draws this into the PNG; there is no browser here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" width={PHOTO} height={PHOTO} style={{ width: PHOTO, height: PHOTO, borderRadius: 14, marginTop: 10, objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: PHOTO, height: PHOTO, borderRadius: 14, marginTop: 10, background: C.line }} />
                  )}
                  <p style={{ fontSize: name.fontSize, fontWeight: 900, margin: "10px 0 0 0", textAlign: "center", lineHeight: 1.15 }}>
                    {name.text}
                  </p>
                  <p style={{ fontSize: 16, color: C.inkMuted, margin: "4px 0 0 0" }}>
                    {[p.position && r.position_rank ? `${p.position}${r.position_rank}` : p.position, p.team ?? "FA"].filter(Boolean).join(", ")}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${C.line}`,
            paddingTop: 16,
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: 20, color: C.inkSubtle, margin: 0 }}>Values on {describeSource(registry, source)}</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: C.inkMuted, margin: 0 }}>ffbeacon.com/rankings/{slug}</p>
        </div>
      </div>
    ),
    ogResponseOptions(CACHE),
  );
}

function genericCard(): ImageResponse {
  return renderHeadlineCard(
    {
      eyebrow: "Player rankings",
      headlineTop: "Who is actually",
      headlineBottom: "worth what",
      subhead:
        "Every player ranked for your scoring, with the seven-day move beside each one so you can see who is climbing.",
      facts: ["Updated daily", "Redraft and dynasty", "Superflex"],
      footerLeft: "ffbeacon.com/rankings",
      badge: "Rankings",
    },
    CACHE,
  );
}
