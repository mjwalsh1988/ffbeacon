/**
 * Team Blueprint share images (plan section 11): shared loading and the two
 * renderers. Both routes READ ONLY: one leagues row, one rosters row and one
 * league_blueprint_cache row. No engine, no derived sync, no Sleeper call. A
 * page and its picture show the same numbers because both draw the stored
 * view.
 *
 * Both pictures are the page's report card in picture form: an FF Beacon
 * brand band first (the site is free, and a shared picture is where it gets
 * seen), then a letterhead with the team and the grade box, then ruled
 * two-column sections with the label in a margin column and the content in
 * the body column, so every figure sits on the same two vertical lines.
 *
 * Brand: FF Beacon dark, purple to cyan, Geist; no DPC colors or wording. The
 * gradient appears on the overall grade, the rank numerals and the bar fills.
 */

import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";
import { ordinal } from "@/lib/league-team-status";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { readCachedBlueprint } from "@/lib/league-blueprint/cache";
import { buildBlueprintShareCard, type BlueprintShareCard } from "@/lib/league-blueprint/share";
import { SHARE_GAP, SHARE_WIDTH, shareLayout } from "@/lib/league-blueprint/share-layout";
import { ringRowSvg, ringRowWidth } from "@/lib/league-blueprint/ring-geometry";
import { gaugeGeometry, gaugeSvg } from "@/lib/league-blueprint/gauge-geometry";
import { loadRemoteImages, OG_FONTS, sleeperPlayerImageUrl } from "@/lib/og/assets";
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
import { svgToDataUri } from "@/app/api/og/war/[league_id]/card";
import type { SleeperLeague } from "@/lib/sleeper";

export const SUCCESS_CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
export const MISSING_ROW_CACHE = "public, max-age=60, s-maxage=300";
export const MISSING_LEAGUE_CACHE = "public, max-age=0, s-maxage=60";

/** The tools the brand band advertises, in the site's own display order. */
export const SHARE_TOOLS = ["League Pulse", "Trade Calculator", "Rankings Builder", "Manager Pulse", "On The Clock", "Start / Sit"];
export const SHARE_TAGLINE = "Free fantasy football tools for Sleeper leagues";

const LINE_ACCENT = "#2A2A47";
const WARNING = "#F59E0B";

export type BlueprintImageLoad =
  | { kind: "response"; response: Response }
  | { kind: "card"; card: BlueprintShareCard };

function withStatus(img: ImageResponse, status: number): Response {
  return new Response(img.body, { status, headers: img.headers });
}

/** Validate, canonicalize and read. Everything the two routes share. */
export async function loadBlueprintImage(
  request: Request,
  leagueId: string,
  rosterIdRaw: string,
): Promise<BlueprintImageLoad> {
  if (!/^\d{1,20}$/.test(leagueId) || !/^\d{1,3}$/.test(rosterIdRaw)) {
    return { kind: "response", response: new Response("Invalid league or roster id", { status: 400 }) };
  }
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const validSource = source && /^[a-z0-9-]{1,40}$/.test(source) ? source : null;
  const canonical = validSource ? `?source=${validSource}` : "";
  if (url.search !== canonical) {
    return {
      kind: "response",
      response: Response.redirect(new URL(`${url.pathname}${canonical}`, url), 308),
    };
  }

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("id, name, season, status, metadata")
    .eq("sleeper_league_id", leagueId)
    .maybeSingle();
  if (!league) {
    const img = renderHeadlineCard(
      {
        eyebrow: "Team Blueprint",
        headlineTop: "League",
        headlineBottom: "not found",
        subhead: "Open the league in League Pulse to build its blueprints.",
        footerLeft: "ffbeacon.com/tools/league-pulse",
        badge: "Blueprint",
      },
      MISSING_LEAGUE_CACHE,
    );
    return { kind: "response", response: withStatus(img, 404) };
  }

  const rosterId = Number(rosterIdRaw);
  const context = await resolveLeagueContext(admin, league.metadata as unknown as SleeperLeague, validSource);
  const season = String(league.season ?? new Date().getUTCFullYear());
  const cached =
    context.coverage === "none"
      ? null
      : await readCachedBlueprint(admin, { leagueRowId: league.id, rosterId, season, source: context.sourceSlug });
  if (!cached) {
    const teamName = await rosterTeamName(admin, league.id, rosterId);
    const img = renderHeadlineCard(
      {
        eyebrow: "Team Blueprint",
        headlineTop: clip(teamName, 30),
        headlineBottom: "Team Blueprint",
        subhead: "Open the blueprint page to build it, then share.",
        footerLeft: "ffbeacon.com/tools/league-pulse",
        badge: "Blueprint",
      },
      MISSING_ROW_CACHE,
    );
    return { kind: "response", response: img };
  }
  return { kind: "card", card: buildBlueprintShareCard(cached.view, { leagueName: league.name }) };
}

