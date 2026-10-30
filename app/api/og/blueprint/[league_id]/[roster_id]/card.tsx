/**
 * Team Blueprint share images (plan section 11): shared loading and the two
 * renderers. Both routes READ ONLY: one leagues row, one rosters row and one
 * league_blueprint_cache row. No engine, no derived sync, no Sleeper call. A
 * page and its picture show the same numbers because both draw the stored
 * view.
 *
 * Brand: FF Beacon dark, purple to cyan, Geist; no gold, no #0c0c18, no DPC
 * wording. The gradient appears only on the overall grade and the rank
 * numerals.
 */

import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";
import { ordinal } from "@/lib/league-team-status";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { readCachedBlueprint } from "@/lib/league-blueprint/cache";
import { buildBlueprintShareCard, type BlueprintShareCard } from "@/lib/league-blueprint/share";
import { SHARE_WIDTH, shareLayout } from "@/lib/league-blueprint/share-layout";
import { ringRowSvg, ringRowWidth } from "@/lib/league-blueprint/ring-geometry";
import { gaugeSvg } from "@/lib/league-blueprint/gauge-geometry";
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
  return { kind: "card", card: buildBlueprintShareCard(cached.view) };
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

const RING_OPTS = { stroke: 7, trackColor: C.line, fromColor: C.purple, toColor: C.cyan };

function Pill({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "6px 14px",
        borderRadius: 999,
        border: `1px solid ${C.line}`,
        color: C.ink,
        fontSize: 20,
        fontWeight: 500,
      }}
    >
      {text}
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
              fontSize: 16,
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

/**
 * The slot column is 70px wide. SUPERFLEX is the one shared label that does not
 * fit, so the image prints the SF the format pills above it already use.
 */
function shareSlotLabel(label: string): string {
  return label === "SUPERFLEX" ? "SF" : label;
}

/**
 * The wordmark already reads FFBeacon.com, so the footer is that row alone with
 * the source line under it: no second domain for a long format name to push off
 * the edge.
 */
function Footer({ card }: { card: BlueprintShareCard }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, width: "100%" }}>
      <OgBrandMark size={30} />
      <div style={{ display: "flex", fontSize: 18, color: C.inkSubtle }}>
        {clip(`${card.formatDisplay} values by ${card.sourceDisplay}, as of ${formatEastern(card.generatedAt)}`, 100)}
      </div>
      {card.hasDefenders && (
        <div style={{ display: "flex", fontSize: 16, color: C.inkSubtle }}>Defenders carry no market value.</div>
      )}
    </div>
  );
}

/** 1200 x 630 link preview (plan 11.2). */
export function renderPreview(card: BlueprintShareCard): ImageResponse {
  const name = fitText(card.teamName, { width: 680, maxSize: 64, minSize: 36, maxLines: 2 });
  const first = fitText(card.priorities[0] ?? "", { width: 680, maxSize: 28, minSize: 22, maxLines: 2, weight: 500 });
  const pills = [card.statusLabel, card.valueArchetype, card.rosterArchetype].filter((x): x is string => !!x);
  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "56px 40px 0 40px" }}>
        <OgAccentBar />
        <div style={{ display: "flex", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 720 }}>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 900, color: C.cyan, letterSpacing: "0.18em" }}>
              TEAM BLUEPRINT
            </div>
            <div style={{ display: "flex", marginTop: 14, fontSize: name.fontSize, fontWeight: 900, lineHeight: 1.05 }}>
              {name.text}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
              {pills.map((p) => (
                <Pill key={p} text={p} />
              ))}
            </div>
            {first.text && (
              <div style={{ display: "flex", marginTop: 28, fontSize: first.fontSize, fontWeight: 500, color: C.ink, lineHeight: 1.3 }}>
                {first.text}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 40, width: 360, alignItems: "flex-start" }}>
            <div style={{ display: "flex", fontSize: 20, fontWeight: 900, color: C.cyan, letterSpacing: "0.18em" }}>OVERALL</div>
            <div
              style={{
                display: "flex",
                fontSize: 160,
                fontWeight: 900,
                lineHeight: 1,
                backgroundImage: OG_GRADIENT,
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {card.overall.toFixed(1)}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: C.inkMuted }}>of 10</div>
            <div style={{ display: "flex", marginTop: 24 }}>
              <Rings card={card} size={52} gap={8} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", height: 100, alignItems: "center", borderTop: `1px solid ${C.line}` }}>
          <Footer card={card} />
        </div>
      </div>
    ),
    ogResponseOptions(SUCCESS_CACHE),
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{ display: "flex", fontSize: 18, fontWeight: 900, color: C.inkSubtle, letterSpacing: "0.16em" }}>
      {children}
    </div>
  );
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
  return s.empty ? clip(s.empty, 80) : clip(`${s.out} for ${s.in}${s.verdict ? `. ${s.verdict}` : ""}`, 120);
}

