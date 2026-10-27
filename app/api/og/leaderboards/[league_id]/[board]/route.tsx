import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidLeagueId } from "@/lib/on-the-clock/validation";
import { isWeekSettled, loadLeaderboardsCached } from "@/lib/league-leaderboards/load";
import {
  buildBoardShareCard,
  isShareBoard,
  type BoardShareCard,
  type GameShareEntry,
  type GameShareSide,
  type PlayerShareEntry,
  type TeamShareEntry,
} from "@/lib/league-leaderboards/board-share";
import type { LeaderboardPosition } from "@/lib/league-leaderboards/types";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
import { loadRemoteImages, sleeperPlayerImageUrl } from "@/lib/og/assets";
import { sleeperAvatarUrl } from "@/lib/sleeper-avatar-url";
import {
  fitText,
  OG_COLORS as C,
  OG_GRADIENT,
  OG_POSITION_COLORS,
  OG_ROOT_STYLE,
  OG_SIZE,
  OgAccentBar,
  OgBrandMark,
  ogResponseOptions,
} from "@/lib/og/brand";
import { clip } from "@/lib/og/display-name";
import { renderHeadlineCard } from "@/lib/og/headline-card";

export const runtime = "nodejs";

/**
 * GET /api/og/leaderboards/[league_id]/[board]?week=N&pos=QB
 *
 * One share image per Leaderboards list. `board` is one of SHARE_BOARDS in
 * lib/league-leaderboards/board-share.ts, which decides what goes on the card;
 * this file only draws it. Three layouts:
 *
 * - players: first place featured with his photo, second and third as smaller
 *   cards, fourth through twelfth as a compact list. 1200x630.
 * - teams: every team, one column up to six, two columns past that. The image
 *   grows taller rather than dropping a team, so a 16-team league still fits.
 * - games: both sides and the margin (or the combined total), one row a game.
 *
 * Reads the same ten-minute cached view the page renders from and never starts
 * a league sync, so a crawler cannot make the site call Sleeper. FF Beacon brand
 * only: the beacon gradient, Geist, the wordmark. No gold.
 */

// Ten minutes, the same as the view it is drawn from. Owners and the unowned
// list move with every waiver claim, and the copy button reads its sentence off
// the page's current view, so a picture cached for an hour could say something
// different from the sentence announced with it.
const LONG_CACHE = "public, s-maxage=600, stale-while-revalidate=600";
const SHORT_CACHE = "public, s-maxage=300, stale-while-revalidate=600";
const PANEL = "#0B0B14";
const PAD_X = 46;
/** Height left for the body on a 630 card, after header, title and footer. */
const BODY_H = 370;

function intParam(raw: string | null): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 25 ? n : null;
}

