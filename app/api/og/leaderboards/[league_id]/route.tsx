import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidLeagueId } from "@/lib/on-the-clock/validation";
import { loadLeaderboardsCached } from "@/lib/league-leaderboards/load";
import { buildLeaderboardsShareCard, type LeaderboardsShareRow } from "@/lib/league-leaderboards/share";
import { loadRemoteImages, sleeperPlayerImageUrl } from "@/lib/og/assets";
import {
  fitText,
  OG_COLORS as C,
  OG_GRADIENT,
  OG_POSITION_COLORS,
  OG_ROOT_STYLE,
  OgAccentBar,
  OgBrandMark,
  ogResponseOptions,
} from "@/lib/og/brand";
import { clip } from "@/lib/og/display-name";
import { renderHeadlineCard } from "@/lib/og/headline-card";

export const runtime = "nodejs";

/**
 * GET /api/og/leaderboards/[league_id]?week=N
 *
 * 1200x630 share card for a league's Leaderboards: the leader on a podium
 * card at the left with his photo and his total, the next four in a list at
 * the right, whose roster each one is on (or "Free agent"), and the high team
 * score along the bottom. FF Beacon brand only: the beacon gradient, Geist,
 * the wordmark. No gold.
 *
 * Content comes from buildLeaderboardsShareCard, the same object the page's
 * copy button reads back as a sentence, so the picture and its description
 * cannot disagree. Reads stored rows only; it never starts a league sync, so
 * a crawler fetching the card cannot make the site call Sleeper.
 *
 * Cached an hour at the edge like the other league cards. A failed or empty
 * league gets a short cache, so the real card replaces it once there is one.
 */

const LONG_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";
const SHORT_CACHE = "public, s-maxage=300, stale-while-revalidate=600";
const PANEL = "#0B0B14";

function weekParam(url: string): number | null {
  const raw = new URL(url).searchParams.get("week");
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 25 ? n : null;
}

function placeholder(top: string, bottom: string, subhead: string): ImageResponse {
  return renderHeadlineCard(
    {
      eyebrow: "League Pulse Leaderboards",
      headlineTop: top,
      headlineBottom: bottom,
      subhead,
      footerLeft: "ffbeacon.com/tools/league-pulse",
      badge: "Leaderboards",
    },
    SHORT_CACHE,
  );
}

function PosPill({ position }: { position: string }) {
  const color = OG_POSITION_COLORS[position] ?? C.inkMuted;
  return (
    <div
      style={{
        display: "flex",
        padding: "2px 10px",
        borderRadius: 8,
        border: `2px solid ${color}`,
        color,
        fontSize: 18,
        fontWeight: 900,
      }}
    >
      {position}
    </div>
  );
}

function OwnerLine({ row, size }: { row: LeaderboardsShareRow; size: number }) {
  if (!row.ownerName) {
    return (
      <div
        style={{
          display: "flex",
          padding: "2px 12px",
          borderRadius: 999,
          border: `2px dashed ${C.inkSubtle}`,
          color: C.inkMuted,
          fontSize: size,
          fontWeight: 700,
        }}
      >
        Free agent
      </div>
    );
  }
  return (
    <div style={{ display: "flex", color: C.inkMuted, fontSize: size, fontWeight: 500 }}>
      {`on ${clip(row.ownerName, 24)}`}
    </div>
  );
}

