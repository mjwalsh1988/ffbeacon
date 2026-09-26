import { ImageResponse } from "next/og";
import { normalizeHandle, validateHandleFormat } from "@/lib/signal";
import { isReservedRouteSegment } from "@/lib/signal/reserved-routes";
import { loadPublicBoard, type PublicBoardView } from "@/lib/signal-profile";
import { readSleeperId, scopeLabel, tierForRank, tierLabel } from "@/lib/ranking-boards";
import { loadBeaconComparison } from "@/lib/ranking-boards/beacon-comparison";
import { agreementShare, readerRanksFor, rankGap } from "@/lib/ranking-boards/compare";
import { getActiveFormats } from "@/lib/source";
import { DEFAULT_FORMAT_SLUG } from "@/lib/site";
import { createCachedReadClient } from "@/lib/supabase/server";
import {
  loadRemoteImages,
  sleeperPlayerImageUrl,
  OG_FONTS,
  OG_FONT_FAMILY,
  OG_LOGO_DATA_URI,
  OG_WORDMARK,
} from "@/lib/og/assets";
import { clip, displayName } from "@/lib/og/display-name";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

// FF Beacon brand colors per CLAUDE.md, the values every other OG route uses
// (lib/og/assets.ts carries the font, mark and photo helpers, not a palette).
// NEVER reference DPC's gold or violet on #0c0c18. The quietest visible text
// here is INK_MUTED, lighter than the #8A8A9C floor.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

/** Same hues the position pills use on the site (tailwind.config.ts `position.*`). */
const POSITION_COLOR: Record<string, string> = {
  QB: "#F87171",
  RB: "#34D399",
  WR: "#60A5FA",
  TE: "#FBBF24",
  K: "#F472B6",
  DEF: "#94A3B8",
  DL: "#A3E635",
  LB: "#E879F9",
  DB: "#818CF8",
};

const PREVIEW_COUNT = 5;

/**
 * GET /api/og/board/[handle]/[boardId]
 *
 * 1200x630 social card for a public Signal ranking board: the scope label and
 * format, the board name, the owner and player count, the top five players
 * (photo, position, team and tier when the board shows tiers), and how closely
 * the board agrees with FF Beacon's own rankings. FF Beacon brand only, on the
 * shared lib/og/assets.ts font, mark and photo loader.
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
 *
 * The agreement figure is computed exactly as components/signal/board-view.tsx
 * computes it (board format, site default format standing in for a board with
 * none, restricted to the board's own players), so the card and the page it
 * links to cannot disagree. It is omitted, never shown as zero, when nothing on
 * the board could be compared. A failed comparison or photo lookup drops that
 * piece and nothing else.
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
  const preview = players.slice(0, PREVIEW_COUNT);

  const readClient = createCachedReadClient();
  const [extras, sleeperIds] = await Promise.all([
    loadFormatAndAgreement(readClient, view),
    loadSleeperIds(
      readClient,
      preview.map((p) => p.playerId),
    ),
  ]);
  const photos = await loadRemoteImages(
    preview.map((p) => sleeperPlayerImageUrl(sleeperIds.get(p.playerId), p.position)),
  );

  const eyebrow = [
    `${scopeLabel(board.scope, board.includesDefenders)} board`,
    extras.formatDisplay,
  ]
    .filter(Boolean)
    .join(", ");
  const count = `${players.length} player${players.length === 1 ? "" : "s"}`;

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
          fontWeight: 500,
          padding: "34px 56px 26px 56px",
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

        {/* Wordmark top left, agreement with FF Beacon top right. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={OG_LOGO_DATA_URI}
              alt=""
              width={28}
              height={28}
              style={{ width: 28, height: 28 }}
            />
            <p style={{ fontSize: 21, fontWeight: 900, margin: 0, letterSpacing: -0.5 }}>
              {OG_WORDMARK}
            </p>
          </div>

          {extras.agreementPercent != null ? (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "8px 16px",
                borderRadius: 999,
                border: `1px solid ${CYAN}66`,
                background: `${CYAN}14`,
              }}
            >
              <p style={{ fontSize: 26, fontWeight: 900, margin: 0, color: CYAN }}>
                {`${extras.agreementPercent}%`}
              </p>
              <p style={{ fontSize: 18, margin: 0, color: INK_MUTED }}>
                within 3 spots of FF Beacon
              </p>
            </div>
          ) : null}
        </div>

        <p
          style={{
            fontSize: 18,
            color: CYAN,
            margin: "22px 0 0 0",
            textTransform: "uppercase",
            letterSpacing: 3,
            fontWeight: 900,
          }}
        >
          {clip(eyebrow, 60)}
        </p>
        <h1
          style={{
            fontSize: 50,
            fontWeight: 900,
            letterSpacing: -1.5,
            margin: "8px 0 6px 0",
            lineHeight: 1.05,
          }}
        >
          {clip(board.name, 42)}
        </h1>
        <p style={{ fontSize: 22, color: INK_MUTED, margin: 0 }}>
          {`${count} ranked by ${clip(owner.displayName, 28)}`}
        </p>

        {preview.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
            {preview.map((p, i) => (
              <PlayerRow
                key={p.playerId}
                rank={p.rank}
                name={p.name}
                position={p.position}
                team={p.team}
                photo={photos[i] ?? null}
                tier={
                  board.tiersEnabled
                    ? clip(tierLabel(board.tierLabels, tierForRank(board.tierBreaks, p.rank)), 18)
                    : null
                }
              />
            ))}
          </div>
        ) : null}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "auto",
          }}
        >
          <p style={{ fontSize: 17, fontWeight: 900, color: INK_MUTED, margin: 0 }}>
            ffbeacon.com
          </p>
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: OG_FONTS,
      headers: { "cache-control": CACHE_CONTROL },
    },
  );
}

function PlayerRow({
  rank,
  name,
  position,
  team,
  photo,
  tier,
}: {
  rank: number;
  name: string;
  position: string;
  team: string | null;
  photo: string | null;
  tier: string | null;
}) {
  const posColor = POSITION_COLOR[position] ?? INK_MUTED;
  const meta = [position, team].filter(Boolean).join(", ");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 54,
        padding: "0 16px",
        borderRadius: 12,
        border: `1px solid ${LINE}`,
        background: "rgba(168, 85, 247, 0.05)",
      }}
    >
      <p
        style={{
          fontSize: 24,
          fontWeight: 900,
          color: CYAN,
          margin: 0,
          width: 44,
        }}
      >
        {rank}
      </p>

      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          width={40}
          height={40}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            objectFit: "cover",
            border: `2px solid ${posColor}88`,
            background: BG_BASE,
          }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 900,
            color: posColor,
            border: `2px solid ${posColor}55`,
            background: `${posColor}1A`,
          }}
        >
          {position}
        </div>
      )}

      <p style={{ fontSize: 23, fontWeight: 900, color: INK, margin: 0, flex: 1 }}>
        {displayName(name, 30)}
      </p>
      {meta ? <p style={{ fontSize: 18, color: INK_MUTED, margin: 0 }}>{meta}</p> : null}
      {tier ? (
        <p
          style={{
            fontSize: 14,
            fontWeight: 900,
            margin: 0,
            padding: "3px 10px",
            borderRadius: 999,
            color: PURPLE,
            background: `${PURPLE}1F`,
            border: `1px solid ${PURPLE}66`,
          }}
        >
          {tier}
        </p>
      ) : null}
    </div>
  );
}

type ReadClient = ReturnType<typeof createCachedReadClient>;

/**
 * The board's format display name and its agreement with FF Beacon, computed
 * the same way the public board page computes them. Never throws: a failure
 * drops both, and the card renders without them.
 */