function posParam(raw: string | null): LeaderboardPosition | null {
  // Only a real position survives canonicalization, so pos cannot mint cache keys.
  return raw && (PULSE_POSITIONS as string[]).includes(raw) ? (raw as LeaderboardPosition) : null;
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

function Img({ src, size, radius }: { src: string | null; size: number; radius: number }) {
  if (!src) {
    return <div style={{ display: "flex", width: size, height: size, borderRadius: radius, background: C.line, flexShrink: 0 }} />;
  }
  return (
    // Satori draws this into a PNG; next/image has nothing to optimize here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", background: C.line, flexShrink: 0 }} />
  );
}

function PosPill({ position, size = 16 }: { position: string; size?: number }) {
  const color = OG_POSITION_COLORS[position] ?? C.inkMuted;
  return (
    <div
      style={{
        display: "flex",
        padding: `1px ${Math.round(size * 0.5)}px`,
        borderRadius: 7,
        border: `2px solid ${color}`,
        color,
        fontSize: size,
        fontWeight: 900,
        flexShrink: 0,
      }}
    >
      {position}
    </div>
  );
}

function Tag({ text, color = C.inkMuted, size = 15 }: { text: string; color?: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "1px 10px",
        borderRadius: 999,
        border: `1.5px solid ${C.line}`,
        color,
        fontSize: size,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {text}
    </div>
  );
}

const PLAYOFF_COLOR = C.purple;

/** "on Team", "Free agent", "for Team", "benched by Team". */
function ownerText(e: PlayerShareEntry, max: number): string {
  if (!e.ownerName) return "Free agent";
  const verb = e.week !== null ? (e.started === false ? "benched by" : "for") : "on";
  return `${verb} ${clip(e.ownerName, max)}`;
}

function rankColor(rank: number): string {
  return rank === 1 ? C.cyan : rank === 2 ? C.purple : rank === 3 ? C.ink : C.inkSubtle;
}

function Frame({
  card,
  leagueName,
  children,
}: {
  card: BoardShareCard;
  leagueName: string;
  children: ReactElement;
}) {
  const league = fitText(leagueName, { width: 560, maxSize: 24, minSize: 16, maxLines: 1, weight: 500 });
  const title = fitText(card.title, { width: 760, maxSize: 46, minSize: 32, maxLines: 1 });
  return (
    <div style={{ ...OG_ROOT_STYLE, padding: `32px ${PAD_X}px 26px ${PAD_X}px` }}>
      <OgAccentBar />
      <div
        style={{
          position: "absolute",
          top: -170,
          left: -130,
          width: 560,
          height: 560,
          borderRadius: 280,
          background: "radial-gradient(circle, rgba(168,85,247,0.28) 0%, rgba(168,85,247,0) 70%)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <OgBrandMark size={32} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", color: C.cyan, fontSize: 15, fontWeight: 900, letterSpacing: 3 }}>LEADERBOARDS</div>
          <div style={{ display: "flex", color: C.inkMuted, fontSize: league.fontSize, fontWeight: 500 }}>{league.text}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
        <div style={{ display: "flex", fontSize: title.fontSize, fontWeight: 900, letterSpacing: -1 }}>{title.text}</div>
        <Tag text={card.scope} color={C.cyan} size={17} />
        {card.playoff && <Tag text="Playoffs" color={PLAYOFF_COLOR} size={17} />}
      </div>
      <div style={{ display: "flex", color: C.inkMuted, fontSize: 19, fontWeight: 500, marginTop: 2 }}>
        {clip(card.subtitle, 96)}
      </div>

      <div style={{ display: "flex", flex: 1, marginTop: 16 }}>{children}</div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, color: C.ink, fontSize: 19, fontWeight: 900 }}>
        ffbeacon.com
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- players

function Featured({ e, photo }: { e: PlayerShareEntry; photo: string | null }) {
  const name = fitText(e.name, { width: 170, maxSize: 30, minSize: 20, maxLines: 2 });
  return (
    <div style={{ display: "flex", width: 340, padding: 3, borderRadius: 24, background: OG_GRADIENT, flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          borderRadius: 21,
          background: PANEL,
          padding: "18px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", padding: 4, borderRadius: 20, background: OG_GRADIENT }}>
            <Img src={photo} size={104} radius={16} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 7 }}>
            {/* A row of its own, so the chip keeps its own width inside the column. */}
            <div style={{ display: "flex" }}>
              <Tag text={e.rank === 1 ? "1st" : `#${e.rank}`} color={C.cyan} size={16} />
            </div>
            <div style={{ display: "flex", fontSize: name.fontSize, fontWeight: 900, lineHeight: 1.1 }}>{name.text}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <PosPill position={e.position} />
              {e.nflTeam && <div style={{ display: "flex", color: C.inkMuted, fontSize: 17, fontWeight: 700 }}>{e.nflTeam}</div>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
          <div style={{ display: "flex", fontSize: 66, fontWeight: 900, color: C.cyan, letterSpacing: -2 }}>{e.points.toFixed(1)}</div>
          <div style={{ display: "flex", fontSize: 19, color: C.inkMuted, fontWeight: 700 }}>pts</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 }}>
          {e.week !== null && <Tag text={`Week ${e.week}`} />}
          {e.playoff && <Tag text="Playoffs" color={PLAYOFF_COLOR} />}
          {e.perGame !== null && e.games !== null && e.games > 1 && (
            <div style={{ display: "flex", color: C.inkMuted, fontSize: 17, fontWeight: 500 }}>
              {`${e.perGame.toFixed(1)} a game, ${e.games} ${e.games === 1 ? "game" : "games"}`}
            </div>
          )}
        </div>
        <div style={{ display: "flex", marginTop: 6, color: e.ownerName ? C.ink : C.inkMuted, fontSize: 19, fontWeight: 700 }}>
          {ownerText(e, 24)}
        </div>
      </div>
    </div>
  );
}

