import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { parseEditionMetadata } from "@/lib/brief-desk/edition-metadata";
import { formatPeriod, periodChipLabel, periodLabel } from "@/lib/brief-desk/period";
import { OG_FONT_FAMILY, OG_FONTS } from "@/lib/og/assets";
import { fitText, OG_COLORS, OgBrandMark } from "@/lib/og/brand";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

/**
 * The three frames an edition card comes in (plan 11.5): 16x9 for social,
 * plus 4x3 and 1x1 because Google's Article guidance asks for all three and
 * Discover wants 1200 px wide. One layout, three sizes; the ratio only
 * changes how much room the title has.
 */
const RATIOS = {
  "16x9": { width: 1200, height: 630 },
  "4x3": { width: 1200, height: 900 },
  "1x1": { width: 1200, height: 1200 },
} as const;
type Ratio = keyof typeof RATIOS;

function parseRatio(request: Request): Ratio {
  const raw = new URL(request.url).searchParams.get("ratio");
  return raw === "4x3" || raw === "1x1" ? raw : "16x9";
}

// FF Beacon brand colors per CLAUDE.md / plan.md. NEVER reference DPC's gold or
// violet on #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#8A8A9C";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = OG_COLORS.line;

/**
 * GET /api/og/brief/[slug]
 *
 * 1200x630 social card for a Beacon Brief article. FF Beacon brand only: dark
 * gradient field, beacon accent bar, wordmark, category eyebrow, the headline,
 * and a one-line summary. Cached for an hour at the edge.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slug || slug.length > 96) {
    return new Response("Invalid slug", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: article } = await supabase
    .from("articles")
    .select("title, tl_dr, meta_description, article_type, status, category_id, season, week, metadata, news_categories(name)")
    .eq("slug", slug)
    .maybeSingle();

  if (!article || article.status !== "published") {
    return notFoundImage("Article not found");
  }

  // A Brief edition: the title, the period line, three headline figures.
  // Nothing from brief_editions is read here; the card is built from the
  // public articles row alone.
  if (article.article_type === "brief") {
    return editionImage({
      ratio: parseRatio(request),
      title: article.title,
      season: article.season !== null ? String(article.season) : null,
      week: article.week,
      metadata: article.metadata,
    });
  }

  const category =
    (article.news_categories as { name?: string } | { name?: string }[] | null) ?? null;
  const categoryName = Array.isArray(category) ? category[0]?.name : category?.name;
  const eyebrow = (categoryName ?? "The Beacon Brief").toUpperCase();
  const title = clip(article.title, 120);
  const summary = clip(article.tl_dr ?? article.meta_description ?? "", 180);

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
          fontFamily: OG_FONT_FAMILY,
          padding: 64,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -80,
            width: 520,
            height: 520,
            borderRadius: 9999,
            background: `radial-gradient(circle at center, ${PURPLE}22 0%, transparent 70%)`,
          }}
        />

        {/* Brand wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40 }}>
          <OgBrandMark size={36} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <p
            style={{
              fontSize: 22,
              color: CYAN,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: 4,
              fontWeight: 900,
            }}
          >
            {clip(eyebrow, 40)}
          </p>
          <h1
            style={{
              fontSize: title.length > 70 ? 52 : 64,
              fontWeight: 900,
              letterSpacing: -1.5,
              margin: "14px 0 0 0",
              lineHeight: 1.06,
            }}
          >
            {title}
          </h1>
          {summary ? (
            <p style={{ fontSize: 28, color: INK_MUTED, margin: "22px 0 0 0", lineHeight: 1.3 }}>
              {summary}
            </p>
          ) : null}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <p style={{ fontSize: 20, color: INK_SUBTLE, margin: 0 }}>The Beacon Brief</p>
          <p style={{ fontSize: 20, color: INK_SUBTLE, margin: 0 }}>ffbeacon.com</p>
        </div>
      </div>
    ),
    {
      ...SIZE, fonts: OG_FONTS,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function editionImage({
  ratio,
  title,
  season,
  week,
  metadata,
}: {
  ratio: Ratio;
  title: string;
  season: string | null;
  week: number | null;
  metadata: unknown;
}): Response {
  const size = RATIOS[ratio];
  const meta = parseEditionMetadata(metadata);
  const period = formatPeriod(meta.periodStart, meta.periodEnd);
  const chip = periodChipLabel(season, week, meta.phase);
  const tiles =
    meta.statTiles.length >= 3
      ? meta.statTiles.slice(0, 3)
      : [
          // The phase, not the week column alone: a pre-season period carries
          // week null and would otherwise be tiled as the off-season.
          { label: "Period", value: periodLabel(week, meta.phase) },
          { label: "Season", value: season ?? "n/a" },
          { label: "Formats", value: meta.formats.length ? String(meta.formats.length) : "2" },
        ];
  const tall = ratio !== "16x9";
  // Sized to its box and given its height up front: a three-line week title
  // at the old fixed 50px left no room above the tiles, so the byline sat on
  // their bottom border.
  const headline = fitText(title, { width: 1072, maxSize: tall ? 72 : 56, minSize: 34, maxLines: tall ? 4 : 3 });
  const headlineLineHeight = 1.08;
  // Tile labels wrap to two lines rather than being cut at 28 characters
  // ("Players ruled out or placed..." lost the half that said what it counted).
  const tileLabelWidth = Math.floor((1072 - 2 * 16) / 3) - 44;

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
          fontFamily: OG_FONT_FAMILY,
          padding: 64,
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)` }} />
        <div style={{ position: "absolute", top: -120, right: -80, width: 520, height: 520, borderRadius: 9999, background: `radial-gradient(circle at center, ${PURPLE}22 0%, transparent 70%)` }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: tall ? 48 : 32 }}>
          <OgBrandMark size={36} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <p style={{ fontSize: 22, color: CYAN, margin: 0, textTransform: "uppercase", letterSpacing: 4, fontWeight: 900 }}>
            THE BEACON BRIEF
          </p>
          <h1
            style={{
              fontSize: headline.fontSize,
              fontWeight: 900,
              letterSpacing: -1,
              margin: "14px 0 0 0",
              lineHeight: headlineLineHeight,
              height: Math.ceil(headline.lines * headline.fontSize * headlineLineHeight),
              flexShrink: 0,
            }}
          >
            {headline.text}
          </h1>
          <p style={{ fontSize: 24, color: INK_MUTED, margin: "16px 0 0 0", lineHeight: 1.3 }}>
            {period ? `${chip}. Covers ${period}.` : `${chip}.`}
          </p>

          <div style={{ display: "flex", gap: 16, marginTop: tall ? 48 : 24, flexShrink: 0 }}>
            {tiles.map((t, i) => (
              <div
                key={`${t.label}-${i}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: "14px 22px",
                  borderRadius: 14,
                  border: `1px solid ${i % 2 === 0 ? PURPLE : CYAN}55`,
                  background: `${BG}CC`,
                }}
              >
                <p style={{ fontSize: 15, color: INK_SUBTLE, margin: 0, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 900, lineHeight: 1.25 }}>
                  {fitText(t.label.toUpperCase(), { width: tileLabelWidth, maxSize: 15, minSize: 13, maxLines: 2 }).text}
                </p>
                <p style={{ fontSize: t.value.length > 14 ? 26 : 36, fontWeight: 900, margin: "8px 0 0 0", color: i % 2 === 0 ? PURPLE : CYAN, lineHeight: 1.1 }}>
                  {clip(t.value, 40)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${LINE}`,
            paddingTop: 14,
            marginTop: 20,
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: 20, color: INK_SUBTLE, margin: 0 }}>By Michael Walsh, founder of FF Beacon</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: INK_MUTED, margin: 0 }}>ffbeacon.com</p>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: OG_FONTS,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function notFoundImage(reason: string): Response {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          color: INK,
          fontFamily: OG_FONT_FAMILY,
        }}
      >
        <p style={{ fontSize: 48, fontWeight: 900, margin: 0 }}>FF Beacon</p>
        <p style={{ fontSize: 24, color: INK_MUTED, marginTop: 16 }}>{reason}</p>
      </div>
    ),
    { ...SIZE, fonts: OG_FONTS, status: 404, headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
  );
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "...";
}
