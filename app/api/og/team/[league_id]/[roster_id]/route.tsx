import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import {
  loadTeamShareCard,
  type ShareCardPick,
  type ShareCardPositionGroup,
} from "@/lib/league-share-card";
import type { SleeperLeague } from "@/lib/sleeper";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const AMBER = "#F59E0B";
const LINE = "#1F1F33";
const PANEL = "#0B0B14";

/** Same hues the roster columns use on the site (tailwind.config.ts `position.*`). */
const POSITION_COLOR: Record<string, string> = {
  QB: "#F87171",
  RB: "#34D399",
  WR: "#60A5FA",
  TE: "#FBBF24",
};

/**
 * The two roster marks, as inline SVG data URIs.
 *
 * They are the SAME lucide paths the site renders (Star and Scissors, v0.460),
 * copied here rather than imported, because Satori resolves `currentColor` from
 * nothing and a component's default attributes would arrive strokeless. The
 * colours are the site's own: cyan for strength, amber for caution.
 *
 * A data URI is decoded in-process, so neither of these costs a network fetch
 * at render time. Built once at module load, not per row.
 */
function iconDataUri(
  body: string,
  opts: { fill: string; stroke: string },
): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" ` +
    `fill="${opts.fill}" stroke="${opts.stroke}" stroke-width="2.5" ` +
    `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

const STAR_ICON = iconDataUri(
  '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  { fill: CYAN, stroke: CYAN },
);

const SCISSORS_ICON = iconDataUri(
  '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/>' +
    '<circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  { fill: "none", stroke: AMBER },
);

/** Rendered size of a mark inside a roster row, and the room it needs. */
const ICON_PX = 13;

/**
 * Lines a column has room for at 630px tall. A column that needs more than
 * this spends its last line on "+N more" instead of a name, so nothing ever
 * runs past the bottom edge of the image.
 */
const MAX_LINES = 12;

/** Split a list into what fits and what gets counted in the "+N more" line. */
function fitRows<T>(rows: T[]): { visible: T[]; hidden: number } {
  if (rows.length <= MAX_LINES) return { visible: rows, hidden: 0 };
  const visible = rows.slice(0, MAX_LINES - 1);
  return { visible, hidden: rows.length - visible.length };
}

/**
 * GET /api/og/team/[league_id]/[roster_id]
 *
 * 1200x630 share image for one team, laid out like the expanded roster card on
 * the site: a header with the team's identity and value split, then horizontal
 * position groups (QB / RB / WR / TE) plus a picks column. Starters carry the
 * same ST marker the site uses, and picks keep their ownership attribution.
 *
 * Query params:
 *   ?source=<slug>  override the value source (defaults to the league's own)
 *   ?picks=off      price and rank the team on players only
 *
 * Format is always derived from the league's Sleeper settings, never from the
 * viewer's global format toggle (CLAUDE.md, League Pulse Format Resolution).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string; roster_id: string }> },
) {
  const { league_id: sleeperLeagueId, roster_id } = await params;
  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");
  const picksParam = url.searchParams.get("picks");
  const sleeperRosterId = Number.parseInt(roster_id, 10);

  if (
    !sleeperLeagueId ||
    sleeperLeagueId.length > 64 ||
    !Number.isFinite(sleeperRosterId)
  ) {
    return new Response("Invalid params", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, status, metadata")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) return notFoundImage(`League ${sleeperLeagueId} not found`);

  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(
    supabase,
    sleeperLeague,
    sourceParam,
  );

  if (context.coverage === "none") {
    return notFoundImage("No value data available for this league");
  }

  // Picks only carry value in dynasty, matching the toggle on the team page.
  const includePicks =
    context.derived.league_type === "dynasty" && picksParam !== "off";

  const team = await loadTeamShareCard(
    supabase,
    league.id,
    sleeperRosterId,
    context.formatConfigId,
    context.sourceSlug,
    league.season != null ? String(league.season) : null,
    league.status ?? null,
    includePicks,
    context.derived.league_type === "dynasty",
  );
  if (!team) return notFoundImage("Team not found");

  const columnCount = includePicks ? 5 : 4;
  const recordLabel = `${team.record.wins}-${team.record.losses}${
    team.record.ties > 0 ? `-${team.record.ties}` : ""
  }`;
  const ofCount = team.teamCount > 0 ? ` of ${team.teamCount}` : "";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: `linear-gradient(180deg, ${BG} 0%, ${BG_BASE} 100%)`,
        color: INK,
        fontFamily: "sans-serif",
        padding: "36px 40px 28px 40px",
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

      {/* Brand + league */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p style={{ fontSize: 21, fontWeight: 700, margin: 0 }}>FF Beacon</p>
        </div>
        <p style={{ fontSize: 15, color: INK_MUTED, margin: 0 }}>
          {clip(league.name, 42)}
          {league.season != null ? `, ${league.season}` : ""}
        </p>
      </div>

      {/* Identity + value split */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          paddingBottom: 16,
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        {team.overallRank != null && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 62,
              height: 62,
              borderRadius: 14,
              border: `1px solid rgba(168, 85, 247, 0.45)`,
              background: "rgba(168, 85, 247, 0.10)",
            }}
          >
            <p
              style={{
                fontSize: 9,
                margin: 0,
                letterSpacing: 2,
                color: "rgba(168, 85, 247, 0.75)",
                fontWeight: 700,
              }}
            >
              RANK
            </p>
            <p
              style={{
                fontSize: 28,
                margin: 0,
                fontWeight: 700,
                color: PURPLE,
                fontFamily: "monospace",
              }}
            >
              {team.overallRank}
            </p>
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
          }}
        >
          <p
            style={{
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: -0.8,
              margin: 0,
            }}
          >
            {clip(team.teamName, 26)}
          </p>
          <p style={{ fontSize: 16, color: INK_MUTED, margin: "6px 0 0 0" }}>
            {team.ownerHandle ? `@${clip(team.ownerHandle, 20)}, ` : ""}
            {recordLabel}
            {team.overallRank != null
              ? `, ${ordinal(team.overallRank)}${ofCount}`
              : ""}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <ValueTile label="Total" value={team.totalValue} accent />
          <ValueTile label="Starters" value={team.starterValue} />
          <ValueTile label="Bench" value={team.benchValue} />
          {includePicks && <ValueTile label="Picks" value={team.picksValue} />}
        </div>
      </div>

      {/* Position groups, laid out the way the expanded roster card is */}
      <div style={{ display: "flex", gap: 10, marginTop: 14, flex: 1 }}>
        {team.positions.map((group) => (
          <PositionColumn
            key={group.position}
            group={group}
            teamCount={team.teamCount}
            width={`${100 / columnCount}%`}
          />
        ))}
        {includePicks && (
          <PicksColumn picks={team.picks} width={`${100 / columnCount}%`} />
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12,
        }}
      >
        <p style={{ fontSize: 13, color: INK_SUBTLE, margin: 0 }}>
          Values via {context.sourceDisplay}, {context.formatDisplay}
          {context.pickSource && context.pickSource.slug !== context.sourceSlug
            ? `, picks via ${context.pickSource.display}`
            : ""}
        </p>
        {/* A shared image carries no tooltip, so the two marks explain
              themselves here or they are decoration nobody can read. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <LegendMark icon={STAR_ICON} label="Top 14 at the position" />
          <LegendMark icon={SCISSORS_ICON} label="Cut candidate" />
        </div>
        <p style={{ fontSize: 15, color: INK_SUBTLE, margin: 0 }}>
          ffbeacon.com
        </p>
      </div>
    </div>,
    {
      ...SIZE,
      headers: {
        "cache-control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function PositionColumn({
  group,
  teamCount,
  width,
}: {
  group: ShareCardPositionGroup;
  teamCount: number;
  width: string;
}) {
  const color = POSITION_COLOR[group.position] ?? INK_MUTED;
  const { visible, hidden } = fitRows(group.players);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        borderRadius: 12,
        border: `1px solid ${LINE}`,
        borderTop: `2px solid ${color}`,
        background: PANEL,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 9px",
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.4,
              margin: 0,
              color,
              padding: "2px 5px",
              borderRadius: 5,
              background: `${color}26`,
            }}
          >
            {group.position}
          </p>
          <p
            style={{
              fontSize: 10,
              color: INK_SUBTLE,
              margin: 0,
              fontFamily: "monospace",
            }}
          >
            {group.rank != null
              ? `${ordinal(group.rank)} of ${teamCount}`
              : "-"}
          </p>
        </div>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: INK,
            margin: 0,
            fontFamily: "monospace",
          }}
        >
          {formatNumber(group.value)}
        </p>
      </div>

      {visible.length === 0 ? (
        <p
          style={{ fontSize: 11, color: INK_SUBTLE, margin: 0, padding: "9px" }}
        >
          No {group.position}s
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((p, i) => (
            <div
              key={`${group.position}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 9px",
                borderTop: i === 0 ? "none" : `1px solid rgba(31, 31, 51, 0.6)`,
              }}
            >
              {/* Starter marker, the same ST chip the roster card uses. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 17,
                  height: 13,
                  borderRadius: 4,
                  background: p.starter
                    ? "rgba(34, 211, 238, 0.20)"
                    : "transparent",
                }}
              >
                <p
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: 0.6,
                    margin: 0,
                    color: p.starter ? CYAN : "transparent",
                  }}
                >
                  ST
                </p>
              </div>
              {/* A badged row spends 13px on the mark, so its name is clipped
                  shorter. Satori does not ellipsize on its own: without this
                  the name would wrap and the row would grow a second line. */}
              <p style={{ fontSize: 13, color: INK, margin: 0, flex: 1 }}>
                {clip(p.name, p.topAtPosition || p.dropCandidate ? 12 : 15)}
              </p>
              {(p.topAtPosition || p.dropCandidate) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.topAtPosition ? STAR_ICON : SCISSORS_ICON}
                  width={ICON_PX}
                  height={ICON_PX}
                  alt=""
                />
              )}
              <p style={{ fontSize: 9, color: INK_SUBTLE, margin: 0 }}>
                {p.team ?? "FA"}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: INK_MUTED,
                  margin: 0,
                  fontFamily: "monospace",
                }}
              >
                {formatNumber(p.value)}
              </p>
            </div>
          ))}
          {hidden > 0 && (
            <p
              style={{
                fontSize: 10,
                color: INK_SUBTLE,
                margin: 0,
                padding: "4px 9px",
                borderTop: `1px solid rgba(31, 31, 51, 0.6)`,
              }}
            >
              +{hidden} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PicksColumn({
  picks,
  width,
}: {
  picks: ShareCardPick[];
  width: string;
}) {
  const { visible, hidden } = fitRows(picks);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        borderRadius: 12,
        border: `1px solid ${LINE}`,
        borderTop: `2px solid ${INK_SUBTLE}`,
        background: PANEL,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 9px",
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.4,
            margin: 0,
            color: INK,
            padding: "2px 5px",
            borderRadius: 5,
            background: "rgba(244, 244, 248, 0.10)",
          }}
        >
          PICKS
        </p>
        <p
          style={{
            fontSize: 10,
            color: INK_SUBTLE,
            margin: 0,
            fontFamily: "monospace",
          }}
        >
          {picks.length} pick{picks.length === 1 ? "" : "s"}
        </p>
      </div>

      {visible.length === 0 ? (
        <p
          style={{ fontSize: 11, color: INK_SUBTLE, margin: 0, padding: "9px" }}
        >
          No picks
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((p, i) => (
            <div
              key={`pick-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 9px",
                borderTop: i === 0 ? "none" : `1px solid rgba(31, 31, 51, 0.6)`,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  color: INK,
                  margin: 0,
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
              >
                {p.label}
              </p>
              <p
                style={{
                  fontSize: 9,
                  color: p.isOwn ? INK_SUBTLE : CYAN,
                  margin: 0,
                  marginLeft: "auto",
                }}
              >
                {clip(p.attribution, 16)}
              </p>
            </div>
          ))}
          {hidden > 0 && (
            <p
              style={{
                fontSize: 10,
                color: INK_SUBTLE,
                margin: 0,
                padding: "4px 9px",
                borderTop: `1px solid rgba(31, 31, 51, 0.6)`,
              }}
            >
              +{hidden} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One entry of the footer legend: the mark itself, then what it means. */
function LegendMark({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon} width={ICON_PX} height={ICON_PX} alt="" />
      <p style={{ fontSize: 12, color: INK_SUBTLE, margin: 0 }}>{label}</p>
    </div>
  );
}

function ValueTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid ${accent ? PURPLE : LINE}`,
        background: accent
          ? "rgba(168, 85, 247, 0.08)"
          : "rgba(255, 255, 255, 0.02)",
        minWidth: 96,
      }}
    >
      <p
        style={{
          fontSize: 10,
          color: INK_SUBTLE,
          margin: 0,
          letterSpacing: 1.6,
          fontWeight: 700,
        }}
      >
        {label.toUpperCase()}
      </p>
      <p
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: INK,
          margin: "5px 0 0 0",
          fontFamily: "monospace",
        }}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}

function notFoundImage(reason: string): Response {
  return new ImageResponse(
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
    </div>,
    { ...SIZE, status: 404 },
  );
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "...";
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}