function RunnerUp({ e, photo }: { e: PlayerShareEntry; photo: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flex: 1,
        padding: "12px 16px",
        borderRadius: 20,
        background: PANEL,
        border: `2px solid ${e.rank === 2 ? "rgba(168,85,247,0.55)" : C.line}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Img src={photo} size={64} radius={12} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 900, color: rankColor(e.rank) }}>{`#${e.rank}`}</div>
            <PosPill position={e.position} size={14} />
            {e.nflTeam && <div style={{ display: "flex", color: C.inkSubtle, fontSize: 15, fontWeight: 700 }}>{e.nflTeam}</div>}
          </div>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 900 }}>{clip(e.name, 20)}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 900, letterSpacing: -1 }}>{e.points.toFixed(1)}</div>
          <div style={{ display: "flex", fontSize: 15, color: C.inkMuted, fontWeight: 700 }}>pts</div>
        </div>
        {e.week !== null && <Tag text={`Wk ${e.week}`} size={14} />}
      </div>
      <div style={{ display: "flex", color: e.ownerName ? C.inkMuted : C.inkSubtle, fontSize: 16, fontWeight: 600 }}>
        {ownerText(e, 26)}
      </div>
    </div>
  );
}

function CompactRow({ e }: { e: PlayerShareEntry }) {
  const meta = [e.nflTeam, e.week !== null ? `Wk ${e.week}` : null, ownerText(e, 20)].filter(Boolean).join("   ");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flex: 1,
        padding: "0 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${C.line}`,
      }}
    >
      <div style={{ display: "flex", width: 30, justifyContent: "center", fontSize: 19, fontWeight: 900, color: C.inkSubtle }}>
        {String(e.rank)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 900 }}>{clip(e.name, 22)}</div>
          <PosPill position={e.position} size={11} />
        </div>
        <div style={{ display: "flex", fontSize: 13, color: C.inkSubtle, fontWeight: 600 }}>{meta}</div>
      </div>
      <div style={{ display: "flex", fontSize: 21, fontWeight: 900, letterSpacing: -0.5 }}>{e.points.toFixed(1)}</div>
    </div>
  );
}

