import { ImageResponse } from "next/og";
import { isValidSleeperHandle } from "@/lib/manager-pulse/handle";
import { createAdminClient } from "@/lib/supabase/server";
import {
  fitText,
  OG_COLORS as C,
  OG_GRADIENT,
  OG_ROOT_STYLE,
  OgAccentBar,
  OgBrandMark,
  ogResponseOptions,
} from "@/lib/og/brand";

export const runtime = "nodejs";

const CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * GET /api/og/manager-pulse/[handle]
 *
 * The share card for one Manager Pulse report. Before this, a shared report
 * showed the site's homepage card with og:title "FF Beacon", which told the
 * person in the group chat nothing about who the link was about.
 *
 * THE HANDLE IS PRINTED ONLY WHEN A REPORT EXISTS FOR IT. The URL segment is
 * anyone's to type, and a branded image that repeats whatever string it is
 * handed is an image anyone can put words into. So the handle is validated
 * against Sleeper's own pattern AND must match a stored report; otherwise the
 * card is the generic Manager Pulse one with no name on it.
 *
 * Reads the report cache only (manager_pulse_cache). It never starts a
 * capture: a report is computed by the drainer, never inside a render
 * (CLAUDE.md, Manager Pulse).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const handle = raw.trim().toLowerCase();
  if (!isValidSleeperHandle(handle)) return genericCard();

  const { data } = await createAdminClient()
    .from("manager_pulse_cache")
    .select("sleeper_handle, season_from, season_to, league_seasons_counted, dynasty_seasons_counted, redraft_seasons_counted")
    // Case-insensitive, because sleeper_handle keeps Sleeper's own casing, and
    // ESCAPED, because `_` is a LIKE wildcard that the handle pattern allows:
    // unescaped, "a_b" would match a report stored for "axb" and put one
    // person's name on another person's figures. Same rule and reason as
    // readCachedReportByHandle in lib/manager-pulse/service.ts.
    .ilike("sleeper_handle", handle.replace(/[\\%_]/g, "\\$&"))
    // The newest row, so the counts match the report the page is showing.
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return genericCard();

  const name = fitText(data.sleeper_handle ?? handle, { width: 1072, maxSize: 84, minSize: 48, maxLines: 1 });
  const seasons =
    data.season_from === data.season_to ? `${data.season_to} season` : `${data.season_from} to ${data.season_to} seasons`;
  const stats = [
    { label: "League seasons read", value: data.league_seasons_counted },
    { label: "Dynasty", value: data.dynasty_seasons_counted },
    { label: "Redraft", value: data.redraft_seasons_counted },
  ].filter((s): s is { label: string; value: number } => typeof s.value === "number");

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "52px 64px 40px 64px" }}>
        <OgAccentBar />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <OgBrandMark />
          <p style={{ fontSize: 20, fontWeight: 900, color: C.cyan, margin: 0, letterSpacing: 4, textTransform: "uppercase" }}>
            Manager Pulse
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", minHeight: 0 }}>
          <p style={{ fontSize: 24, color: C.inkMuted, margin: 0 }}>Sleeper scouting report, {seasons}</p>
          <p style={{ fontSize: name.fontSize, fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.1, margin: "10px 0 0 0" }}>
            @{name.text}
          </p>
          <p style={{ fontSize: 26, color: C.inkMuted, margin: "14px 0 0 0", lineHeight: 1.35, maxWidth: 1000 }}>
            How they draft, who they trade with, what they overpay for, and what they win.
          </p>
          <div style={{ display: "flex", gap: 16, marginTop: 30 }}>
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  padding: "14px 22px",
                  borderRadius: 14,
                  border: `1px solid ${C.line}`,
                  background: "rgba(15,15,26,0.7)",
                  minWidth: 180,
                }}
              >
                <p style={{ fontSize: 16, fontWeight: 900, color: C.inkSubtle, margin: 0, letterSpacing: 2, textTransform: "uppercase" }}>
                  {s.label}
                </p>
                <p style={{ fontSize: 40, fontWeight: 900, margin: "4px 0 0 0", color: C.ink }}>{s.value}</p>
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

function Footer() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.line}`, paddingTop: 16, flexShrink: 0 }}>
      <p style={{ fontSize: 20, color: C.inkSubtle, margin: 0 }}>Know who you are trading with</p>
      <p style={{ fontSize: 20, fontWeight: 900, color: C.inkMuted, margin: 0 }}>ffbeacon.com/tools/manager-pulse</p>
    </div>
  );
}

/** No confirmed report: the tool's own card, with no name on it. */
function genericCard(): Response {
  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "52px 64px 40px 64px" }}>
        <OgAccentBar />
        <div style={{ display: "flex", flexShrink: 0 }}>
          <OgBrandMark />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <p style={{ fontSize: 19, fontWeight: 900, color: C.cyan, margin: 0, textTransform: "uppercase", letterSpacing: 4 }}>
            Sleeper manager report
          </p>
          <p style={{ fontSize: 68, fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.1, margin: "14px 0 0 0" }}>
            Know who you are
          </p>
          <p
            style={{
              fontSize: 68,
              fontWeight: 900,
              letterSpacing: -1.5,
              lineHeight: 1.22,
              paddingBottom: 6,
              margin: 0,
              background: OG_GRADIENT,
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
            }}
          >
            trading with
          </p>
        </div>
        <Footer />
      </div>
    ),
    ogResponseOptions(CACHE),
  );
}