async function loadFormatAndAgreement(
  readClient: ReadClient,
  view: PublicBoardView,
): Promise<{ formatDisplay: string | null; agreementPercent: number | null }> {
  const { board, players } = view;
  try {
    const formats = await getActiveFormats(readClient);
    const boardFormat = formats.find((f) => f.id === board.formatConfigId) ?? null;
    const formatDisplay = boardFormat?.display_name ?? null;
    if (players.length === 0) return { formatDisplay, agreementPercent: null };

    try {
      const beacon = await loadBeaconComparison(readClient, {
        scope: board.scope,
        boardFormatSlug: boardFormat?.slug ?? null,
        readerFormatSlug: DEFAULT_FORMAT_SLUG,
        readerFormatIsSiteDefault: true,
        restrictTo: players.map((p) => p.playerId),
      });
      const comparison = beacon.comparison;
      if (!comparison) return { formatDisplay, agreementPercent: null };
      const readerRanks = readerRanksFor(players, comparison);
      const agreement = agreementShare(
        players.map((p) => rankGap(comparison, p, readerRanks.get(p.playerId))),
      );
      return {
        formatDisplay,
        agreementPercent: agreement ? Math.round(agreement.share * 100) : null,
      };
    } catch (err) {
      console.error("[og/board] beacon comparison failed", err);
      return { formatDisplay, agreementPercent: null };
    }
  } catch (err) {
    console.error("[og/board] format lookup failed", err);
    return { formatDisplay: null, agreementPercent: null };
  }
}

/**
 * Sleeper ids for the previewed players, keyed by our player id. One small
 * query, because loadPublicBoard does not carry them. Never throws: a failure
 * means no photos, and each row falls back to its position badge.
 */
async function loadSleeperIds(
  readClient: ReadClient,
  playerIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (playerIds.length === 0) return out;
  try {
    const { data, error } = await readClient
      .from("players")
      .select("id, external_ids")
      .in("id", playerIds);
    if (error || !data) return out;
    for (const row of data) {
      const sleeperId = readSleeperId(row.external_ids as Record<string, unknown> | null);
      if (sleeperId) out.set(row.id, sleeperId);
    }
  } catch (err) {
    console.error("[og/board] sleeper id lookup failed", err);
  }
  return out;
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
          fontFamily: OG_FONT_FAMILY,
          fontWeight: 500,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={OG_LOGO_DATA_URI}
          alt=""
          width={64}
          height={64}
          style={{ width: 64, height: 64 }}
        />
        <p style={{ fontSize: 46, fontWeight: 900, margin: "16px 0 0 0" }}>{OG_WORDMARK}</p>
        <p style={{ fontSize: 24, color: INK_MUTED, marginTop: 14 }}>
          Your signal through the fantasy noise.
        </p>
      </div>
    ),
    {
      ...SIZE,
      fonts: OG_FONTS,
      headers: { "cache-control": CACHE_CONTROL },
    },
  );
}
