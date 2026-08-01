import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
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
const LINE = "#1F1F33";

/**
 * GET /api/og/team/[league_id]/[roster_id]
 *
 * 1200x630 OG image for a team summary. Renders team name, owner record,
 * total roster value (using league-contextual format resolution), and
 * the top 5 most valuable players.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string; roster_id: string }> },
) {
  const { league_id: sleeperLeagueId, roster_id } = await params;
  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");
  const sleeperRosterId = Number.parseInt(roster_id, 10);

  if (!sleeperLeagueId || sleeperLeagueId.length > 64 || !Number.isFinite(sleeperRosterId)) {
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
  const context = await resolveLeagueContext(supabase, sleeperLeague, sourceParam);

  if (context.coverage === "none") {
    return notFoundImage("No value data available for this league");
  }

  const teams = await loadLeagueTeamCards(
    supabase,
    league.id,
    context.formatConfigId,
    context.sourceSlug,
    league.season != null ? String(league.season) : null,
    league.status ?? null,
  );
  const team = teams.find((t) => t.sleeperRosterId === sleeperRosterId);
  if (!team) return notFoundImage("Team not found");

  const cacheRow = team.cacheRow;
  const totalValue = cacheRow ? Number(cacheRow.total_value) : 0;
  const starterValue = cacheRow ? Number(cacheRow.starter_value) : 0;
  const benchValue = cacheRow ? Number(cacheRow.bench_value) : 0;
  const picksValue = cacheRow ? Number(cacheRow.picks_value) : 0;

  // Top 5 players by trend current_value
  const playersWithValue = team.players
    .map((p) => ({ ...p, value: team.trends[p.id]?.current_value ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

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
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>FF Beacon</p>
        </div>

        <p
          style={{
            fontSize: 18,
            color: CYAN,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 3,
            fontWeight: 600,
          }}
        >
          {clip(league.name, 50)}
        </p>
        <h1
          style={{
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -1.5,
            margin: "12px 0",
            lineHeight: 1.05,
          }}
        >
          {clip(team.teamName, 30)}
        </h1>
        <p style={{ fontSize: 22, color: INK_MUTED, margin: 0 }}>
          {team.ownerSleeperUsername ? `@${team.ownerSleeperUsername}` : ""}
          {team.ownerSleeperUsername ? ", " : ""}
          {team.record.wins}-{team.record.losses}
          {team.record.ties > 0 ? `-${team.record.ties}` : ""}, {context.formatDisplay}
        </p>

        {/* Value tiles */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 32,
          }}
        >
          <ValueTile label="Total" value={totalValue} accent />
          <ValueTile label="Starters" value={starterValue} />
          <ValueTile label="Bench" value={benchValue} />
          <ValueTile label="Picks" value={picksValue} />
        </div>

        {/* Top 5 players */}
        {playersWithValue.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 32 }}>
            <p
              style={{
                fontSize: 16,
                color: INK_SUBTLE,
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: 3,
                fontWeight: 600,
              }}
            >
              Top 5 by value
            </p>
            {playersWithValue.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${LINE}`,
                  background: "rgba(34, 211, 238, 0.05)",
                }}
              >
                <p
                  style={{
                    fontSize: 16,
                    color: CYAN,
                    margin: 0,
                    fontWeight: 700,
                    minWidth: 50,
                  }}
                >
                  {p.position}
                </p>
                <p style={{ fontSize: 22, color: INK, margin: 0, flex: 1 }}>
                  {clip(p.full_name, 30)}
                </p>
                <p
                  style={{
                    fontSize: 20,
                    color: INK_MUTED,
                    margin: 0,
                    fontFamily: "monospace",
                  }}
                >
                  {formatNumber(p.value)}
                </p>
              </div>
            ))}
          </div>
        )}

        <p
          style={{
            position: "absolute",
            bottom: 32,
            right: 64,
            fontSize: 18,
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
        "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
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
        padding: "16px 20px",
        borderRadius: 12,
        border: `1px solid ${accent ? PURPLE : LINE}`,
        background: accent ? "rgba(168, 85, 247, 0.08)" : "rgba(255, 255, 255, 0.02)",
        flex: 1,
      }}
    >
      <p
        style={{
          fontSize: 14,
          color: INK_SUBTLE,
          margin: 0,
          textTransform: "uppercase",
          letterSpacing: 2,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: INK,
          margin: "4px 0 0 0",
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

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}
