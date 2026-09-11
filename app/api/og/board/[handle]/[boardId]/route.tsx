import { ImageResponse } from "next/og";
import { normalizeHandle, validateHandleFormat } from "@/lib/signal";
import { isReservedRouteSegment } from "@/lib/signal/reserved-routes";
import { loadPublicBoard } from "@/lib/signal-profile";
import { scopeLabel } from "@/lib/ranking-boards";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors per CLAUDE.md / plan.md. NEVER reference DPC's gold
// or violet on #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

/**
 * GET /api/og/board/[handle]/[boardId]
 *
 * 1200x630 social card for a public Signal ranking board: the scope label,
 * board name, owner, player count, and the first few ranked names. FF Beacon
 * brand only, mirroring app/api/og/player.
 *
 * Gated the same way the public board page is: lib/signal-profile.ts
 * loadPublicBoard requires the board's own profile_visible flag AND a live
 * owner Signal (published, public, not hidden), and this route additionally
 * checks the owner's handle matches the URL, exactly like buildBoardMetadata
 * and BoardView do. A private, hidden, or missing board or profile, or a
 * handle that does not own the board, all fall through to the same generic
 * branded fallback card as a request for a board that never existed, so
 * nothing about a gated board's contents, or even its existence, is
 * distinguishable from a 404 by looking at the image.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string; boardId: string }> },
) {
  const { handle: rawHandle, boardId } = await params;
  const handle = normalizeHandle(rawHandle ?? "");

  if (
    !boardId ||
    boardId.length > 100 ||
    validateHandleFormat(handle) !== null ||
    isReservedRouteSegment(handle)
  ) {
    return fallbackImage();
  }

  const view = await loadPublicBoard(boardId);
  if (!view || view.owner.handle.toLowerCase() !== handle) {
    return fallbackImage();
  }

  const { board, owner, players } = view;
  const preview = players.slice(0, 5);

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

        {/* Brand wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
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
          {scopeLabel(board.scope)} board
        </p>
        <h1
          style={{
            fontSize: 60,
            fontWeight: 700,
            letterSpacing: -2,
            margin: "14px 0 10px 0",
            lineHeight: 1.05,
          }}
        >
          {clip(board.name, 40)}
        </h1>
        <p style={{ fontSize: 28, color: INK_MUTED, margin: 0 }}>
          {players.length} player{players.length === 1 ? "" : "s"} ranked by{" "}
          {clip(owner.displayName, 28)}
        </p>

        {preview.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 40 }}>
            {preview.map((p) => (
              <div
                key={p.playerId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: `1px solid ${LINE}`,
                  background: "rgba(168, 85, 247, 0.05)",
                }}
              >
                <p
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: CYAN,
                    margin: 0,
                    minWidth: 40,
                  }}
                >
                  {p.rank}
                </p>
                <p style={{ fontSize: 24, fontWeight: 600, color: INK, margin: 0, flex: 1 }}>
                  {clip(p.name, 26)}
                </p>
                <p style={{ fontSize: 20, color: INK_SUBTLE, margin: 0 }}>
                  {p.position}
                  {p.team ? `, ${p.team}` : ""}
                </p>
              </div>
            ))}
          </div>
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

/**
 * The single fallback for every ungated case: bad params, no board, no owner
 * Signal, or a board/owner combination that is not currently public. Deliberately
 * one shared card with no status-code or content difference between "does not
 * exist" and "exists but is private", so neither can be distinguished from the
 * response alone.
 */
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
