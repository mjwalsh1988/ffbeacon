import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { MAX_MATCHUP_WEEK } from "@/lib/league-matchups";
import {
  loadMatchupDetail,
  resolveScheduleWeek,
} from "@/lib/league-schedule/data";
import type {
  MatchupSide,
  MatchupSlotEntry,
} from "@/lib/league-schedule/types";

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
const PANEL = "#0B0B14";

/** Starters named on the card. Five per side is what fits at 630px tall. */
const TOP_STARTERS = 5;

/**
 * The largest roster number this route will look up.
 *
 * Sleeper roster ids are 1-based and dense, and the biggest league anybody
 * actually plays is well under this. The bound is not about the cost of one
 * lookup. It is that every distinct (league, week, roster) triple is a distinct
 * cache key, and the response below carries `s-maxage=3600`, so an unbounded id
 * lets anyone fill the CDN with an unlimited number of 404 images that each
 * stay parked for an hour. Same ceiling the page route enforces; a URL that
 * cannot produce a page must not produce a card either.
 */
const MAX_ROSTER_ID = 64;

/**
 * GET /api/og/matchup/[league_id]/[week]/[roster_id]
 *
 * 1200x630 share image for one matchup: both teams, their records, the two
 * totals, and the starters carrying each side. This is the card that shows up
 * when somebody drops a matchup link into a group chat, so the two numbers it
 * leads with are the two numbers the argument is about.
 *
 * NO VALUE DATA APPEARS HERE, which is why resolveLeagueContext is not called.
 * Every figure on the card is a projection or a result scored under the
 * league's own Sleeper settings, and neither one moves when a reader changes
 * their value source. Calling the resolver would buy a source label for a card
 * that has no sourced number on it.
 *
 * NOTHING IS SYNCED BY THIS ROUTE EITHER. It reads the rows the deep view
 * already wrote. A crawler fetching an image is not a reason to hit Sleeper,
 * and a share card that triggered a league sync would let anyone with a URL
 * schedule work on our side.
 *
 * Query params: none. The week and the roster are the whole key.
 */
export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ league_id: string; week: string; roster_id: string }>;
  },
) {
  const {
    league_id: sleeperLeagueId,
    week: weekParam,
    roster_id: rosterParam,
  } = await params;

  const week = Number.parseInt(weekParam, 10);
  const sleeperRosterId = Number.parseInt(rosterParam, 10);
  if (
    !sleeperLeagueId ||
    sleeperLeagueId.length > 64 ||
    !Number.isFinite(week) ||
    week < 1 ||
    week > MAX_MATCHUP_WEEK ||
    !Number.isFinite(sleeperRosterId) ||
    sleeperRosterId < 1 ||
    sleeperRosterId > MAX_ROSTER_ID
  ) {
    // A 400 with no image body, so a rejected id never reaches the renderer and
    // never becomes something worth caching.
    return new Response("Invalid params", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, metadata")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) return notFoundImage(`League ${sleeperLeagueId} not found`);

  const season = Number(league.season);
  if (!Number.isFinite(season))
    return notFoundImage("This league has no season on file");

  const playoffWeekStart = resolvePlayoffWeekStart(league.metadata);
  const currentWeek = await resolveScheduleWeek(season, playoffWeekStart);

  const result = await loadMatchupDetail(supabase, supabase, {
    leagueRowId: league.id,
    season,
    week,
    sleeperRosterId,
    currentWeek,
  });
  if (!result.ok) {
    return notFoundImage(`No week ${week} game stored for this roster`);
  }

  const view = result.view;
  const { home, away, isFinal } = view;
  const homeTotal = isFinal ? home.actualTotal : home.projectedTotal;
  const awayTotal = away
    ? isFinal
      ? away.actualTotal
      : away.projectedTotal
    : null;
  const homeProb = view.homeWinProb;

  const state = isFinal ? "Final" : view.isCurrent ? "This week" : "Upcoming";

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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
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
          {clip(league.name, 38)}, week {week}, {state.toLowerCase()}
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 14, flex: 1 }}>
        <SidePanel
          side={home}
          total={homeTotal}
          isFinal={isFinal}
          winProb={homeProb}
          align="left"
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 92,
          }}
        >
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 3,
              color: INK_SUBTLE,
              margin: 0,
            }}
          >
            VS
          </p>
          <div
            style={{
              width: 2,
              flex: 1,
              marginTop: 10,
              background: `linear-gradient(180deg, ${PURPLE} 0%, ${CYAN} 100%)`,
            }}
          />
        </div>

        {away ? (
          <SidePanel
            side={away}
            total={awayTotal}
            isFinal={isFinal}
            winProb={homeProb === null ? null : 1 - homeProb}
            align="right"
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              flex: 1,
              borderRadius: 14,
              border: `1px solid ${LINE}`,
              background: PANEL,
              padding: "18px 20px",
            }}
          >
            <p style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
              No opponent
            </p>
            <p style={{ fontSize: 15, color: INK_MUTED, margin: "10px 0 0 0" }}>
              This league has an odd number of teams, so one roster sits out
              each week.
            </p>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 14,
        }}
      >
        <p style={{ fontSize: 13, color: INK_SUBTLE, margin: 0 }}>
          {isFinal
            ? "Final scores from Sleeper"
            : "Projected under this league's own scoring settings"}
        </p>
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

