import { ImageResponse } from "next/og";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  assembleBreakdown,
  loadBreakdown,
  mergeMarket,
  EMPTY_EXTRAS,
} from "@/lib/beacon-breakdown";
import { loadBreakdownExtras } from "@/lib/breakdown/load-extras";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { isLensId, DEFAULT_LENS } from "@/lib/breakdown/types";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 } as const;

// FF Beacon brand colors per CLAUDE.md / plan.md. NEVER reference DPC's gold or
// violet on #0c0c18.
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";

const PLAYER_IMAGE_BASE = "https://sleepercdn.com/content/nfl/players";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/;

/**
 * GET /api/og/breakdown/[a]/[b]
 *
 * 1200x630 social card for one head-to-head comparison: both headshots, the
 * Beacon Edge split, the winning label, and the top two categories that produced
 * it. The whole pitch of the tool is a verdict worth sharing, and until now a
 * shared link previewed as generic text.
 *
 * The numbers come from the SAME loader AND the same extras the page uses, then
 * through the same assembleBreakdown, so a card can never show a verdict the
 * page disagrees with. Skipping the extras here would be cheaper and wrong: the
 * projection and reliability categories would drop out of the composite and the
 * card would quietly publish a different split from the page it links to.
 *
 * League mode is deliberately NOT applied. A card is a public preview and the
 * roster behind a league comparison is one person's; a shared link must never
 * leak what somebody's team looks like to everyone who sees the post.
 *
 * `?lens=`, `?format=`, and `?source=` are honored so a shared link and its
 * preview match.
 *
 * RATE LIMITED, unlike the other OG routes, because this one is not a single
 * cheap row read. Every call runs the full comparison including the projection
 * pass, and the URL space is every ordered pair of players crossed with three
 * lenses, so the CDN cache in front of it can be walked straight past. The limit
 * is generous enough that no real crawler will ever see it: a social preview
 * fetches one card once. Exceeding it returns 429 with no-store rather than a
 * placeholder image, so a throttled response never gets cached in place of a
 * real card.
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
    console.error("[og/breakdown] rate-limit check failed", err);
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ a: string; b: string }> },
) {
  const { a: slugA, b: slugB } = await params;
  if (!SLUG_PATTERN.test(slugA ?? "") || !SLUG_PATTERN.test(slugB ?? "")) {
    return notFoundImage("Invalid comparison");
  }

  if (!(await claimSlot(request))) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(RATE_WINDOW_SECONDS) },
    });
  }

  const url = new URL(request.url);
  const lensParam = url.searchParams.get("lens");
  const lens = isLensId(lensParam) ? lensParam : DEFAULT_LENS;

  // The read client resolves format/source the same way the page does. The admin
  // client reads only the service-role-only Power Pulse settings row, exactly as
  // the page's analysis pass does.
  const supabase = await createClient();

  let result;
  try {
    const lookup = await loadBreakdown(supabase, slugA, slugB, {
      formatParam: url.searchParams.get("format") ?? undefined,
      sourceParam: url.searchParams.get("source") ?? undefined,
      lens,
    });
    if (!lookup.ok) return notFoundImage("Players not found");

    const core = lookup.result;
    const context = core.context;
    const pulseSettings = await loadPowerPulseSettings(createAdminClient());
    const extras = await loadBreakdownExtras(
      supabase,
      [core.a, core.b].map((p) => ({
        id: p.id,
        position: p.position,
        team: p.team,
        injuryStatus: p.injuryStatus,
        overallRank: p.overallRank,
      })),
      {
        scoringKey: context.scoringKey,
        formatConfigId: context.formatConfigId,
        valueSource: context.sourceSlug,
        isDynasty: context.isDynasty,
        isSuperflex: context.isSuperflex,
        tePremiumPerReception: 0,
      },
      pulseSettings,
    );

    result = assembleBreakdown({
      a: core.a,
      b: core.b,
      extrasA: mergeMarket(core.a, extras.get(core.a.id) ?? EMPTY_EXTRAS),
      extrasB: mergeMarket(core.b, extras.get(core.b.id) ?? EMPTY_EXTRAS),
      leagueA: null,
      leagueB: null,
      lens,
      valueIsBeacon: context.valueIsBeacon,
      context,
    });
  } catch (err) {
    console.error("[og/breakdown] load failed", err);
    return notFoundImage("Comparison unavailable");
  }

  const { a, b, edge } = result;
  const leaderName = edge.leader === "a" ? a.name : edge.leader === "b" ? b.name : null;
  const headline = edge.leader === "even" ? "Toss-Up" : `${edge.label}: ${leaderName}`;

  const drivers = edge.contributions
    .filter((c) => (edge.leader === "a" ? c.contribution > 0 : c.contribution < 0))
    .slice(0, 2)
    .map((c) => c.label);
  const driverLine =
    edge.leader === "even"
      ? "Graded out even across every category we measure"
      : drivers.length > 0
        ? `Driven by ${drivers.join(" and ").toLowerCase()}`
        : "Weighted across every category we measure";

  const lensLabel =
    lens === "dynasty" ? "Dynasty" : lens === "win-now" ? "Win now" : "This week";

  // Contributions arrive sorted by absolute pull, so the first three are the
  // categories that actually built the margin.
  const topMovers = edge.contributions
    .filter((c) => Math.abs(c.contribution) >= 0.002)
    .slice(0, 3);

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
          padding: 56,
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

        {/* Brand wordmark + lens */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
              }}
            />
            <p style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, margin: 0 }}>
              FF Beacon
            </p>
            <p style={{ fontSize: 20, color: INK_SUBTLE, margin: 0 }}>Beacon Breakdown</p>
          </div>
          <p
            style={{
              fontSize: 18,
              color: CYAN,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: 3,
              fontWeight: 700,
            }}
          >
            {lensLabel}
          </p>
        </div>

        {/* The two players */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}
        >
          <PlayerBlock
            name={a.name}
            position={a.position}
            team={a.team}
            sleeperId={a.sleeperId}
            pct={edge.aPct}
            color={PURPLE}
            align="flex-start"
          />
          <p
            style={{
              fontSize: 30,
              fontWeight: 800,
              color: INK_SUBTLE,
              margin: 0,
              letterSpacing: 2,
            }}
          >
            VS
          </p>
          <PlayerBlock
            name={b.name}
            position={b.position}
            team={b.team}
            sleeperId={b.sleeperId}
            pct={edge.bPct}
            color={CYAN}
            align="flex-end"
          />
        </div>

        {/* The split meter */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: 18,
            borderRadius: 999,
            overflow: "hidden",
            border: `1px solid ${LINE}`,
            background: BG_BASE,
            marginTop: 22,
          }}
        >
          <div
            style={{
              width: `${edge.aPct}%`,
              background: `linear-gradient(90deg, ${PURPLE} 0%, rgba(168,85,247,0.6) 100%)`,
            }}
          />
          <div
            style={{
              width: `${edge.bPct}%`,
              background: `linear-gradient(90deg, rgba(34,211,238,0.6) 0%, ${CYAN} 100%)`,
            }}
          />
        </div>

        {/* Verdict */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, marginTop: 26 }}>
          <h1
            style={{
              fontSize: headline.length > 30 ? 46 : 56,
              fontWeight: 700,
              letterSpacing: -1.5,
              margin: 0,
              lineHeight: 1.05,
            }}
          >
            {clip(headline, 44)}
          </h1>
          <p style={{ fontSize: 26, color: INK_MUTED, margin: "14px 0 0 0" }}>
            {clip(driverLine, 72)}
          </p>

          {/* The itemized margin, so the card carries the same "show your work"
              claim the page makes rather than just asserting a winner. */}
          {topMovers.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
              {topMovers.map((m) => (
                <div
                  key={m.key}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: `1px solid ${LINE}`,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <p style={{ fontSize: 17, color: INK_SUBTLE, margin: 0 }}>
                    {clip(m.label, 26)}
                  </p>
                  <p
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: m.contribution > 0 ? PURPLE : CYAN,
                      margin: "4px 0 0 0",
                    }}
                  >
                    {`${Math.abs(m.contribution * 100).toFixed(1)} pts`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}
        >
          <p style={{ fontSize: 19, color: INK_SUBTLE, margin: 0 }}>
            {edge.metricsUsed} categories scored
          </p>
          <p style={{ fontSize: 19, color: INK_SUBTLE, margin: 0 }}>ffbeacon.com</p>
        </div>
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

function PlayerBlock({
  name,
  position,
  team,
  sleeperId,
  pct,
  color,
  align,
}: {
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
  pct: number;
  color: string;
  align: "flex-start" | "flex-end";
}) {
  const headshot = sleeperId ? `${PLAYER_IMAGE_BASE}/${sleeperId}.jpg` : null;
  const meta = [position?.toUpperCase(), team].filter(Boolean).join(", ");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexDirection: align === "flex-end" ? "row-reverse" : "row",
        }}
      >
        {headshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={headshot}
            alt=""
            width={112}
            height={112}
            style={{
              width: 112,
              height: 112,
              borderRadius: 16,
              objectFit: "cover",
              border: `3px solid ${color}88`,
              background: BG_BASE,
            }}
          />
        ) : (
          <div
            style={{
              width: 112,
              height: 112,
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 38,
              fontWeight: 800,
              color,
              border: `3px solid ${color}55`,
              background: `${color}1A`,
            }}
          >
            {(position || "?").slice(0, 3).toUpperCase()}
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: align,
            minWidth: 0,
          }}
        >
          <p style={{ fontSize: 46, fontWeight: 800, color, margin: 0, lineHeight: 1 }}>{pct}%</p>
          <p
            style={{
              fontSize: 28,
              fontWeight: 700,
              margin: "8px 0 0 0",
              lineHeight: 1.1,
              textAlign: align === "flex-end" ? "right" : "left",
            }}
          >
            {clip(name, 20)}
          </p>
          {meta && <p style={{ fontSize: 19, color: INK_SUBTLE, margin: "4px 0 0 0" }}>{meta}</p>}
        </div>
      </div>
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
  return s.slice(0, n - 1) + "...";
}
