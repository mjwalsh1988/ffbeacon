import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import {
  loadRemoteImage,
  sleeperPlayerImageUrl,
  OG_FONTS,
  OG_FONT_FAMILY,
  OG_LOGO_DATA_URI,
  OG_WORDMARK,
} from "@/lib/og/assets";
import { displayName } from "@/lib/og/display-name";
import { parseFaabOgParams } from "./params";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors per CLAUDE.md. NEVER reference DPC's gold or violet on
// #0c0c18. Same eight values every other OG route uses.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

/** Same hues the position pills use on the site (tailwind.config.ts `position.*`). */
const POSITION_COLOR: Record<string, string> = {
  QB: "#F87171",
  RB: "#34D399",
  WR: "#60A5FA",
  TE: "#FBBF24",
  K: "#F472B6",
  DEF: "#94A3B8",
  DL: "#A3E635",
  LB: "#E879F9",
  DB: "#818CF8",
};

/**
 * GET /api/og/faab
 *
 * 1200x630 social card for one FAAB bid: the player, what to bid out of the
 * league's budget, the chance that bid wins, and the figure above which the
 * reader should walk away. Section 7.15 of
 * docs/faab/faab-calculator-overhaul-plan.md.
 *
 * Query params (all required, all validated in ./params.ts):
 *   ?p=4046        the Sleeper player id
 *   ?bid=&walk=&budget=   integers, 0 to 100000
 *   ?win=          integer, 0 to 100
 *   ?k=standard|chopped   chopped adds a label, standard adds nothing
 *
 * NOTHING THAT NAMES A LEAGUE, A TEAM OR A MANAGER GOES ON THIS CARD. The
 * figures are the whole point of sharing it and the league is nobody else's
 * business: a reader posting their bid into a group chat is not publishing
 * their league's roster, and the route accepts no parameter that could carry
 * one. That is a property of the parameter list, not of this render, which is
 * why ./params.ts refuses anything it does not recognise.
 *
 * RATE LIMITED on its own "og_faab" bucket, 20 per 60 seconds per actor,
 * through the same try_claim_rate_limit helper app/api/og/start-sit uses. The
 * numbers on this card are supplied by the caller rather than derived, so the
 * only real cost per request is the player row plus a headshot fetch and a
 * satori render, but an arbitrary parameter combination walks straight past
 * the edge cache, so the limit is what bounds it. Validated BEFORE the slot is
 * claimed, exactly like start-sit, so a malformed request cannot spend a real
 * reader's budget. FAILS CLOSED: a limit we cannot evaluate is not a limit
 * that passes, and a refused claim is a plain-text 429 with no-store rather
 * than an image, because caching a placeholder in place of a real card is what
 * a real visitor's link preview would then show for the rest of the CDN's
 * stale-while-revalidate window.
 */
const RATE_BUCKET = "og_faab";
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 20;