/** Portrait share card, 1080 wide, as tall as its sections (plan 11.3). */
export async function renderPortrait(card: BlueprintShareCard): Promise<ImageResponse> {
  const textWidth = SHARE_WIDTH - 96;
  const layout = shareLayout({
    slots: card.lineup.length,
    capitalSeasons: card.capital ? card.capital.length : null,
    // Sized from the text so three short priorities do not leave a blank band.
    priorityLines: card.priorities.map((p, i) => {
      const size = i === 0 ? 30 : 24;
      return fitText(priorityText(p), { width: textWidth - 44, maxSize: size, minSize: size, maxLines: 6, weight: i === 0 ? 900 : 500 }).lines;
    }),
    strategyLines: card.strategy.map((s) => fitText(strategyText(s), { width: textWidth, maxSize: 20, minSize: 20, maxLines: 4, weight: 500 }).lines),
  });
  const photos = await loadRemoteImages(card.lineup.slice(0, 12).map((r) => sleeperPlayerImageUrl(r.sleeperId, r.position)));
  const name = fitText(card.teamName, { width: 980, maxSize: 56, minSize: 36, maxLines: 2 });
  const W = layout.width - 96;
  const gauge = gaugeSvg(card.activity.score, {
    width: 300,
    stroke: 22,
    trackColor: C.line,
    fromColor: C.purple,
    toColor: C.cyan,
    tickColor: C.inkSubtle,
  });
  const h = Object.fromEntries(layout.sections.map((s) => [s.key, s.height]));
  const box = (key: string) => ({ display: "flex", flexDirection: "column" as const, height: h[key], width: W });

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "48px 48px 0 48px", gap: 48 }}>
        <OgAccentBar />
        <div style={box("header")}>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 900, color: C.cyan, letterSpacing: "0.18em" }}>TEAM BLUEPRINT</div>
          <div style={{ display: "flex", fontSize: name.fontSize, fontWeight: 900, lineHeight: 1.05, marginTop: 8 }}>{name.text}</div>
          <div style={{ display: "flex", fontSize: 22, color: C.inkMuted, marginTop: 6 }}>
            {[card.ownerHandle ? `@${card.ownerHandle}` : null, card.record, card.statusLabel, card.valueArchetype, card.rosterArchetype, card.outlook]
              .filter(Boolean)
              .join("  /  ")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {card.formatTags.slice(0, 6).map((t) => (
              <Pill key={t} text={t} />
            ))}
          </div>
        </div>

        <div style={{ ...box("grades"), flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 20, fontWeight: 900, color: C.cyan, letterSpacing: "0.18em" }}>OVERALL</div>
            <div
              style={{
                display: "flex",
                fontSize: 140,
                fontWeight: 900,
                lineHeight: 1,
                backgroundImage: OG_GRADIENT,
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {card.overall.toFixed(1)}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: C.inkMuted }}>of 10</div>
          </div>
          <Rings card={card} size={72} gap={14} />
        </div>

        <div style={box("lineup")}>
          <SectionTitle>STARTING LINEUP</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
            {card.lineup.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", height: 52, gap: 14 }}>
                <div style={{ display: "flex", width: 70, fontSize: 22, color: C.inkSubtle, fontWeight: 900 }}>{clip(shareSlotLabel(r.slotLabel), 5)}</div>
                {photos[i] ? (
                  // Satori renders plain img elements only; next/image cannot run here.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos[i]!} width={40} height={40} style={{ width: 40, height: 40, borderRadius: 999 }} alt="" />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      width: 40,
                      height: 40,
                      borderRadius: 999,
                      background: C.line,
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 900,
                      color: OG_POSITION_COLORS[r.position ?? ""] ?? C.inkMuted,
                    }}
                  >
                    {r.position ?? ""}
                  </div>
                )}
                <div style={{ display: "flex", flex: 1, fontSize: 26, fontWeight: 500 }}>{r.name ? clip(r.name, 26) : "Empty"}</div>
                <div style={{ display: "flex", width: 140, justifyContent: "flex-end", fontSize: 26, fontWeight: 900 }}>
                  {r.value === null ? (r.name ? "No value" : "") : r.value.toLocaleString("en-US")}
                </div>
                <div style={{ display: "flex", width: 90, justifyContent: "flex-end", fontSize: 20, color: C.inkSubtle }}>
                  {r.positionRank !== null && r.position ? `${r.position}${r.positionRank}` : ""}
                </div>
                <div style={{ display: "flex", width: 170, justifyContent: "flex-end" }}>
                  {r.call && <Pill text={r.call} />}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...box("shares"), flexDirection: "row", gap: 48 }}>
          {(
            [
              ["VALUE SHARE", card.valueShare],
              ["PRODUCTION SHARE", card.productionShare],
            ] as const
          ).map(([label, f]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <SectionTitle>{label}</SectionTitle>
              <div style={{ display: "flex", fontSize: 64, fontWeight: 900 }}>{pct(f.pct)}</div>
              <div style={{ display: "flex", fontSize: 20, color: C.inkSubtle }}>{ordinalShort(f.rank, card.teamCount)}</div>
            </div>
          ))}
        </div>

        <div style={{ ...box("calls"), flexDirection: "row", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 320 }}>
            <SectionTitle>TRADE ACTIVITY</SectionTitle>
            {/* Satori renders plain img elements only; next/image cannot run here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgToDataUri(gauge)} width={300} height={161} style={{ width: 300, height: 161, marginTop: 12 }} alt="" />
            <div style={{ display: "flex", fontSize: 40, fontWeight: 900 }}>{`${card.activity.band}, ${card.activity.score}`}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", gap: 32 }}>
              {(
                [
                  ["SELLS", card.activity.sellsPct],
                  ["BUILDS", card.activity.buildsPct],
                  ["HOLDS", card.activity.holdsPct],
                ] as const
              ).map(([l, v]) => (
                <div key={l} style={{ display: "flex", flexDirection: "column" }}>
                  <SectionTitle>{l}</SectionTitle>
                  <div style={{ display: "flex", fontSize: 44, fontWeight: 900 }}>{`${v}%`}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 32, marginTop: 20 }}>
              {(
                [
                  ["TOP SELLS", card.sells],
                  ["BUY TARGETS", card.buys],
                ] as const
              ).map(([l, list]) => (
                <div key={l} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <SectionTitle>{l}</SectionTitle>
                  {list.length === 0 ? (
                    <div style={{ display: "flex", fontSize: 22, color: C.inkMuted }}>None</div>
                  ) : (
                    list.map((x) => (
                      <div key={x.name} style={{ display: "flex", fontSize: 22, gap: 8 }}>
                        <div style={{ display: "flex", color: OG_POSITION_COLORS[x.position] ?? C.inkMuted, fontWeight: 900 }}>{x.position}</div>
                        <div style={{ display: "flex" }}>{clip(x.name, 22)}</div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ ...box("movers"), flexDirection: "row", gap: 32 }}>
          {(
            [
              [`RISERS, ${card.moversWindow.toUpperCase()}`, card.risers],
              [`FALLERS, ${card.moversWindow.toUpperCase()}`, card.fallers],
            ] as const
          ).map(([l, list]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <SectionTitle>{l}</SectionTitle>
              {list.length === 0 ? (
                <div style={{ display: "flex", fontSize: 22, color: C.inkMuted }}>Nothing moved more than the floor.</div>
              ) : (
                list.map((m) => (
                  <div key={m.name} style={{ display: "flex", fontSize: 22, justifyContent: "space-between" }}>
                    <div style={{ display: "flex" }}>{clip(m.name, 22)}</div>
                    <div style={{ display: "flex", fontWeight: 900 }}>{`${m.pct > 0 ? "+" : ""}${m.pct.toFixed(1)}%`}</div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>

        <div style={box("capital")}>
          <SectionTitle>DRAFT CAPITAL</SectionTitle>
          {card.capital === null ? (
            <div style={{ display: "flex", fontSize: 24, color: C.inkMuted, marginTop: 12 }}>Redraft leagues hold no future picks.</div>
          ) : (
            card.capital.map((s) => (
              <div key={s.season} style={{ display: "flex", fontSize: 24, height: 40, alignItems: "center", gap: 24 }}>
                <div style={{ display: "flex", width: 90, fontWeight: 900 }}>{String(s.season)}</div>
                <div style={{ display: "flex", width: 160, fontWeight: 900 }}>{s.value.toLocaleString("en-US")}</div>
                <div style={{ display: "flex", color: C.inkSubtle }}>{ordinalShort(s.rank, card.teamCount)}</div>
              </div>
            ))
          )}
        </div>

        <div style={box("priorities")}>
          <SectionTitle>TOP PRIORITIES</SectionTitle>
          {card.priorities.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 14, marginTop: 8, alignItems: "flex-start" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: i === 0 ? 30 : 24,
                  fontWeight: 900,
                  backgroundImage: OG_GRADIENT,
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {String(i + 1)}
              </div>
              <div style={{ display: "flex", flex: 1, fontSize: i === 0 ? 30 : 24, fontWeight: i === 0 ? 900 : 500, color: i === 0 ? C.ink : C.inkMuted }}>
                {priorityText(p)}
              </div>
            </div>
          ))}
        </div>

        <div style={box("strategy")}>
          <SectionTitle>TRADE STRATEGY</SectionTitle>
          {card.strategy.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 900 }}>{s.label}</div>
              <div style={{ display: "flex", fontSize: 20, color: C.inkMuted }}>
                {strategyText(s)}
              </div>
            </div>
          ))}
        </div>

        <div style={box("partners")}>
          <SectionTitle>IDEAL PARTNERS</SectionTitle>
          <div style={{ display: "flex", fontSize: 24, marginTop: 10 }}>
            {card.partners.length === 0
              ? "Not enough priced rosters to name a partner."
              : clip(card.partners.map((p) => (p.handle && !p.teamName.includes(`@${p.handle}`) ? `${p.teamName} (@${p.handle})` : p.teamName)).join(", "), 80)}
          </div>
        </div>

        <div style={{ display: "flex", height: h.footer, alignItems: "center", borderTop: `1px solid ${C.line}` }}>
          <Footer card={card} />
        </div>
      </div>
    ),
    { width: layout.width, height: layout.height, fonts: OG_FONTS, headers: { "Cache-Control": SUCCESS_CACHE } },
  );
}
