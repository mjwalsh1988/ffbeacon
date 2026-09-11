import { ImageResponse } from "next/og";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { loadStartSitBoard, normalizeStartSitSlugs } from "@/lib/start-sit/load";
import { computeStartSit } from "@/lib/start-sit/engine";
import {
  MIN_START_SIT_PLAYERS,
  type StartSitProjection,
  type StartSitCallLabel,
} from "@/lib/start-sit/types";
import { START_SIT_CALL_LABEL_TEXT } from "@/lib/start-sit/copy";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import {
  loadRemoteImages,
  sleeperPlayerImageUrl,
  OG_FONTS,
  OG_FONT_FAMILY,
  OG_LOGO_DATA_URI,
  OG_WORDMARK,
} from "@/lib/og/assets";
import { clip, displayName } from "@/lib/og/display-name";
import {
  buildStartSitOgCards,
  cardBadgeLabel,
  cardWidthPx,
  formatConfidencePercent,
  headlineFontSize,
  CARD_GAP,
  type StartSitOgCard,
} from "./card-layout";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors per CLAUDE.md. NEVER reference DPC's gold or violet on
// #0c0c18. SIT is INK_SUBTLE, the neutral the page's own badge uses (components/start-sit-badge.tsx), because sitting a player is not a warning.
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
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/;

/**
 * GET /api/og/start-sit
 *
 * 1200x630 social card for one start/sit board: the verdict sentence as the
 * headline, up to eight small player cards in starter-then-bench order, and
 * the confidence figure for the borderline pair. Section 2.10 of
 * docs/seo/who-should-i-start-and-site-seo-plan.md.
 *
 * Query params:
 *   ?p=slug1,slug2,...   two to eight player slugs, comma separated
 *   ?start=K             how many of them the reader starts (default 1)
 *   ?week=W              the regular-season week (default the live week)
 *   ?format=&source=     explicit slugs baked into the image; an OG route
 *                        already knows exactly which card it wants and skips
 *                        the cookie/DB resolver chain the page uses (see the
 *                        "TWO ROUTES INTO FORMAT AND SOURCE" note atop
 *                        lib/start-sit/load.ts). Absent, both fall through to
 *                        that resolver's own default.
 *
 * Runs the SAME lib/start-sit/load.ts loadStartSitBoard and
 * lib/start-sit/engine.ts computeStartSit the page renders from, so a shared
 * card can never disagree with the board it links to.
 *
 * RATE LIMITED on the same "og_breakdown" bucket as app/api/og/breakdown,
 * for the same reason: this is a full projection read per request, not a
 * single cheap row, so the edge cache in front of it can be walked straight
 * past by an arbitrary slug combination. Validated BEFORE the slot is
 * claimed, exactly like the pair route, so a malformed request cannot spend
 * a real reader's budget. A refused claim returns plain-text 429 with
 * no-store rather than an image, also matching the pair route: caching a
 * placeholder in place of a real card is worse than a bare refusal, because
 * the placeholder would then be what a real visitor's link preview shows
 * for the rest of the CDN's stale-while-revalidate window.
 *
 * NO IN-PROCESS CACHE of rendered cards. Every other OG route that computes
 * something non-trivial (the pair route this one is modeled on included)
 * relies on the cache-control headers below plus the rate limit to bound
 * cost, rather than memoizing a render in the route module; this route keeps
 * that pattern. If one is added later, its key must include the resolved
 * projection source slug (verdict.projectionSource / board.projectionSource)
 * alongside the request params, so a source flip can never serve a stale
 * render under the new source's label.
 *
 * Invalid, empty or unknown input, or a load failure, all render the same
 * generic branded fallback card the pair route falls back to.
 */
const RATE_BUCKET = "og_breakdown";
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 20;

/** Fails closed: a limit we cannot evaluate is not a limit that passes. */
async function claimSlot(request: Request): Promise<boolean> {
  try {
    const actorKey = await resolveRateLimitActorKey(request);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: RATE_BUCKET,
      p_key: actorKey,
      p_max_requests: RATE_MAX,
      p_window_seconds: RATE_WINDOW_SECONDS,
    } as never);
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[og/start-sit] rate-limit check failed", err);
    return false;
  }
}

type AnySupabase = Awaited<ReturnType<typeof createClient>>;