function PlayersBody({ entries, photos }: { entries: PlayerShareEntry[]; photos: (string | null)[] }) {
  const [first, ...others] = entries;
  const runners = others.slice(0, 2);
  const rest = others.slice(2);
  return (
    <div style={{ display: "flex", gap: 18, width: "100%" }}>
      <Featured e={first} photo={photos[0]} />
      {runners.length > 0 && (
        // Satori fails on a style key set to undefined, so the two shapes are
        // spelled out rather than toggled.
        <div style={rest.length > 0 ? { display: "flex", flexDirection: "column", gap: 14, width: 300 } : { display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
          {runners.map((e, i) => (
            <RunnerUp key={`${e.sleeperId}-${e.week ?? ""}`} e={e} photo={photos[i + 1]} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 5 }}>
          {rest.map((e) => (
            <CompactRow key={`${e.sleeperId}-${e.week ?? ""}`} e={e} />
          ))}
          {/* Spacers keep a short list's rows the same height as a full one's. */}
          {Array.from({ length: Math.max(0, 9 - rest.length) }, (_, i) => (
            <div key={`gap-${i}`} style={{ display: "flex", flex: 1 }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- teams

/** One fetch per distinct URL, mapped back in order. Teams repeat on a games card. */
async function loadDistinct(urls: (string | null)[]): Promise<(string | null)[]> {
  const distinct = [...new Set(urls.filter((u): u is string => u !== null))];
  const loaded = await loadRemoteImages(distinct, { timeoutMs: 1500 });
  const byUrl = new Map(distinct.map((u, i) => [u, loaded[i]]));
  return urls.map((u) => (u ? (byUrl.get(u) ?? null) : null));
}

function teamLayout(count: number): { columns: number; perColumn: number; rowH: number; height: number } {
  const columns = count > 6 ? 2 : 1;
  const perColumn = Math.max(1, Math.ceil(count / columns));
  const gap = 10;
  const fit = Math.floor((BODY_H - gap * (perColumn - 1)) / perColumn);
  const rowH = Math.max(50, Math.min(columns === 1 ? 70 : 64, fit));
  const need = perColumn * rowH + gap * (perColumn - 1);
  return { columns, perColumn, rowH, height: OG_SIZE.height + Math.max(0, need - BODY_H) };
}

function TeamRow({ e, avatar, rowH, wide }: { e: TeamShareEntry; avatar: string | null; rowH: number; wide: boolean }) {
  const lead = e.rank === 1;
  const nameSize = rowH >= 60 ? 23 : 20;
  const detail = e.breakdown.length > 0;
  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        height: "100%",
        padding: "0 16px",
        borderRadius: lead ? 13 : 14,
        background: PANEL,
        border: lead ? "none" : `1px solid ${C.line}`,
      }}
    >
      <div style={{ display: "flex", width: 34, justifyContent: "center", fontSize: 24, fontWeight: 900, color: rankColor(e.rank) }}>
        {String(e.rank)}
      </div>
      <Img src={avatar} size={rowH >= 60 ? 40 : 34} radius={999} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 3 }}>
        <div style={{ display: "flex", fontSize: nameSize, fontWeight: 900 }}>{clip(e.teamName, wide ? 40 : 24)}</div>
        {(e.week !== null || detail) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {e.week !== null && <Tag text={`Week ${e.week}`} size={13} />}
            {e.playoff && <Tag text="Playoffs" color={PLAYOFF_COLOR} size={13} />}
            {e.breakdown.slice(0, wide ? 9 : 6).map((b) => (
              <div key={b.position} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <PosPill position={b.position} size={11} />
                <div style={{ display: "flex", fontSize: 14, fontWeight: 700, color: C.inkMuted }}>{String(b.count)}</div>
              </div>
            ))}
            {/* Never dropped silently: a narrow row says how many positions it could not draw. */}
            {e.breakdown.length > (wide ? 9 : 6) && (
              <div style={{ display: "flex", fontSize: 14, fontWeight: 700, color: C.inkSubtle }}>
                {`+${e.breakdown.length - (wide ? 9 : 6)} more`}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div style={{ display: "flex", fontSize: rowH >= 60 ? 30 : 26, fontWeight: 900, color: lead ? C.cyan : C.ink, letterSpacing: -0.5 }}>
          {e.valueText}
        </div>
        <div style={{ display: "flex", fontSize: 14, color: C.inkSubtle, fontWeight: 700 }}>{e.unit === "points" ? "pts" : e.unit}</div>
      </div>
    </div>
  );
  if (!lead) return <div style={{ display: "flex", height: rowH }}>{inner}</div>;
  return <div style={{ display: "flex", height: rowH, padding: 2, borderRadius: 15, background: OG_GRADIENT }}>{inner}</div>;
}

function TeamsBody({ entries, avatars }: { entries: TeamShareEntry[]; avatars: (string | null)[] }) {
  const layout = teamLayout(entries.length);
  const columns = Array.from({ length: layout.columns }, (_, c) =>
    entries.slice(c * layout.perColumn, (c + 1) * layout.perColumn).map((e, i) => ({ e, a: avatars[c * layout.perColumn + i] })),
  );
  return (
    <div style={{ display: "flex", gap: 18, width: "100%" }}>
      {columns.map((col, c) => (
        <div key={c} style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          {col.map(({ e, a }) => (
            <TeamRow key={`${e.teamName}-${e.week ?? ""}-${e.rank}`} e={e} avatar={a} rowH={layout.rowH} wide={layout.columns === 1} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- games

function GameSide({ side, avatar }: { side: GameShareSide; avatar: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Img src={avatar} size={26} radius={999} />
      <div style={{ display: "flex", flex: 1, fontSize: 21, fontWeight: side.won ? 900 : 500, color: side.won ? C.ink : C.inkMuted }}>
        {clip(side.teamName, 40)}
      </div>
      <div style={{ display: "flex", fontSize: 21, fontWeight: side.won ? 900 : 500, color: side.won ? C.ink : C.inkMuted }}>
        {side.points.toFixed(1)}
      </div>
    </div>
  );
}

function GamesBody({ entries, figureLabel, avatars }: { entries: GameShareEntry[]; figureLabel: string; avatars: (string | null)[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      {entries.map((g, i) => {
        const lead = g.rank === 1;
        const row = (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22,
              width: "100%",
              height: "100%",
              padding: "0 20px",
              borderRadius: lead ? 14 : 15,
              background: PANEL,
              border: lead ? "none" : `1px solid ${C.line}`,
            }}
          >
            <div style={{ display: "flex", width: 34, justifyContent: "center", fontSize: 24, fontWeight: 900, color: rankColor(g.rank) }}>
              {String(g.rank)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 130 }}>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 900, color: lead ? C.cyan : C.ink, letterSpacing: -1 }}>
                {g.figure.toFixed(1)}
              </div>
              <div style={{ display: "flex", fontSize: 13, fontWeight: 700, color: C.inkSubtle, letterSpacing: 2 }}>
                {figureLabel.toUpperCase()}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4 }}>
              <GameSide side={g.home} avatar={avatars[i * 2]} />
              <GameSide side={g.away} avatar={avatars[i * 2 + 1]} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, width: 110 }}>
              <Tag text={`Week ${g.week}`} />
              {g.playoff && <Tag text="Playoffs" color={PLAYOFF_COLOR} />}
            </div>
          </div>
        );
        return lead ? (
          <div key={`${g.week}-${g.rank}`} style={{ display: "flex", flex: 1, padding: 2, borderRadius: 16, background: OG_GRADIENT }}>{row}</div>
        ) : (
          <div key={`${g.week}-${g.rank}`} style={{ display: "flex", flex: 1 }}>{row}</div>
        );
      })}
      {Array.from({ length: Math.max(0, 5 - entries.length) }, (_, i) => (
        <div key={`gap-${i}`} style={{ display: "flex", flex: 1 }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- route

export async function GET(
  request: Request,
  { params }: { params: Promise<{ league_id: string; board: string }> },
) {
  const { league_id: sleeperLeagueId, board } = await params;
  if (!isValidLeagueId(sleeperLeagueId)) return new Response("Invalid league id", { status: 400 });
  if (!isShareBoard(board)) return new Response("Unknown board", { status: 404 });

  // ONE URL PER CARD. Anything but `?week=N` and, on the points board,
  // `&pos=XX` is sent to its canonical form, so a junk query string cannot mint
  // a fresh edge cache entry and a fresh render for the same picture.
  const url = new URL(request.url);
  const week = intParam(url.searchParams.get("week"));
  const pos = board === "points" ? posParam(url.searchParams.get("pos")) : null;
  const canonicalParams = new URLSearchParams();
  if (week !== null) canonicalParams.set("week", String(week));
  if (pos) canonicalParams.set("pos", pos);
  const canonical = canonicalParams.toString() ? `?${canonicalParams.toString()}` : "";
  if (url.search !== canonical) {
    return Response.redirect(new URL(`${url.pathname}${canonical}`, url), 308);
  }

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("id, name, season")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) return placeholder("League", "not found", "Open the league in League Pulse to build its leaderboards.");

  // A week that has not settled is refused BEFORE its view is built: the
  // builder would fall back to a whole season and cache it under that week.
  // isWeekSettled is a live count, so a week that just went final is never
  // refused because a cached view has not caught up.
  let view;
  try {
    if (week !== null && league.season != null && !(await isWeekSettled(league.id, Number(league.season), week))) {
      return placeholder(clip(league.name, 40), `Week ${week} is not final`, "This week has no final results in this league yet.");
    }
    view = await loadLeaderboardsCached(league.id, week);
  } catch (error) {
    console.error("[og/leaderboards/board] load failed", error);
    view = null;
  }
  if (!view || view.settledWeeks.length === 0) {
    return placeholder(clip(league.name, 40), "Leaderboards", "They fill in once week 1 is final in this league.");
  }

  const card = buildBoardShareCard(view, board, pos);
  if (!card) {
    return placeholder(clip(league.name, 40), "Leaderboards", "This list is not part of the leaderboards for this league and range.");
  }
  if (card.entries.length === 0) {
    return placeholder(clip(league.name, 40), card.title, "Nothing on this board yet.");
  }

  const leagueName = league.name;

  if (card.kind === "players") {
    const photos = await loadRemoteImages(
      card.entries.slice(0, 3).map((e) => sleeperPlayerImageUrl(e.sleeperId, e.position)),
    );
    return new ImageResponse(
      (
        <Frame card={card} leagueName={leagueName}>
          <PlayersBody entries={card.entries} photos={photos} />
        </Frame>
      ),
      ogResponseOptions(LONG_CACHE),
    );
  }

  if (card.kind === "teams") {
    const avatars = await loadDistinct(card.entries.map((e) => sleeperAvatarUrl(e.avatarId, "thumb")));
    const { height } = teamLayout(card.entries.length);
    return new ImageResponse(
      (
        <Frame card={card} leagueName={leagueName}>
          <TeamsBody entries={card.entries} avatars={avatars} />
        </Frame>
      ),
      { ...ogResponseOptions(LONG_CACHE), height },
    );
  }

  const avatars = await loadDistinct(
    card.entries.flatMap((g) => [sleeperAvatarUrl(g.home.avatarId, "thumb"), sleeperAvatarUrl(g.away.avatarId, "thumb")]),
  );
  return new ImageResponse(
    (
      <Frame card={card} leagueName={leagueName}>
        <GamesBody entries={card.entries} figureLabel={card.figureLabel} avatars={avatars} />
      </Frame>
    ),
    ogResponseOptions(LONG_CACHE),
  );
}
