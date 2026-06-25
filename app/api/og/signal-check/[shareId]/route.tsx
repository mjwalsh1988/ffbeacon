import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import type { PublicSharePayload, SideKey } from "@/lib/signal-check/types";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

/**
 * GET /api/og/signal-check/[shareId]
 *
 * 1200x630 share card for a frozen Signal Check result. Reads ONLY the
 * public_payload of a PUBLIC analysis (server-side via the service role) and
 * renders the safe summary. Never touches raw values, the rule trace, or any
 * Sleeper import context. FF Beacon brand only: no DPC gold, no #0c0c18.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  if (!shareId || shareId.length > 64) {
    return new Response("Invalid id", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("signal_check_analyses")
    .select("public_payload, is_public")
    .eq("public_share_id", shareId)
    .maybeSingle();

  if (!row || !row.is_public || !row.public_payload) {
    return notFoundImage("Verdict not found");
  }

  const payload = row.public_payload as unknown as PublicSharePayload;
  const sideLabel = (s: { side: SideKey; teamLabel: string | null }) =>
    s.teamLabel || `Side ${s.side.toUpperCase()}`;

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
          padding: 48,
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

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
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
          <p style={{ fontSize: 16, color: INK_MUTED, margin: 0 }}>{clip(payload.formatDisplay, 36)}</p>
        </div>

        <p
          style={{
            fontSize: 16,
            color: PURPLE,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 3,
            fontWeight: 700,
          }}
        >
          {clip(payload.featureLabel, 28)}
        </p>
        <h1 style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1, margin: "8px 0 16px 0" }}>
          {clip(payload.verdictLabel, 70)}
        </h1>

        {/* Shape + confidence chips */}
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {payload.tradeShapeLabel ? <Chip text={payload.tradeShapeLabel} /> : null}
          {payload.confidenceLabel ? <Chip text={payload.confidenceLabel} /> : null}
        </div>

        <div style={{ display: "flex", gap: 24, flex: 1 }}>
          {payload.sides.slice(0, 2).map((side) => {
            const isWinner = payload.winnerSide === side.side;
            return (
              <div
                key={side.side}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  padding: 24,
                  borderRadius: 16,
                  border: `2px solid ${isWinner ? CYAN : LINE}`,
                  background: isWinner ? "rgba(34, 211, 238, 0.08)" : "rgba(255, 255, 255, 0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <p style={{ fontSize: 24, fontWeight: 700, color: INK, margin: 0 }}>
                    {clip(sideLabel(side), 22)}
                  </p>
                  {side.total !== null ? (
                    <p style={{ fontSize: 26, fontWeight: 700, color: isWinner ? CYAN : INK, margin: 0, fontFamily: "monospace" }}>
                      {Math.round(side.total).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
                  {side.assets.slice(0, 5).map((a, i) => (
                    <p key={i} style={{ fontSize: 18, color: INK, margin: 0 }}>
                      {clip(a.name, 28)}
                      {a.detail ? <span style={{ color: INK_SUBTLE, marginLeft: 6 }}>{a.detail}</span> : null}
                    </p>
                  ))}
                  {side.assets.length > 5 ? (
                    <p style={{ fontSize: 14, color: INK_SUBTLE, margin: 0 }}>+{side.assets.length - 5} more</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {payload.valueSnapshotLabel ? (
          <p style={{ fontSize: 14, color: INK_SUBTLE, marginTop: 16 }}>{clip(payload.valueSnapshotLabel, 60)}</p>
        ) : null}
        <p style={{ position: "absolute", bottom: 24, right: 48, fontSize: 16, color: INK_SUBTLE, margin: 0 }}>
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

function Chip({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: 16,
        color: INK_MUTED,
        border: `1px solid ${LINE}`,
        borderRadius: 999,
        padding: "6px 14px",
      }}
    >
      {clip(text, 28)}
    </div>
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