/** Everything the card needs to render, or a reason it cannot. */
type CardOutcome =
  | {
      ok: true;
      cards: StartSitOgCard[];
      verdictLine: string;
      confidence: number | null;
      callLabel: StartSitCallLabel;
      week: number;
      formatDisplay: string;
      projectionSource: string;
    }
  | { ok: false; reason: string };

/**
 * Loads the board, runs computeStartSit, and turns the result into card data
 * -- or a reason the card cannot render. Split out from GET so every "cannot
 * render" path is a single return of `{ ok: false, reason }` rather than an
 * early `return notFoundImage(...)` scattered through a try block, which is
 * what makes the outer function's variables provably assigned on every path
 * TypeScript has to reason about.
 */
async function buildCardOutcome(supabase: AnySupabase, url: URL): Promise<CardOutcome> {
  const slugs = normalizeStartSitSlugs((url.searchParams.get("p") ?? "").split(","));

  const board = await loadStartSitBoard({
    supabase,
    slugs,
    weekParam: url.searchParams.get("week") ?? undefined,
    startParam: url.searchParams.get("start") ?? undefined,
    formatSlug: url.searchParams.get("format") ?? undefined,
    sourceSlug: url.searchParams.get("source") ?? undefined,
  });

  if (board.season == null) return { ok: false, reason: "No projections available yet" };
  if (board.candidates.length < MIN_START_SIT_PLAYERS) return { ok: false, reason: "Players not found" };

  const projectionsByPlayerId = new Map(board.projections.map((p) => [p.playerId, p]));
  const projectionsRecord: Record<string, StartSitProjection> = Object.fromEntries(projectionsByPlayerId);

  const verdict = computeStartSit({
    candidates: board.candidates,
    projections: projectionsRecord,
    startCount: board.startCount,
    week: board.week,
    season: board.season,
    formatDisplay: board.format.display,
    projectionSource: board.projectionSource,
  });

  const cards = buildStartSitOgCards(verdict, board.candidates, projectionsByPlayerId);
  if (cards.length === 0) return { ok: false, reason: "Players not found" };

  return {
    ok: true,
    cards,
    verdictLine: verdict.verdictLine,
    confidence: verdict.confidence,
    callLabel: verdict.callLabel,
    week: verdict.week,
    formatDisplay: board.format.display,
    projectionSource: verdict.projectionSource,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSlugs = (url.searchParams.get("p") ?? "").split(",");
  // The same dedupe-and-cap loadStartSitBoard applies internally, run here
  // first so a malformed or empty ?p= is caught BEFORE the rate-limit slot is
  // claimed (validate first, claim second, matching the pair route).
  const slugs = normalizeStartSitSlugs(rawSlugs);

  if (slugs.length < MIN_START_SIT_PLAYERS || !slugs.every((s) => SLUG_PATTERN.test(s))) {
    return notFoundImage("Invalid comparison");
  }

  if (!(await claimSlot(request))) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(RATE_WINDOW_SECONDS) },
    });
  }

  const supabase = await createClient();

  let outcome: CardOutcome;
  try {
    outcome = await buildCardOutcome(supabase, url);
  } catch (err) {
    console.error("[og/start-sit] load failed", err);
    outcome = { ok: false, reason: "Comparison unavailable" };
  }

  if (!outcome.ok) return notFoundImage(outcome.reason);
  const { cards, verdictLine, confidence, callLabel, week, formatDisplay, projectionSource } = outcome;

  const cardWidth = cardWidthPx(cards.length);
  const photoUrls = cards.map((c) => sleeperPlayerImageUrl(c.sleeperId, c.position));
  const photos = await loadRemoteImages(photoUrls);
  const photoByPlayerId = new Map<string, string>();
  cards.forEach((card, i) => {
    const photo = photos[i];
    if (photo) photoByPlayerId.set(card.playerId, photo);
  });

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
          fontFamily: OG_FONT_FAMILY,
          fontWeight: 500,
          padding: "34px 44px 26px 44px",
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

        {/* Wordmark + "Who should I start? Week N", both top left. */}
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
            <p style={{ fontSize: 21, fontWeight: 900, margin: 0, letterSpacing: -0.5 }}>
              {OG_WORDMARK}
            </p>
          </div>
          <p style={{ fontSize: 16, color: INK_MUTED, margin: "6px 0 0 0" }}>
            Who should I start? Week {week}
          </p>
        </div>

        {/* Verdict headline */}
        <h1
          style={{
            fontSize: headlineFontSize(verdictLine),
            fontWeight: 900,
            letterSpacing: -0.8,
            margin: "16px 0 0 0",
            lineHeight: 1.18,
            color: INK,
          }}
        >
          {clip(verdictLine, 170)}
        </h1>

        {/* Player cards: starters first, then the bench, both descending. */}
        <div
          style={{
            display: "flex",
            flexWrap: "nowrap",
            justifyContent: "center",
            alignItems: "stretch",
            gap: CARD_GAP,
            marginTop: 20,
            flex: 1,
          }}
        >
          {cards.map((card) => (
            <PlayerOgCard
              key={card.playerId}
              card={card}
              photo={photoByPlayerId.get(card.playerId) ?? null}
              width={cardWidth}
            />
          ))}
        </div>

        {/* Footer: format/projection-source note and wordmark on the left,
            the confidence figure bottom right. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginTop: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <p style={{ fontSize: 13, color: INK_SUBTLE, margin: 0 }}>
              {formatDisplay}, projections via {projectionSourceDisplay(projectionSource)}
            </p>
            <p style={{ fontSize: 15, fontWeight: 900, color: INK_MUTED, margin: "4px 0 0 0" }}>
              ffbeacon.com
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <p
              style={{
                fontSize: 11,
                color: INK_SUBTLE,
                margin: 0,
                letterSpacing: 1.4,
                fontWeight: 700,
              }}
            >
              CONFIDENCE
            </p>
            <p
              style={{
                fontSize: 30,
                fontWeight: 900,
                color: CYAN,
                margin: "2px 0 0 0",
                fontFamily: "monospace",
              }}
            >
              {formatConfidencePercent(confidence)}
            </p>
            <p style={{ fontSize: 12, color: INK_MUTED, margin: "2px 0 0 0" }}>
              {START_SIT_CALL_LABEL_TEXT[callLabel]}
            </p>
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: OG_FONTS,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function PlayerOgCard({
  card,
  photo,
  width,
}: {
  card: StartSitOgCard;
  photo: string | null;
  width: number;
}) {
  const badge = cardBadgeLabel(card);
  const badgeColor = badge === "START" ? CYAN : INK_SUBTLE;
  const posColor = POSITION_COLOR[card.position] ?? INK_MUTED;
  const meta = [card.position, card.team].filter(Boolean).join(", ");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width,
        minWidth: 0,
        padding: "10px 6px",
        borderRadius: 12,
        border: `1px solid ${LINE}`,
        background: "rgba(255, 255, 255, 0.03)",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1,
          margin: 0,
          padding: "2px 8px",
          borderRadius: 999,
          color: badgeColor,
          background: `${badgeColor}22`,
          border: `1px solid ${badgeColor}66`,
        }}
      >
        {badge}
      </p>

      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          width={52}
          height={52}
          style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            objectFit: "cover",
            marginTop: 8,
            border: `2px solid ${posColor}88`,
            background: BG_BASE,
          }}
        />
      ) : (
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 800,
            color: posColor,
            border: `2px solid ${posColor}55`,
            background: `${posColor}1A`,
          }}
        >
          {card.position}
        </div>
      )}

      <p
        style={{
          fontSize: 12,
          fontWeight: 700,
          margin: "8px 0 0 0",
          textAlign: "center",
          lineHeight: 1.15,
          color: INK,
        }}
      >
        {displayName(card.name, 15)}
      </p>
      <p style={{ fontSize: 9, color: INK_SUBTLE, margin: "2px 0 0 0" }}>{meta}</p>
      <p
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: INK,
          margin: "6px 0 0 0",
          fontFamily: "monospace",
        }}
      >
        {card.points != null ? card.points.toFixed(1) : "--"}
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
        <p style={{ fontSize: 46, fontWeight: 900, margin: "16px 0 0 0" }}>{OG_WORDMARK}</p>
        <p style={{ fontSize: 24, fontWeight: 500, color: INK_MUTED, marginTop: 14 }}>{reason}</p>
      </div>
    ),
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