function Photo({ src, size, radius }: { src: string | null; size: number; radius: number }) {
  if (!src) {
    return (
      <div
        style={{ display: "flex", width: size, height: size, borderRadius: radius, background: C.line }}
      />
    );
  }
  return (
    // Satori draws this into a PNG; next/image has nothing to optimize here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", background: C.line }} />
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string }> },
) {
  const { league_id: sleeperLeagueId } = await params;
  if (!isValidLeagueId(sleeperLeagueId)) {
    return new Response("Invalid league id", { status: 400 });
  }

  // ONE URL PER CARD. Anything but a plain `?week=N` is sent to its canonical
  // form, so a junk query string cannot mint a fresh edge cache entry and a
  // fresh render for the same picture.
  const url = new URL(request.url);
  const week = weekParam(request.url);
  const canonical = week !== null ? `?week=${week}` : "";
  if (url.search !== canonical) {
    return Response.redirect(new URL(`${url.pathname}${canonical}`, url), 308);
  }

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("id, name")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) return placeholder("League", "not found", "Open the league in League Pulse to build its leaderboards.");

  let view;
  try {
    view = await loadLeaderboardsCached(league.id, week);
  } catch (error) {
    console.error("[og/leaderboards] load failed", error);
    view = null;
  }
  if (!view || view.settledWeeks.length === 0 || view.boards.all.length === 0) {
    return placeholder(clip(league.name, 40), "Leaderboards", "They fill in once week 1 is final in this league.");
  }

  const card = buildLeaderboardsShareCard(view);
  const photos = await loadRemoteImages(
    card.rows.map((r) => sleeperPlayerImageUrl(r.sleeperId, r.position)),
  );
  const [leader, ...rest] = card.rows;
  const leagueName = fitText(league.name, { width: 640, maxSize: 26, minSize: 18, maxLines: 1, weight: 500 });
  const leaderName = fitText(leader.name, { width: 190, maxSize: 32, minSize: 20, maxLines: 2 });

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "36px 52px 30px 52px" }}>
        <OgAccentBar />
        <div
          style={{
            position: "absolute",
            top: -160,
            left: -120,
            width: 560,
            height: 560,
            borderRadius: 280,
            background: "radial-gradient(circle, rgba(168,85,247,0.30) 0%, rgba(168,85,247,0) 70%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <OgBrandMark size={34} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", color: C.cyan, fontSize: 16, fontWeight: 900, letterSpacing: 3 }}>
              LEADERBOARDS
            </div>
            <div style={{ display: "flex", color: C.inkMuted, fontSize: leagueName.fontSize, fontWeight: 500 }}>
              {leagueName.text}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
          <div style={{ display: "flex", fontSize: 54, fontWeight: 900, letterSpacing: -1 }}>{card.title}</div>
          {card.playoff && (
            <div
              style={{
                display: "flex",
                padding: "4px 14px",
                borderRadius: 999,
                background: "rgba(168,85,247,0.22)",
                color: C.purple,
                fontSize: 18,
                fontWeight: 900,
                letterSpacing: 2,
              }}
            >
              PLAYOFFS
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 18, flex: 1 }}>
          {/* The leader. A gradient frame drawn as a padded gradient box with
              the panel inside it, which satori renders reliably. */}
          <div style={{ display: "flex", width: 380, padding: 3, borderRadius: 24, background: OG_GRADIENT }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                borderRadius: 21,
                background: PANEL,
                padding: "20px 22px",
              }}
            >
              {/* Photo left, name right, so the card spends its height on the
                  number. Nothing here is stacked tighter than its own size. */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, width: "100%" }}>
                <div style={{ display: "flex", padding: 4, borderRadius: 20, background: OG_GRADIENT }}>
                  <Photo src={photos[0]} size={112} radius={16} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      alignSelf: "flex-start",
                      padding: "2px 14px",
                      borderRadius: 999,
                      border: `2px solid ${C.cyan}`,
                      color: C.cyan,
                      fontSize: 18,
                      fontWeight: 900,
                    }}
                  >
                    1st
                  </div>
                  <div style={{ display: "flex", fontSize: leaderName.fontSize, fontWeight: 900, lineHeight: 1.1 }}>
                    {leaderName.text}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <PosPill position={leader.position} />
                    {leader.nflTeam && (
                      <div style={{ display: "flex", color: C.inkMuted, fontSize: 20, fontWeight: 700 }}>{leader.nflTeam}</div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 18 }}>
                <div style={{ display: "flex", fontSize: 72, fontWeight: 900, color: C.cyan, letterSpacing: -2 }}>
                  {leader.points.toFixed(1)}
                </div>
                <div style={{ display: "flex", fontSize: 20, color: C.inkMuted, fontWeight: 700 }}>pts</div>
              </div>
              <div style={{ display: "flex", marginTop: 4 }}>
                <OwnerLine row={leader} size={20} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 10 }}>
            {rest.map((row, i) => (
              <div
                key={row.sleeperId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "10px 18px",
                  borderRadius: 18,
                  background: PANEL,
                  border: `1px solid ${C.line}`,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: 40,
                    justifyContent: "center",
                    fontSize: 30,
                    fontWeight: 900,
                    color: i === 0 ? C.cyan : i === 1 ? C.purple : C.inkSubtle,
                  }}
                >
                  {String(row.rank)}
                </div>
                <Photo src={photos[i + 1]} size={60} radius={12} />
                <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4 }}>
                  <div style={{ display: "flex", fontSize: 26, fontWeight: 900 }}>{clip(row.name, 24)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <PosPill position={row.position} />
                    {row.nflTeam && (
                      <div style={{ display: "flex", color: C.inkSubtle, fontSize: 18, fontWeight: 700 }}>{row.nflTeam}</div>
                    )}
                    <OwnerLine row={row} size={18} />
                  </div>
                </div>
                <div style={{ display: "flex", fontSize: 34, fontWeight: 900, letterSpacing: -1 }}>
                  {row.points.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
            color: C.inkMuted,
            fontSize: 20,
            fontWeight: 500,
          }}
        >
          <div style={{ display: "flex" }}>
            {card.highScore
              ? `High team score: ${clip(card.highScore.teamName, 28)}, ${card.highScore.points.toFixed(1)} in week ${card.highScore.week}`
              : "Every player counts, rostered or not"}
          </div>
          <div style={{ display: "flex", color: C.ink, fontWeight: 900 }}>ffbeacon.com</div>
        </div>
      </div>
    ),
    ogResponseOptions(LONG_CACHE),
  );
}