/**
 * One team's column.
 *
 * The win probability is printed as a percentage next to the total rather than
 * drawn as a bar. A share card is a still image with no alt text of its own, so
 * anything it only draws is information it does not carry.
 */
function SidePanel({
  side,
  total,
  isFinal,
  winProb,
  align,
}: {
  side: MatchupSide;
  total: number | null;
  isFinal: boolean;
  winProb: number | null;
  align: "left" | "right";
}) {
  const starters = topStarters(side, isFinal);
  const record = `${side.record.wins}-${side.record.losses}${
    side.record.ties > 0 ? `-${side.record.ties}` : ""
  }`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        borderRadius: 14,
        border: `1px solid ${LINE}`,
        borderTop: `2px solid ${align === "left" ? CYAN : PURPLE}`,
        background: PANEL,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "14px 16px",
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: -0.6,
            margin: 0,
          }}
        >
          {clip(side.teamName, 22)}
        </p>
        <p style={{ fontSize: 14, color: INK_MUTED, margin: "6px 0 0 0" }}>
          {side.ownerHandle ? `@${clip(side.ownerHandle, 18)}, ` : ""}
          {record}
          {side.pulseRank !== null ? `, Pulse rank ${side.pulseRank}` : ""}
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginTop: 10,
          }}
        >
          <p
            style={{
              fontSize: 52,
              fontWeight: 700,
              margin: 0,
              fontFamily: "monospace",
              color: INK,
            }}
          >
            {total === null ? "--" : total.toFixed(1)}
          </p>
          <p style={{ fontSize: 14, color: INK_SUBTLE, margin: 0 }}>
            {isFinal ? "scored" : "projected"}
            {winProb !== null ? `, ${Math.round(winProb * 100)}% to win` : ""}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {starters.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: INK_SUBTLE,
              margin: 0,
              padding: "12px 16px",
            }}
          >
            No projected starters on file
          </p>
        ) : (
          starters.map((entry, i) => (
            <div
              key={`${entry.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 16px",
                borderTop: i === 0 ? "none" : `1px solid rgba(31, 31, 51, 0.6)`,
              }}
            >
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1,
                  color: INK_SUBTLE,
                  margin: 0,
                  width: 46,
                }}
              >
                {entry.slotLabel}
              </p>
              <p style={{ fontSize: 15, color: INK, margin: 0, flex: 1 }}>
                {clip(entry.name, 18)}
              </p>
              <p style={{ fontSize: 11, color: INK_SUBTLE, margin: 0 }}>
                {entry.team ?? "FA"}
              </p>
              <p
                style={{
                  fontSize: 14,
                  color: INK_MUTED,
                  margin: 0,
                  fontFamily: "monospace",
                  width: 46,
                  textAlign: "right",
                }}
              >
                {entry.points === null ? "--" : entry.points.toFixed(1)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The starters carrying a side, biggest number first.
 *
 * A slot with no player and a player with no published number are both left
 * out rather than printed as 0.0. A zero on a share card is the version of the
 * number that gets screenshotted and argued about, and it would be wrong.
 */
function topStarters(
  side: MatchupSide,
  isFinal: boolean,
): {
  name: string;
  team: string | null;
  slotLabel: string;
  points: number | null;
}[] {
  const filled = side.slots.filter(
    (
      entry,
    ): entry is MatchupSlotEntry & {
      player: NonNullable<MatchupSlotEntry["player"]>;
    } => entry.player !== null,
  );

  return filled
    .map((entry) => ({
      name: entry.player.name,
      team: entry.player.team,
      slotLabel: entry.slot.label,
      points: isFinal ? entry.player.actual : entry.player.projected,
    }))
    .filter((entry) => entry.points !== null)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, TOP_STARTERS);
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

/**
 * The league's own playoff cut line.
 *
 * Sleeper writes `playoff_week_start: 0` on a league whose bracket has not been
 * set up, and zero is a number, so a plain `?? 15` never fires. Same guard as
 * lib/power-pulse/load.ts, for the same reason.
 */
function resolvePlayoffWeekStart(metadata: unknown): number {
  const settings = (metadata as { settings?: Record<string, unknown> } | null)
    ?.settings;
  const configured = Number(settings?.playoff_week_start);
  return Number.isFinite(configured) && configured > 0
    ? Math.trunc(configured)
    : 15;
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "...";
}