/** Fails closed: a limit we cannot evaluate is not a limit that passes. */
async function claimSlot(request: Request): Promise<boolean> {
  try {
    const actorKey = await resolveRateLimitActorKey(request);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "try_claim_rate_limit" as never,
      {
        p_bucket: RATE_BUCKET,
        p_key: actorKey,
        p_max_requests: RATE_MAX,
        p_window_seconds: RATE_WINDOW_SECONDS,
      } as never,
    );
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[og/faab] rate-limit check failed", err);
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseFaabOgParams(url.searchParams);
  if (!parsed.ok) {
    return new Response(parsed.reason, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }

  if (!(await claimSlot(request))) {
    return new Response("Too many requests", {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(RATE_WINDOW_SECONDS),
      },
    });
  }

  const { playerId, bid, walk, budget, win, kind } = parsed.params;

  const supabase = createAdminClient();
  const { data: player } = await supabase
    .from("players")
    .select("first_name, last_name, position, team")
    .eq("external_ids->>sleeper", playerId)
    .maybeSingle()
    .overrideTypes<{
      first_name: string | null;
      last_name: string | null;
      position: string | null;
      team: string | null;
    }>();

  if (!player) return notFoundImage("Player not found");

  const name = [player.first_name, player.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const position = player.position ?? "";
  const accent = POSITION_COLOR[position] ?? CYAN;
  const meta = [position, player.team].filter(Boolean).join(", ");
  const photo = await loadRemoteImage(
    sleeperPlayerImageUrl(playerId, position),
  );

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: `linear-gradient(180deg, ${BG} 0%, ${BG_BASE} 100%)`,
        color: INK,
        fontFamily: OG_FONT_FAMILY,
        fontWeight: 500,
        padding: "38px 56px 30px 56px",
        position: "relative",
      }}
    >
      {/* Beacon gradient accent bar */}
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

      {/* Wordmark top left, league kind top right. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={OG_LOGO_DATA_URI}
              alt=""
              width={28}
              height={28}
              style={{ width: 28, height: 28 }}
            />
            <p
              style={{
                fontSize: 21,
                fontWeight: 900,
                margin: 0,
                letterSpacing: -0.5,
              }}
            >
              {OG_WORDMARK}
            </p>
          </div>
          <p style={{ fontSize: 16, color: INK_MUTED, margin: "6px 0 0 0" }}>
            What to bid on this waiver claim
          </p>
        </div>

        {kind === "chopped" ? (
          <p
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 1.2,
              margin: 0,
              padding: "6px 14px",
              borderRadius: 999,
              color: PURPLE,
              background: `${PURPLE}22`,
              border: `1px solid ${PURPLE}66`,
            }}
          >
            Chopped league
          </p>
        ) : null}
      </div>

      {/* Player on the left, the three figures on the right. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 44,
          marginTop: 30,
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: 300,
          }}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt=""
              width={200}
              height={200}
              style={{
                width: 200,
                height: 200,
                borderRadius: 24,
                objectFit: "cover",
                border: `3px solid ${accent}88`,
                background: BG_BASE,
              }}
            />
          ) : (
            <div
              style={{
                width: 200,
                height: 200,
                borderRadius: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 54,
                fontWeight: 900,
                color: accent,
                border: `3px solid ${accent}55`,
                background: `${accent}1A`,
              }}
            >
              {position || "FA"}
            </div>
          )}
          <p
            style={{
              fontSize: 32,
              fontWeight: 900,
              letterSpacing: -0.6,
              margin: "18px 0 0 0",
              textAlign: "center",
              lineHeight: 1.1,
              color: INK,
            }}
          >
            {displayName(name, 18)}
          </p>
          {meta ? (
            <p style={{ fontSize: 17, color: INK_SUBTLE, margin: "6px 0 0 0" }}>
              {meta}
            </p>
          ) : null}
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", flex: 1, gap: 18 }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* "Bid {bid} of {budget}", one sentence, sized so the figure
                  that matters is the one a reader sees first. Satori does not
                  shrink text to fit, so the largest run is bounded by the
                  six digits 100000 can reach rather than set by eye. */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <p
                style={{
                  fontSize: 34,
                  fontWeight: 900,
                  margin: 0,
                  color: INK_MUTED,
                }}
              >
                Bid
              </p>
              <p
                style={{
                  fontSize: 84,
                  fontWeight: 900,
                  letterSpacing: -2.5,
                  margin: 0,
                  lineHeight: 1,
                  color: INK,
                  fontFamily: "monospace",
                }}
              >
                {bid}
              </p>
              <p
                style={{
                  fontSize: 34,
                  fontWeight: 900,
                  margin: 0,
                  color: INK_MUTED,
                }}
              >
                of
              </p>
              <p
                style={{
                  fontSize: 52,
                  fontWeight: 900,
                  letterSpacing: -1.2,
                  margin: 0,
                  color: INK_MUTED,
                  fontFamily: "monospace",
                }}
              >
                {budget}
              </p>
            </div>
            {/* The beacon gradient again, under the figure it belongs to. */}
            <div
              style={{
                width: 360,
                height: 6,
                borderRadius: 999,
                marginTop: 16,
                background: `linear-gradient(90deg, ${PURPLE} 0%, ${CYAN} 100%)`,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 8,
            }}
          >
            <StatLine label={`${win}% chance to win`} color={CYAN} />
            <StatLine label={`Walk away above ${walk}`} color={INK_MUTED} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          borderTop: `1px solid ${LINE}`,
          paddingTop: 16,
        }}
      >
        <p
          style={{ fontSize: 17, fontWeight: 900, color: INK_MUTED, margin: 0 }}
        >
          ffbeacon.com
        </p>
        <p style={{ fontSize: 13, color: INK_SUBTLE, margin: 0 }}>
          FAAB calculator
        </p>
      </div>
    </div>,
    {
      ...SIZE,
      fonts: OG_FONTS,
      headers: {
        "cache-control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function StatLine({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
        }}
      />
      <p
        style={{
          fontSize: 34,
          fontWeight: 900,
          letterSpacing: -0.6,
          margin: 0,
          color,
        }}
      >
        {label}
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
        fontFamily: OG_FONT_FAMILY,
        fontWeight: 500,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OG_LOGO_DATA_URI}
        alt=""
        width={64}
        height={64}
        style={{ width: 64, height: 64 }}
      />
      <p style={{ fontSize: 46, fontWeight: 900, margin: "16px 0 0 0" }}>
        {OG_WORDMARK}
      </p>
      <p
        style={{
          fontSize: 24,
          fontWeight: 500,
          color: INK_MUTED,
          marginTop: 14,
        }}
      >
        {reason}
      </p>
    </div>,
    {
      ...SIZE,
      status: 404,
      fonts: OG_FONTS,
      // A short TTL, not the year-long implicit default: a transient load
      // failure or a stale link must not pin a placeholder at the edge for
      // longer than a real card would need to replace it.
      headers: { "cache-control": "public, max-age=0, s-maxage=60" },
    },
  );
}
