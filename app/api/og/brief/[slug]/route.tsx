import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors per CLAUDE.md / plan.md. NEVER reference DPC's gold or
// violet on #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";

/**
 * GET /api/og/brief/[slug]
 *
 * 1200x630 social card for a Beacon Brief article. FF Beacon brand only: dark
 * gradient field, beacon accent bar, wordmark, category eyebrow, the headline,
 * and a one-line summary. Cached for an hour at the edge.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slug || slug.length > 96) {
    return new Response("Invalid slug", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: article } = await supabase
    .from("articles")
    .select("title, tl_dr, meta_description, article_type, status, category_id, news_categories(name)")
    .eq("slug", slug)
    .maybeSingle();

  if (!article || article.status !== "published") {
    return notFoundImage("Article not found");
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
          fontFamily: "sans-serif",
          padding: 64,
          position: "relative",
        }}
      >
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
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, margin: 0 }}>FF Beacon</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <p
            style={{
              fontSize: 22,
              color: CYAN,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: 4,
              fontWeight: 700,
            }}
          >
            {clip(eyebrow, 40)}
          </p>
          <h1
            style={{
              fontSize: title.length > 70 ? 52 : 64,
              fontWeight: 700,
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
      ...SIZE,
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
          fontFamily: "sans-serif",
        }}
      >
        <p style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>FF Beacon</p>
        <p style={{ fontSize: 24, color: INK_MUTED, marginTop: 16 }}>{reason}</p>
      </div>
    ),
    { ...SIZE, status: 404 },
  );
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "...";
}
