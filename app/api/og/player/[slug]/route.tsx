import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors per CLAUDE.md / plan.md. NEVER reference DPC's
// gold or violet on #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

const PLAYER_IMAGE_BASE = "https://sleepercdn.com/content/nfl/players";

function positionAccent(position: string): string {
  const pos = (position ?? "").toUpperCase();
  if (pos === "QB") return "#F472B6";
  if (pos === "RB") return "#10B981";
  if (pos === "WR") return CYAN;
  if (pos === "TE") return "#F59E0B";
  return "#A8A8B8";
}

/**
 * GET /api/og/player/[slug]
 *
 * 1200x630 social card for a player profile. FF Beacon brand only: dark
 * gradient field, beacon accent bar, wordmark, the player's Sleeper headshot
 * (falling back to a position-accent monogram), name, and position/team line.
 * Cached for an hour at the edge.
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
  const { data: player } = await supabase
    .from("players")
    .select(
      "first_name, last_name, position, team, external_ids, injury_status:metadata->sleeper->>injury_status",
    )
    .eq("slug", slug)
    .maybeSingle()
    .overrideTypes<{
      first_name: string | null;
      last_name: string | null;
      position: string | null;
      team: string | null;
      external_ids: unknown;
      injury_status: string | null;
    }>();

  if (!player) {
    return notFoundImage(`Player not found`);
  }

  const name = `${player.first_name} ${player.last_name}`;
  const position = player.position ?? "";
  const accent = positionAccent(position);
  const sleeperId = (player.external_ids as { sleeper?: string } | null)?.sleeper ?? null;
  const headshot = sleeperId ? `${PLAYER_IMAGE_BASE}/${sleeperId}.jpg` : null;
  // The injury DESIGNATION, not the roster status.
  //
  // This used to read players.status, which is Sleeper's roster state, so a
  // player on injured reserve produced "WR, SF, INACTIVE". "Inactive" is roster
  // jargon nobody uses in fantasy and it buries the one fact a reader wants,
  // while the term they expect (IR) was sitting unused in the same row. A
  // healthy player has no designation and the card stays a clean "WR, SF".
  const injury =
    typeof player.injury_status === "string" && player.injury_status.trim()
      ? player.injury_status.trim().toUpperCase()
      : null;
  const metaLine = [position, player.team, injury].filter(Boolean).join(",  ");

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
        {/* Beacon gradient accent bar */}
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
        {/* Position-accent radial glow */}
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -80,
            width: 520,
            height: 520,
            borderRadius: 9999,
            background: `radial-gradient(circle at center, ${accent}22 0%, transparent 70%)`,
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

        <div style={{ display: "flex", alignItems: "center", gap: 40, flex: 1 }}>
          {/* Headshot or monogram */}
          {headshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={headshot}
              alt=""
              width={260}
              height={260}
              style={{
                width: 260,
                height: 260,
                borderRadius: 24,
                objectFit: "cover",
                border: `3px solid ${accent}88`,
                background: BG_BASE,
              }}
            />
          ) : (
            <div
              style={{
                width: 260,
                height: 260,
                borderRadius: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 96,
                fontWeight: 800,
                color: accent,
                border: `3px solid ${accent}55`,
                background: `${accent}1A`,
              }}
            >
              {(position || "?").slice(0, 3)}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: 22,
                color: accent,
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: 4,
                fontWeight: 700,
              }}
            >
              Player Profile
            </p>
            <h1
              style={{
                fontSize: name.length > 18 ? 64 : 76,
                fontWeight: 700,
                letterSpacing: -2,
                margin: "12px 0 14px 0",
                lineHeight: 1.02,
              }}
            >
              {clip(name, 28)}
            </h1>
            <p style={{ fontSize: 30, color: INK_MUTED, margin: 0, fontWeight: 600 }}>{metaLine}</p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <p style={{ fontSize: 20, color: INK_SUBTLE, margin: 0 }}>
            Fantasy outlook, stats and value trends
          </p>
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
  return s.slice(0, n - 1) + "...";
}
