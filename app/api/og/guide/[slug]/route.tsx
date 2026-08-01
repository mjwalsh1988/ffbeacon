import { ImageResponse } from "next/og";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors (CLAUDE.md). No DPC gold/violet, no #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

type GuideCard = {
  eyebrow: string;
  /** Rendered in default ink. */
  headlineTop: string;
  /** Rendered in the beacon gradient. */
  headlineBottom: string;
  subhead: string;
  /** Short label pinned bottom-right, e.g. a term count. */
  badge: string;
};

/**
 * Social cards for published guides, keyed by the guide's URL slug.
 *
 * One entry per guide. Adding a guide means adding a row here; a slug with no row
 * returns 404 rather than rendering a blank card, so a typo in a page's metadata
 * shows up as a missing image instead of an empty branded rectangle shared to X.
 */
const GUIDE_CARDS: Record<string, GuideCard> = {
  "fantasy-football-terms": {
    eyebrow: "Fantasy Football Guide",
    headlineTop: "Fantasy football terms,",
    headlineBottom: "in plain English",
    subhead:
      "PPR, superflex, FAAB, ADP, target share, and every other word your league chat assumes you already know.",
    badge: "Glossary",
  },
};

/**
 * GET /api/og/guide/[slug]
 *
 * 1200x630 Open Graph and Twitter card for a published FF Beacon guide. Static
 * per slug, so it caches hard at the edge.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const card = GUIDE_CARDS[slug];
  if (!card) {
    return new Response("Not found", { status: 404 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE.width,
          height: SIZE.height,
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, ${BG_BASE} 0%, ${BG} 60%, ${BG_BASE} 100%)`,
          color: INK,
          padding: 64,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: -0.5,
              margin: 0,
            }}
          >
            FF Beacon
          </p>
        </div>

        <p
          style={{
            fontSize: 20,
            color: CYAN,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 4,
            fontWeight: 600,
          }}
        >
          {card.eyebrow}
        </p>

        <h1
          style={{
            fontSize: 76,
            fontWeight: 700,
            letterSpacing: -2,
            margin: "18px 0 6px 0",
            lineHeight: 1.04,
          }}
        >
          {card.headlineTop}
        </h1>
        <h1
          style={{
            fontSize: 76,
            fontWeight: 700,
            letterSpacing: -2,
            margin: 0,
            lineHeight: 1.04,
            background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
          }}
        >
          {card.headlineBottom}
        </h1>

        <p
          style={{
            fontSize: 26,
            color: INK_MUTED,
            margin: "28px 0 0 0",
            lineHeight: 1.4,
            maxWidth: 940,
          }}
        >
          {card.subhead}
        </p>

        <div
          style={{
            position: "absolute",
            bottom: 56,
            left: 64,
            right: 64,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${LINE}`,
            paddingTop: 20,
          }}
        >
          <p
            style={{
              fontSize: 22,
              color: INK_SUBTLE,
              margin: 0,
              letterSpacing: 1,
            }}
          >
            ffbeacon.com/guides/{slug}
          </p>
          <p
            style={{
              fontSize: 22,
              color: INK_SUBTLE,
              margin: 0,
              letterSpacing: 1,
            }}
          >
            {card.badge}
          </p>
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
