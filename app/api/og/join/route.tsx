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

/**
 * GET /api/og/join
 *
 * 1200x630 OG image for the /join Discord invite landing page. Renders the
 * FF Beacon brand mark, "Join the FF Beacon Discord" headline, and the
 * short URL so the preview reads clearly when shared on social platforms.
 *
 * Static-ish: no params, cached aggressively at the edge.
 */
export async function GET() {
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
            marginBottom: 48,
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

        {/* Eyebrow */}
        <p
          style={{
            fontSize: 22,
            color: CYAN,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 4,
            fontWeight: 600,
          }}
        >
          Discord Invite
        </p>

        {/* Headline */}
        <h1
          style={{
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: -2.5,
            margin: "20px 0 8px 0",
            lineHeight: 1.02,
          }}
        >
          Join the FF Beacon
        </h1>
        <h1
          style={{
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: -2.5,
            margin: 0,
            lineHeight: 1.02,
            background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
          }}
        >
          Discord community
        </h1>

        {/* Subhead */}
        <p
          style={{
            fontSize: 28,
            color: INK_MUTED,
            margin: "32px 0 0 0",
            lineHeight: 1.4,
            maxWidth: 980,
          }}
        >
          Fantasy football tools, rankings talk, and trade reactions, built
          for everyone, including screen readers.
        </p>

        {/* Footer URL */}
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
            ffbeacon.com/join
          </p>
          <p
            style={{
              fontSize: 22,
              color: INK_SUBTLE,
              margin: 0,
              letterSpacing: 1,
            }}
          >
            #fantasyfootball
          </p>
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
