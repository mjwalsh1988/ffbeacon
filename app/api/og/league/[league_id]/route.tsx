import { ImageResponse } from "next/og";
import { teamLabelParts } from "@/lib/team-label";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import type { SleeperLeague } from "@/lib/sleeper";
import {
  fitText,
  OG_COLORS as C,
  OG_ROOT_STYLE,
  OgAccentBar,
  OgBrandMark,
  ogResponseOptions,
} from "@/lib/og/brand";

export const runtime = "nodejs";

const CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/** Content width inside the 64px side padding. */
const INNER = 1072;
const LEFT_WIDTH = 540;
const COLUMN_GAP = 48;
const RIGHT_WIDTH = INNER - LEFT_WIDTH - COLUMN_GAP;
/** Room for a team name in a row: the column less the rank badge, the value and the gaps. */
const TEAM_NAME_WIDTH = RIGHT_WIDTH - 52 - 110 - 2 * 16 - 2 * 18;
const TITLE_LINE_HEIGHT = 1.08;

type TopTeam = { primary: string; owner: string | null; rank: number; totalValue: number };

/**
 * GET /api/og/league/[league_id]
 *
 * 1200x630 share card for every League Pulse page: the league name, season,
 * team count and the top three rosters by value (when cache rows exist).
 *
 * TWO COLUMNS, AND EVERY TEXT BLOCK SIZED TO ITS BOX. The first version stacked
 * the name, a subtitle and three ranking rows in one column with a fixed 72px
 * title, which is taller than 630px as soon as the name wraps. Satori answers
 * that by shrinking the flex children, so the subtitle and the rankings header
 * were drawn through the title on every league, long name or not ("S2"
 * overlapped too). Now the name has its own column, its size comes from
 * fitText, and nothing below it in that column depends on how long it is.
 *
 * Values use the league's contextual format (CLAUDE.md, League Pulse Format
 * Resolution): ?source= overrides the source, the format comes from the
 * league's own Sleeper settings.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;
  const sourceParam = new URL(request.url).searchParams.get("source");

  if (!sleeperLeagueId || sleeperLeagueId.length > 64) {
    return new Response("Invalid league id", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, total_rosters, status, metadata")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) return notFoundImage();

  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(supabase, sleeperLeague, sourceParam);
  const formatConfigId = context.coverage === "none" ? null : context.formatConfigId;
  const effectiveSourceSlug = context.coverage === "none" ? null : context.sourceSlug;
  const sourceDisplay = context.coverage === "none" ? null : context.sourceDisplay;

  const topTeams: TopTeam[] = [];
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
      const [{ data: rosters }, { data: users }] = await Promise.all([
        supabase.from("rosters").select("id, sleeper_roster_id, owner_user_id").in("id", rosterIds),
        supabase.from("league_users").select("sleeper_user_id, display_name, team_name").eq("league_id", league.id),
      ]);
      const userBySleeperId = new Map(users?.map((u) => [u.sleeper_user_id, u]) ?? []);
      const rosterById = new Map(rosters?.map((r) => [r.id, r]) ?? []);
      for (const c of cache ?? []) {
        const r = rosterById.get(c.roster_id);
        if (!r) continue;
        const u = r.owner_user_id ? userBySleeperId.get(r.owner_user_id) : null;
        const parts = teamLabelParts({
          teamName: u?.team_name,
          username: u?.display_name,
          sleeperRosterId: r.sleeper_roster_id,
        });
        topTeams.push({ ...parts, rank: c.overall_rank ?? 0, totalValue: Number(c.total_value) });
      }
    }
  }

  const title = fitText(league.name, { width: LEFT_WIDTH, maxSize: 72, minSize: 40, maxLines: 3 });
  const details = [`${league.season} season`, `${league.total_rosters ?? "?"} teams`].join(", ");

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "52px 64px 40px 64px" }}>
        <OgAccentBar />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <OgBrandMark />
          <p style={{ fontSize: 20, fontWeight: 900, color: C.cyan, margin: 0, letterSpacing: 4, textTransform: "uppercase" }}>
            League Pulse
          </p>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", gap: COLUMN_GAP, minHeight: 0 }}>
          {/* Left: the league itself. */}
          <div style={{ display: "flex", flexDirection: "column", width: LEFT_WIDTH, flexShrink: 0 }}>
            <p style={{ fontSize: 24, color: C.inkMuted, margin: "0 0 14px 0" }}>{details}</p>
            <p
              style={{
                fontSize: title.fontSize,
                fontWeight: 900,
                lineHeight: TITLE_LINE_HEIGHT,
                letterSpacing: -1,
                margin: 0,
                // Reserved, not merely allowed: the height the fitted title
                // needs is claimed up front so the line below can never be
                // pulled up into it.
                height: Math.ceil(title.lines * title.fontSize * TITLE_LINE_HEIGHT),
                flexShrink: 0,
              }}
            >
              {title.text}
            </p>
            {sourceDisplay && (
              <p style={{ fontSize: 22, color: C.inkSubtle, margin: "18px 0 0 0" }}>Values on {sourceDisplay}</p>
            )}
          </div>

          {/* Right: the top three, or what the page offers when there are none yet. */}
          <div style={{ display: "flex", flexDirection: "column", width: RIGHT_WIDTH, gap: 12, flexShrink: 0 }}>
            <p style={{ fontSize: 17, fontWeight: 900, color: C.inkSubtle, margin: "0 0 2px 0", letterSpacing: 3, textTransform: "uppercase" }}>
              {topTeams.length > 0 ? "Most valuable rosters" : "Inside the league"}
            </p>
            {topTeams.length > 0
              ? topTeams.map((t) => <RankRow key={t.rank} team={t} />)
              : ["Every roster and its value", "Power rankings and playoff odds", "Every trade, graded"].map((line) => (
                  <div key={line} style={{ display: "flex", padding: "16px 18px", borderRadius: 12, border: `1px solid ${C.line}`, background: "rgba(15,15,26,0.7)" }}>
                    <p style={{ fontSize: 24, color: C.ink, margin: 0 }}>{line}</p>
                  </div>
                ))}
          </div>
        </div>

        <Footer />
      </div>
    ),
    ogResponseOptions(CACHE),
  );
}