async function rosterTeamName(
  admin: ReturnType<typeof createAdminClient>,
  leagueRowId: string,
  rosterId: number,
): Promise<string> {
  const { data: roster } = await admin
    .from("rosters")
    .select("owner_user_id")
    .eq("league_id", leagueRowId)
    .eq("sleeper_roster_id", rosterId)
    .maybeSingle();
  if (!roster?.owner_user_id) return "This team";
  const { data: user } = await admin
    .from("league_users")
    .select("team_name, display_name")
    .eq("league_id", leagueRowId)
    .eq("sleeper_user_id", roster.owner_user_id)
    .maybeSingle();
  return user?.team_name || user?.display_name || "This team";
}

// ---- shared pieces ---------------------------------------------------------

const RING_OPTS = { stroke: 7, trackColor: C.line, fromColor: C.purple, toColor: C.cyan };

function Pill({ text, size = 20 }: { text: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        padding: `${Math.round(size * 0.3)}px ${Math.round(size * 0.7)}px`,
        borderRadius: 999,
        border: `1px solid ${C.line}`,
        color: C.ink,
        fontSize: size,
        fontWeight: 500,
      }}
    >
      {text}
    </div>
  );
}

/** A small uppercase label, the kind a form prints beside a blank. */
function Label({ children, size = 15, color = C.inkSubtle }: { children: string; size?: number; color?: string }) {
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: 900, color, letterSpacing: "0.14em", textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

/**
 * The FF Beacon band across the top of both pictures: the mark and the
 * wordmark, the tagline, and the tools as pills, with a rule under it.
 */
function BrandBand({ width, height, pillSize, tools }: { width: number; height: number; pillSize: number; tools: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width, height }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", width }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <OgBrandMark size={pillSize >= 16 ? 42 : 36} />
          <div style={{ display: "flex", marginTop: 8, fontSize: pillSize + 2, color: C.inkMuted }}>{SHARE_TAGLINE}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <Label size={pillSize - 3} color={C.cyan}>Free tools</Label>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 8, maxWidth: Math.round(width * 0.58) }}>
            {tools.map((t) => (
              <Pill key={t} text={t} size={pillSize} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", width, height: 1, background: LINE_ACCENT }} />
    </div>
  );
}

/** A label, a leader line and a value, the way a printed form draws one. */
function LeaderRow({ label, value, width, size = 18 }: { label: string; value: string; width: number; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", width, height: Math.round(size * 1.7) }}>
      <Label size={Math.round(size * 0.72)}>{label}</Label>
      <div style={{ display: "flex", flex: 1, height: 1, marginLeft: 10, marginRight: 10, marginBottom: 5, borderBottom: `1px solid ${LINE_ACCENT}` }} />
      <div style={{ display: "flex", fontSize: size, fontWeight: 500, color: C.ink, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

/** The overall grade in a grade box, the report card's mark. */
function GradeBox({ overall, width, numberSize }: { overall: number; width: number; numberSize: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width,
        padding: "22px 16px 20px 16px",
        border: `2px solid ${LINE_ACCENT}`,
        borderRadius: 18,
        background: "rgba(7,7,13,0.45)",
      }}
    >
      <Label size={15} color={C.cyan}>Overall grade</Label>
      <div
        style={{
          display: "flex",
          marginTop: 6,
          fontSize: numberSize,
          fontWeight: 900,
          lineHeight: 1,
          paddingBottom: 6,
          backgroundImage: OG_GRADIENT,
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {overall.toFixed(1)}
      </div>
      <Label size={13}>of 10</Label>
    </div>
  );
}

function Rings({ card, size, gap }: { card: BlueprintShareCard; size: number; gap: number }) {
  const width = ringRowWidth(card.grades.length, size, gap);
  const svg = ringRowSvg(
    card.grades.map((g) => g.grade),
    { size, gap, ...RING_OPTS },
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", width }}>
      <div style={{ display: "flex", position: "relative", width, height: size }}>
        {/* Satori renders plain img elements only (next/image cannot run
            inside an ImageResponse), and needs a width and height on each. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgToDataUri(svg)} width={width} height={size} style={{ width, height: size }} alt="" />
        {card.grades.map((g, i) => (
          <div
            key={g.code}
            style={{
              display: "flex",
              position: "absolute",
              left: i * (size + gap),
              top: 0,
              width: size,
              height: size,
              alignItems: "center",
              justifyContent: "center",
              fontSize: Math.round(size * 0.36),
              fontWeight: 900,
              color: g.grade === null ? C.inkSubtle : C.ink,
            }}
          >
            {g.grade === null ? "-" : String(g.grade)}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 8 }}>
        {card.grades.map((g, i) => (
          <div
            key={g.code}
            style={{
              display: "flex",
              width: size,
              marginLeft: i === 0 ? 0 : gap,
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 900,
              color: C.inkMuted,
              letterSpacing: "0.12em",
            }}
          >
            {g.code}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A thin bar filled to a fraction of its track, with an optional mark. */
function Bar({ fraction, width, height = 8, fill = OG_GRADIENT, mark }: { fraction: number; width: number; height?: number; fill?: string; mark?: number }) {
  const f = Math.min(1, Math.max(0, fraction));
  return (
    <div style={{ display: "flex", position: "relative", width, height, borderRadius: 999, background: "rgba(255,255,255,0.08)" }}>
      <div style={{ display: "flex", width: Math.round(width * f), height, borderRadius: 999, background: fill }} />
      {mark !== undefined && (
        <div style={{ display: "flex", position: "absolute", left: Math.round(width * Math.min(1, Math.max(0, mark))) - 1, top: -3, width: 2, height: height + 6, background: "rgba(244,244,248,0.7)" }} />
      )}
    </div>
  );
}

/**
 * The slot column is 60px wide. SUPERFLEX is the one shared label that does not
 * fit, so the image prints the SF the page already uses on a phone.
 */
function shareSlotLabel(label: string): string {
  return label === "SUPERFLEX" ? "SF" : label;
}

function pct(v: number | null): string {
  return v === null ? "None" : `${v.toFixed(1)}%`;
}

function ordinalShort(n: number | null, of: number): string {
  return n === null ? "Unranked" : `${ordinal(n)} of ${of}`;
}

function priorityText(p: string): string {
  return clip(p, 140);
}

function strategyText(s: BlueprintShareCard["strategy"][number]): string {
  return s.empty ? clip(s.empty, 110) : clip(`${s.out} for ${s.in}${s.verdict ? `. ${s.verdict}` : ""}`, 120);
}

function metaLine(card: BlueprintShareCard, max: number): string {
  return clip(
    [card.ownerHandle ? `@${card.ownerHandle}` : null, card.record, card.leagueName]
      .filter(Boolean)
      .join("  /  "),
    max,
  );
}

// ---- 1200 x 630 link preview -----------------------------------------------

/** 1200 x 630 link preview (plan 11.2). */
export function renderPreview(card: BlueprintShareCard): ImageResponse {
  const W = 1200 - 80;
  const leftW = 700;
  const name = fitText(card.teamName, { width: leftW, maxSize: 58, minSize: 34, maxLines: 2 });
  const first = fitText(card.priorities[0] ?? "", { width: leftW, maxSize: 24, minSize: 20, maxLines: 2, weight: 500 });
  const rest = card.priorities.slice(1, 3).map((p) => fitText(p, { width: leftW - 36, maxSize: 19, minSize: 19, maxLines: 2, weight: 500 }));
  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "30px 40px 0 40px" }}>
        <OgAccentBar />
        <BrandBand width={W} height={92} pillSize={15} tools={SHARE_TOOLS.slice(0, 5)} />

        <div style={{ display: "flex", flex: 1, paddingTop: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", width: leftW }}>
            <Label size={17} color={C.cyan}>Team Blueprint</Label>
            <div style={{ display: "flex", marginTop: 10, fontSize: name.fontSize, fontWeight: 900, lineHeight: 1.05, letterSpacing: -1 }}>
              {name.text}
            </div>
            <div style={{ display: "flex", marginTop: 10, fontSize: 19, color: C.inkMuted }}>{metaLine(card, 70)}</div>
            <div style={{ display: "flex", gap: 24, marginTop: 14 }}>
              <LeaderRow label="Standing" value={clip(card.statusLabel ?? "Not computed yet", 22)} width={(leftW - 24) / 2} size={17} />
              <LeaderRow label="Format" value={clip(card.formatDisplay, 24)} width={(leftW - 24) / 2} size={17} />
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              <LeaderRow label="Roster" value={clip(card.rosterArchetype, 22)} width={(leftW - 24) / 2} size={17} />
              <LeaderRow label="Values" value={clip(card.sourceDisplay, 24)} width={(leftW - 24) / 2} size={17} />
            </div>
            {first.text && (
              <div style={{ display: "flex", marginTop: 22, alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "flex", fontSize: 24, fontWeight: 900, backgroundImage: OG_GRADIENT, backgroundClip: "text", color: "transparent" }}>1</div>
                <div style={{ display: "flex", flex: 1, fontSize: first.fontSize, fontWeight: 500, color: C.ink, lineHeight: 1.3 }}>
                  {first.text}
                </div>
              </div>
            )}
            {rest.map((r, i) => (
              <div key={i} style={{ display: "flex", marginTop: 10, alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "flex", width: 24, fontSize: 19, fontWeight: 900, backgroundImage: OG_GRADIENT, backgroundClip: "text", color: "transparent" }}>{String(i + 2)}</div>
                <div style={{ display: "flex", flex: 1, fontSize: 19, fontWeight: 500, color: C.inkMuted, lineHeight: 1.3 }}>{r.text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginLeft: "auto", width: 380 }}>
            <GradeBox overall={card.overall} width={250} numberSize={120} />
            <div style={{ display: "flex", marginTop: 18 }}>
              <Rings card={card} size={48} gap={10} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", height: 58, alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", fontSize: 17, color: C.inkSubtle }}>
            {clip(`Prepared ${formatEastern(card.generatedAt)}. ${card.formatDisplay} values by ${card.sourceDisplay}.`, 90)}
          </div>
          <div style={{ display: "flex", fontSize: 17, fontWeight: 900, color: C.inkMuted }}>ffbeacon.com/tools/league-pulse</div>
        </div>
      </div>
    ),
    ogResponseOptions(SUCCESS_CACHE),
  );
}

// ---- portrait share card ----------------------------------------------------

const PAD = 48;
const LABEL_W = 170;

/** One ruled section: the label in the margin column, the content beside it. */
function Section({ label, height, width, children }: { label: string; height: number; width: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", width, height, borderTop: `1px solid ${C.line}`, paddingTop: 22 }}>
      <div style={{ display: "flex", width: LABEL_W, flexShrink: 0, paddingRight: 16 }}>
        <Label size={15}>{label}</Label>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Portrait share card, 1080 wide, as tall as its sections (plan 11.3). */
export async function renderPortrait(card: BlueprintShareCard): Promise<ImageResponse> {
  const W = SHARE_WIDTH - PAD * 2;
  const CW = W - LABEL_W;
  const layout = shareLayout({
    slots: card.lineup.length,
    capitalSeasons: card.capital ? card.capital.length : null,
    // Sized from the text so three short priorities do not leave a blank band.
    priorityLines: card.priorities.map((p, i) => {
      const size = i === 0 ? 30 : 24;
      return fitText(priorityText(p), { width: CW - 44, maxSize: size, minSize: size, maxLines: 6, weight: i === 0 ? 900 : 500 }).lines;
    }),
    strategyLines: card.strategy.map((s) => fitText(strategyText(s), { width: CW, maxSize: 20, minSize: 20, maxLines: 4, weight: 500 }).lines),
  });
  const photos = await loadRemoteImages(card.lineup.slice(0, 12).map((r) => sleeperPlayerImageUrl(r.sleeperId, r.position)));
  const nameW = W - 280;
  const name = fitText(card.teamName, { width: nameW, maxSize: 54, minSize: 34, maxLines: 2 });
  const gaugeW = 260;
  const gaugeGeo = gaugeGeometry(card.activity.score, { width: gaugeW, stroke: 20 });
  const gauge = gaugeSvg(card.activity.score, {
    width: gaugeW,
    stroke: 20,
    trackColor: C.line,
    fromColor: C.purple,
    toColor: C.cyan,
    tickColor: C.inkSubtle,
  });
  const h = Object.fromEntries(layout.sections.map((s) => [s.key, s.height]));
  const topStarter = card.lineup.reduce((m, r) => Math.max(m, r.value ?? 0), 0);
  const even = 100 / Math.max(card.teamCount, 1);
  const shareScale = Math.max(even * 3, card.valueShare.pct ?? 0, card.productionShare.pct ?? 0);
  const moverScale = [...card.risers, ...card.fallers].reduce((m, x) => Math.max(m, Math.abs(x.pct)), 0);
  const topSeason = card.capital ? card.capital.reduce((m, s) => Math.max(m, s.value), 0) : 0;
  const splitW = CW - gaugeW - 40;

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: `${PAD}px ${PAD}px 0 ${PAD}px`, gap: SHARE_GAP }}>
        <OgAccentBar />
        <BrandBand width={W} height={h.brand} pillSize={16} tools={SHARE_TOOLS} />

        {/* Letterhead: the team at left, the grade box at right. */}
        <div style={{ display: "flex", width: W, height: h.letterhead, justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", width: nameW }}>
            <Label size={17} color={C.cyan}>Team Blueprint</Label>
            <div style={{ display: "flex", fontSize: name.fontSize, fontWeight: 900, lineHeight: 1.05, letterSpacing: -1, marginTop: 10 }}>{name.text}</div>
            <div style={{ display: "flex", fontSize: 20, color: C.inkMuted, marginTop: 10 }}>{metaLine(card, 64)}</div>
            <div style={{ display: "flex", gap: 24, marginTop: 14 }}>
              <LeaderRow label="Standing" value={clip(card.statusLabel ?? "Not computed yet", 22)} width={(nameW - 24) / 2} />
              <LeaderRow label="Format" value={clip(card.formatDisplay, 26)} width={(nameW - 24) / 2} />
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              <LeaderRow label="Roster" value={clip(card.rosterArchetype, 22)} width={(nameW - 24) / 2} />
              <LeaderRow label="Values" value={clip(card.sourceDisplay, 26)} width={(nameW - 24) / 2} />
            </div>
          </div>
          <GradeBox overall={card.overall} width={240} numberSize={116} />
        </div>

        <Section label="Grades" height={h.grades} width={W}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 36 }}>
            <Rings card={card} size={64} gap={14} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
              <div style={{ display: "flex", fontSize: 18, color: C.inkMuted }}>{clip(`Value archetype: ${card.valueArchetype ?? "not computed yet"}`, 32)}</div>
              <div style={{ display: "flex", fontSize: 18, color: C.inkMuted }}>{clip(`Outlook: ${card.outlook ?? "one season"}`, 32)}</div>
              <div style={{ display: "flex", fontSize: 16, color: C.inkSubtle }}>{`10 is the best of ${card.teamCount} teams`}</div>
            </div>
          </div>
        </Section>

        <Section label="Starting lineup" height={h.lineup} width={W}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {card.lineup.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", height: 52, gap: 14, borderBottom: i === card.lineup.length - 1 ? "none" : `1px solid rgba(31,31,51,0.7)` }}>
                <div style={{ display: "flex", width: 60, fontSize: 20, color: C.inkSubtle, fontWeight: 900 }}>{clip(shareSlotLabel(r.slotLabel), 5)}</div>
                {photos[i] ? (
                  // Satori renders plain img elements only; next/image cannot run here.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos[i]!} width={38} height={38} style={{ width: 38, height: 38, borderRadius: 8 }} alt="" />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      width: 38,
                      height: 38,
                      borderRadius: 8,
                      background: C.line,
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 900,
                      color: OG_POSITION_COLORS[r.position ?? ""] ?? C.inkMuted,
                    }}
                  >
                    {r.position ?? ""}
                  </div>
                )}
                <div style={{ display: "flex", flex: 1, fontSize: 24, fontWeight: 500 }}>{r.name ? clip(r.name, 24) : "Empty"}</div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 130 }}>
                  <div style={{ display: "flex", fontSize: 24, fontWeight: 900 }}>
                    {r.value === null ? (r.name ? "No value" : "") : r.value.toLocaleString("en-US")}
                  </div>
                  {r.value !== null && <Bar fraction={topStarter > 0 ? r.value / topStarter : 0} width={110} height={4} />}
                </div>
                <div style={{ display: "flex", width: 76, justifyContent: "flex-end", fontSize: 18, color: C.inkSubtle }}>
                  {r.positionRank !== null && r.position ? `${r.position}${r.positionRank}` : ""}
                </div>
                <div style={{ display: "flex", width: 150, justifyContent: "flex-end" }}>
                  {r.call && <Pill text={r.call} size={16} />}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section label="Share of league" height={h.shares} width={W}>
          <div style={{ display: "flex", gap: 40 }}>
            {(
              [
                ["Value share", card.valueShare],
                ["Production share", card.productionShare],
              ] as const
            ).map(([label, f]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", width: (CW - 40) / 2 }}>
                <Label size={14}>{label}</Label>
                <div style={{ display: "flex", fontSize: 54, fontWeight: 900, lineHeight: 1.05 }}>{pct(f.pct)}</div>
                <div style={{ display: "flex", fontSize: 17, color: C.inkSubtle, marginBottom: 10 }}>{ordinalShort(f.rank, card.teamCount)}</div>
                {f.pct !== null && <Bar fraction={f.pct / shareScale} width={(CW - 40) / 2} height={10} mark={even / shareScale} />}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 15, color: C.inkSubtle, marginTop: 10 }}>{`The mark on each bar is an even ${even.toFixed(1)}% share.`}</div>
        </Section>

        <Section label="Trade activity" height={h.calls} width={W}>
          <div style={{ display: "flex", gap: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", width: gaugeW }}>
              {/* Satori renders plain img elements only; next/image cannot run here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svgToDataUri(gauge)} width={gaugeW} height={gaugeGeo.height} style={{ width: gaugeW, height: gaugeGeo.height }} alt="" />
              <div style={{ display: "flex", fontSize: 36, fontWeight: 900, backgroundImage: OG_GRADIENT, backgroundClip: "text", color: "transparent", paddingBottom: 4 }}>
                {card.activity.band}
              </div>
              <div style={{ display: "flex", fontSize: 16, color: C.inkSubtle }}>{`${card.activity.score} of 100`}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", width: splitW }}>
              <div style={{ display: "flex", width: splitW, height: 14, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.08)", gap: 2 }}>
                <div style={{ display: "flex", width: Math.round((splitW * card.activity.sellsPct) / 100), height: 14, background: WARNING }} />
                <div style={{ display: "flex", width: Math.round((splitW * card.activity.buildsPct) / 100), height: 14, background: C.purple }} />
                <div style={{ display: "flex", width: Math.round((splitW * card.activity.holdsPct) / 100), height: 14, background: "rgba(244,244,248,0.35)" }} />
              </div>
              <div style={{ display: "flex", gap: 28, marginTop: 12 }}>
                {(
                  [
                    ["Sells", card.activity.sellsPct, WARNING],
                    ["Builds", card.activity.buildsPct, C.purple],
                    ["Holds", card.activity.holdsPct, "rgba(244,244,248,0.5)"],
                  ] as const
                ).map(([l, v, color]) => (
                  <div key={l} style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ display: "flex", width: 10, height: 10, borderRadius: 2, background: color }} />
                      <Label size={13}>{l}</Label>
                    </div>
                    <div style={{ display: "flex", fontSize: 34, fontWeight: 900 }}>{`${v}%`}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 28, marginTop: 14 }}>
                {(
                  [
                    ["Top sells", card.sells],
                    ["Buy targets", card.buys],
                  ] as const
                ).map(([l, list]) => (
                  <div key={l} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <Label size={13}>{l}</Label>
                    {list.length === 0 ? (
                      <div style={{ display: "flex", fontSize: 18, color: C.inkMuted, marginTop: 4 }}>None</div>
                    ) : (
                      list.map((x) => (
                        <div key={x.name} style={{ display: "flex", fontSize: 18, gap: 8, marginTop: 4 }}>
                          <div style={{ display: "flex", width: 34, color: OG_POSITION_COLORS[x.position] ?? C.inkMuted, fontWeight: 900 }}>{x.position}</div>
                          <div style={{ display: "flex" }}>{clip(x.name, 20)}</div>
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section label={`Movers, ${card.moversWindow}`} height={h.movers} width={W}>
          <div style={{ display: "flex", gap: 40 }}>
            {(
              [
                ["Rising", card.risers, "#10B981"],
                ["Falling", card.fallers, WARNING],
              ] as const
            ).map(([l, list, color]) => (
              <div key={l} style={{ display: "flex", flexDirection: "column", width: (CW - 40) / 2 }}>
                <Label size={13}>{l}</Label>
                {list.length === 0 ? (
                  <div style={{ display: "flex", fontSize: 18, color: C.inkMuted, marginTop: 6 }}>Nothing moved more than the floor.</div>
                ) : (
                  list.map((m) => (
                    <div key={m.name} style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                      <div style={{ display: "flex", fontSize: 19, justifyContent: "space-between" }}>
                        <div style={{ display: "flex" }}>{clip(m.name, 22)}</div>
                        <div style={{ display: "flex", fontWeight: 900 }}>{`${m.pct > 0 ? "+" : ""}${m.pct.toFixed(1)}%`}</div>
                      </div>
                      <div style={{ display: "flex", marginTop: 4 }}>
                        <Bar fraction={moverScale > 0 ? Math.abs(m.pct) / moverScale : 0} width={(CW - 40) / 2} height={5} fill={color} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section label="Draft capital" height={h.capital} width={W}>
          {card.capital === null ? (
            <div style={{ display: "flex", fontSize: 20, color: C.inkMuted }}>Redraft leagues hold no future picks.</div>
          ) : card.capital.length === 0 ? (
            <div style={{ display: "flex", fontSize: 20, color: C.inkMuted }}>This roster holds no future picks.</div>
          ) : (
            card.capital.map((s) => (
              <div key={s.season} style={{ display: "flex", height: 44, alignItems: "center", gap: 20 }}>
                <div style={{ display: "flex", width: 70, fontSize: 22, fontWeight: 900 }}>{String(s.season)}</div>
                <div style={{ display: "flex", flex: 1 }}>
                  <Bar fraction={topSeason > 0 ? s.value / topSeason : 0} width={CW - 70 - 150 - 150 - 60} height={10} />
                </div>
                <div style={{ display: "flex", width: 150, justifyContent: "flex-end", fontSize: 22, fontWeight: 900 }}>{s.value.toLocaleString("en-US")}</div>
                <div style={{ display: "flex", width: 150, justifyContent: "flex-end", fontSize: 17, color: C.inkSubtle }}>{ordinalShort(s.rank, card.teamCount)}</div>
              </div>
            ))
          )}
        </Section>

        <Section label="The plan" height={h.priorities} width={W}>
          {card.priorities.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 14, marginBottom: 10, alignItems: "flex-start" }}>
              <div
                style={{
                  display: "flex",
                  width: 30,
                  fontSize: i === 0 ? 30 : 24,
                  fontWeight: 900,
                  backgroundImage: i < 3 ? OG_GRADIENT : undefined,
                  backgroundClip: i < 3 ? "text" : undefined,
                  color: i < 3 ? "transparent" : C.inkSubtle,
                }}
              >
                {String(i + 1)}
              </div>
              <div style={{ display: "flex", flex: 1, fontSize: i === 0 ? 30 : 24, lineHeight: 1.27, fontWeight: i === 0 ? 900 : 500, color: i === 0 ? C.ink : C.inkMuted }}>
                {priorityText(p)}
              </div>
            </div>
          ))}
        </Section>

        <Section label="Trade shapes" height={h.strategy} width={W}>
          {card.strategy.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", marginBottom: 12 }}>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 900 }}>{s.label}</div>
              <div style={{ display: "flex", fontSize: 20, lineHeight: 1.25, color: C.inkMuted }}>{strategyText(s)}</div>
            </div>
          ))}
        </Section>

        <Section label="Partners" height={h.partners} width={W}>
          <div style={{ display: "flex", fontSize: 22, lineHeight: 1.3 }}>
            {card.partners.length === 0
              ? "Not enough priced rosters to name a partner."
              : clip(card.partners.map((p) => (p.handle && !p.teamName.includes(`@${p.handle}`) ? `${p.teamName} (@${p.handle})` : p.teamName)).join(", "), 80)}
          </div>
        </Section>

        <div style={{ display: "flex", width: W, height: h.footer, alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${LINE_ACCENT}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <OgBrandMark size={32} />
            <div style={{ display: "flex", fontSize: 16, color: C.inkSubtle }}>
              {clip(`Prepared ${formatEastern(card.generatedAt)}. ${card.formatDisplay} values by ${card.sourceDisplay}.`, 96)}
            </div>
            <div style={{ display: "flex", fontSize: 15, color: C.inkSubtle }}>
              {card.hasDefenders ? "Defenders carry no market value. Not a promise about any player." : "Not a promise about any player; the league's numbers as they stand."}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <Label size={13} color={C.cyan}>Build yours</Label>
            <div style={{ display: "flex", fontSize: 17, fontWeight: 900, color: C.inkMuted, marginTop: 4 }}>ffbeacon.com/tools/league-pulse</div>
          </div>
        </div>
      </div>
    ),
    { width: layout.width, height: layout.height, fonts: OG_FONTS, headers: { "Cache-Control": SUCCESS_CACHE } },
  );
}
