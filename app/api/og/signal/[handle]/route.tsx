import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { ACCENTS, accentGradient } from "@/lib/signal";
import { signalMediaUrl } from "@/lib/signal-profile";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors per CLAUDE.md / plan.md. NEVER reference DPC's gold
// or #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";

/**
 * GET /api/og/signal/[handle]
 *
 * 1200x630 social card for a public Signal profile: avatar, display name,
 * @handle, and headline over the profile's accent gradient. FF Beacon brand
 * only. Only live profiles (published + public + not hidden) render a real
 * card; anything else returns a generic branded fallback so we never leak the
 * existence of a draft/private profile.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const normalized = handle.toLowerCase();
  if (!normalized || normalized.length > 30) {
    return fallbackImage();
  }

  const supabase = createAdminClient();
  const { data: signal } = await supabase
    .from("signals")
    .select(
      "handle, display_name, headline, accent, avatar_path, status, visibility, hidden",
    )
    .eq("handle", normalized)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("hidden", false)
    .maybeSingle();

  if (!signal) return fallbackImage();

  const accent = ACCENTS[signal.accent] ?? ACCENTS.beacon;
  const gradient = accentGradient(signal.accent);
  const avatar = signalMediaUrl(signal.avatar_path);

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
        {/* Accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 6,
            background: gradient,
          }}
        />

        {/* Brand wordmark */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 48 }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, margin: 0 }}>
            FF Beacon
          </p>
        </div>

        {/* Identity */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div
            style={{
              width: 180,
              height: 180,
              borderRadius: 90,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: gradient,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                width={180}
                height={180}
                style={{ width: 180, height: 180, objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 80, fontWeight: 700, color: BG_BASE }}>
                {signal.display_name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <h1
              style={{
                fontSize: 64,
                fontWeight: 700,
                letterSpacing: -2,
                margin: 0,
                lineHeight: 1.05,
              }}
            >
              {clip(signal.display_name, 26)}
            </h1>
            <p
              style={{
                fontSize: 32,
                color: accent.to,
                margin: "8px 0 0 0",
                fontFamily: "monospace",
              }}
            >
              @{signal.handle}
            </p>
          </div>
        </div>

        {signal.headline && (
          <p
            style={{
              fontSize: 30,
              color: INK_MUTED,
              margin: "40px 0 0 0",
              lineHeight: 1.3,
              maxWidth: 1000,
            }}
          >
            {clip(signal.headline, 120)}
          </p>
        )}

        {/* Footer URL */}
        <p
          style={{
            position: "absolute",
            bottom: 32,
            right: 64,
            fontSize: 20,
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
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function fallbackImage(): Response {
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
          background: `linear-gradient(180deg, ${BG} 0%, ${BG_BASE} 100%)`,
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            marginBottom: 20,
            background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
          }}
        />
        <p style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>FF Beacon</p>
        <p style={{ fontSize: 24, color: INK_MUTED, marginTop: 12 }}>
          Your signal through the fantasy noise.
        </p>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "...";
}
