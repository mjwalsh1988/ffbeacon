import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import type { SleeperLeague } from "@/lib/sleeper";

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

/**
 * GET /api/og/league/[league_id]
 *
 * 1200x630 OG image showing the league name, season, team count, and
 * top-3 power rankings (when cache rows exist). FF Beacon brand only.
 *
 * Values rendered here use the league's contextual format resolution
 * (CLAUDE.md → League Pulse Format Resolution): we accept ?source= for
 * the active source slug, otherwise read the highest-priority source
 * that publishes rankings.
 *
 * Cached for 1 hour at the CDN edge via cache-control headers.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;
  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");

  if (!sleeperLeagueId || sleeperLeagueId.length > 64) {
    return new Response("Invalid league id", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, total_rosters, status, metadata")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) {
    return notFoundImage(`League ${sleeperLeagueId} not found`);
  }

  // Use the same league-contextual format resolution the rest of the site
  // uses. The format isn't user-controlled inside a league view — it's
  // derived from the actual Sleeper rules. This keeps the OG card aligned
  // with what users see on /leagues/[id].
  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(supabase, sleeperLeague, sourceParam);
  const formatConfigId =
    context.coverage === "none" ? null : context.formatConfigId;
  const effectiveSourceSlug =
    context.coverage === "none" ? null : context.sourceSlug;
  const sourceDisplay =
    context.coverage === "none" ? null : context.sourceDisplay;

  let topTeams: Array<{ teamName: string; rank: number; totalValue: number }> = [];
  if (formatConfigId && effectiveSourceSlug) {
    const { data: cache } = await supabase
      .from("league_power_rankings_cache")
      .select("roster_id, total_value, overall_rank")
      .eq("league_id", league.id)
      .eq("format_config_id", formatConfigId)
      .eq("source", effectiveSourceSlug)
      .order("overall_rank", { ascending: true })
      .limit(3);
    const rosterIds = (cache ?? []).map((c) => c.roster_id);
    if (rosterIds.length > 0) {
      const { data: rosters } = await supabase
        .from("rosters")
        .select("id, sleeper_roster_id, owner_user_id")
        .in("id", rosterIds);
      const { data: users } = await supabase
        .from("league_users")
        .select("sleeper_user_id, display_name, team_name")
        .eq("league_id", league.id);
      const userBySleeperId = new Map(users?.map((u) => [u.sleeper_user_id, u]) ?? []);
      const rosterById = new Map(rosters?.map((r) => [r.id, r]) ?? []);
      for (const c of cache ?? []) {
        const r = rosterById.get(c.roster_id);
        if (!r) continue;
        const u = r.owner_user_id ? userBySleeperId.get(r.owner_user_id) : null;
        const teamName = u?.team_name || u?.display_name || `Team ${r.sleeper_roster_id}`;
        topTeams.push({
          teamName,
          rank: c.overall_rank ?? 0,
          totalValue: Number(c.total_value),
        });
      }
    }
  }

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 36,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
          <p
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: -0.5,
              margin: 0,
            }}
          >
            FF Beacon
          </p>
        </div>

        {/* League name */}
        <p
          style={{
            fontSize: 24,
            color: CYAN,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 4,
            fontWeight: 600,
          }}
        >
          League Pulse
        </p>
        <h1
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: -2,
            margin: "16px 0 8px 0",
            lineHeight: 1.05,
          }}
        >
          {clip(league.name, 60)}
        </h1>
        <p style={{ fontSize: 28, color: INK_MUTED, margin: 0 }}>
          {league.season} • {league.total_rosters ?? "?"} teams
          {sourceDisplay ? ` • ${sourceDisplay}` : ""}
        </p>

        {/* Top 3 power rankings */}
        {topTeams.length > 0 && (
          <div
            style={{
              marginTop: 48,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <p
              style={{
                fontSize: 18,
                color: INK_SUBTLE,
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: 3,
                fontWeight: 600,
              }}
            >
              Top power rankings
            </p>
            {topTeams.map((t) => (
              <div
                key={t.rank}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: `1px solid ${LINE}`,
                  background: "rgba(168, 85, 247, 0.05)",
                }}
              >
                <p
                  style={{
                    fontSize: 36,
                    fontWeight: 700,
                    color: CYAN,
                    margin: 0,
                    minWidth: 60,
                  }}
                >
                  #{t.rank}
                </p>
                <p
                  style={{
                    fontSize: 28,
                    fontWeight: 600,
                    color: INK,
                    margin: 0,
                    flex: 1,
                  }}
                >
                  {clip(t.teamName, 32)}
                </p>
                <p
                  style={{
                    fontSize: 24,
                    color: INK_MUTED,
                    margin: 0,
                    fontFamily: "monospace",
                  }}
                >
                  {formatNumber(t.totalValue)}
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
  return s.slice(0, n - 1) + "…";
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}