function RankRow({ team }: { team: TopTeam }) {
  const name = fitText(team.primary, { width: TEAM_NAME_WIDTH, maxSize: 26, minSize: 18, maxLines: 1 });
  const owner = team.owner ? fitText(team.owner, { width: TEAM_NAME_WIDTH, maxSize: 18, minSize: 16, maxLines: 1, weight: 500 }) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 18px",
        height: 78,
        borderRadius: 12,
        border: `1px solid ${C.line}`,
        background: "rgba(168, 85, 247, 0.06)",
        flexShrink: 0,
      }}
    >
      <p style={{ fontSize: 30, fontWeight: 900, color: C.cyan, margin: 0, width: 52, flexShrink: 0 }}>#{team.rank}</p>
      <div style={{ display: "flex", flexDirection: "column", width: TEAM_NAME_WIDTH, flexShrink: 0 }}>
        <p style={{ fontSize: name.fontSize, fontWeight: 900, margin: 0, lineHeight: 1.15 }}>{name.text}</p>
        {owner && <p style={{ fontSize: owner.fontSize, color: C.inkMuted, margin: "2px 0 0 0" }}>{owner.text}</p>}
      </div>
      <p style={{ fontSize: 22, color: C.inkMuted, margin: 0, width: 110, flexShrink: 0, justifyContent: "flex-end", display: "flex" }}>
        {Math.round(team.totalValue).toLocaleString("en-US")}
      </p>
    </div>
  );
}

function Footer() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderTop: `1px solid ${C.line}`,
        paddingTop: 16,
        flexShrink: 0,
      }}
    >
      <p style={{ fontSize: 20, color: C.inkSubtle, margin: 0 }}>Rosters, trades and power rankings for your Sleeper league</p>
      <p style={{ fontSize: 20, fontWeight: 900, color: C.inkMuted, margin: 0 }}>ffbeacon.com</p>
    </div>
  );
}

function notFoundImage(): Response {
  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, alignItems: "center", justifyContent: "center", gap: 24 }}>
        <OgAccentBar />
        <OgBrandMark size={64} />
        <p style={{ fontSize: 30, color: C.inkMuted, margin: 0 }}>League Pulse: every Sleeper league on one page</p>
      </div>
    ),
    // Short, so a league shared just before its first sync gets its real card
    // minutes later rather than a day later.
    ogResponseOptions("public, max-age=60, s-maxage=300", { status: 404 }),
  );
}
