import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { analyzeTrade } from "@/lib/trade-analyzer";
import { loadLeagueDraftSlots } from "@/lib/league-pick-slots";
import type { SleeperLeague } from "@/lib/sleeper";

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

/**
 * GET /api/og/trade/[transaction_id]
 *
 * 1200x630 OG image for a single trade. Renders both sides with values
 * and the differential / verdict. Uses the league's contextual format
 * resolution (player values from selected source, pick values always
 * from KTC per CLAUDE.md).
 *
 * The transaction_id is the Sleeper-side transaction id (string),
 * matched in league_transactions.sleeper_transaction_id. We don't
 * require league_id because the transaction id is globally unique on
 * Sleeper's side AND we can look up its league via the FK.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ transaction_id: string }> },
) {
  const { transaction_id: txId } = await params;
  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");

  if (!txId || txId.length > 64) {
    return new Response("Invalid transaction id", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: txRow } = await supabase
    .from("league_transactions")
    .select(
      "id, sleeper_transaction_id, type, week, season, adds, draft_picks, league_id",
    )
    .eq("sleeper_transaction_id", txId)
    .maybeSingle();
  if (!txRow) return notFoundImage(`Trade ${txId} not found`);
  if (txRow.type !== "trade") {
    return notFoundImage("Not a trade transaction");
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, metadata")
    .eq("id", txRow.league_id)
    .maybeSingle();
  if (!league) return notFoundImage("League not found");

  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(supabase, sleeperLeague, sourceParam);
  if (context.coverage === "none") {
    return notFoundImage("No value data available for this league");
  }

  // Build roster identities for the analyzer
  const [{ data: rosterRows }, { data: userRows }] = await Promise.all([
    supabase
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", league.id),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", league.id),
  ]);
  const userBySleeperId = new Map(userRows?.map((u) => [u.sleeper_user_id, u]) ?? []);
  const rosterIdentities: Record<
    number,
    { teamName: string; ownerHandle: string | null; avatarId: string | null }
  > = {};
  for (const r of rosterRows ?? []) {
    const u = r.owner_user_id ? userBySleeperId.get(r.owner_user_id) : null;
    rosterIdentities[r.sleeper_roster_id] = {
      teamName: u?.team_name || u?.display_name || `Team ${r.sleeper_roster_id}`,
      ownerHandle: u?.display_name ?? null,
      avatarId: u?.avatar ?? null,
    };
  }

  const slotIndex = await loadLeagueDraftSlots(supabase, league.id);
  const analysis = await analyzeTrade(supabase, {
    leagueRowId: league.id,
    adds: (txRow.adds as Record<string, number> | null) ?? null,
    draftPicks: Array.isArray(txRow.draft_picks)
      ? (txRow.draft_picks as unknown[])
      : [],
    rosterIdentities,
    slotIndex,
    context: {
      formatConfigId: context.formatConfigId,
      formatSlug: context.formatSlug,
      formatDisplay: context.formatDisplay,
      sourceSlug: context.sourceSlug,
      sourceDisplay: context.sourceDisplay,
      pickSourceSlug: context.pickSource?.slug ?? null,
      pickSourceDisplay: context.pickSource?.display ?? null,
    },
  });

  if (!analysis || analysis.sides.length === 0) {
    return notFoundImage("Trade has no analyzable assets");
  }

  const winnerSide = analysis.verdict.winnerRosterId
    ? (analysis.sides.find((s) => s.rosterId === analysis.verdict.winnerRosterId) ?? null)
    : null;
  // Prefer the Sleeper username on the verdict line so the share card matches
  // the in-app phrasing. Falls back to team name when no handle is recorded.
  const winnerName = winnerSide
    ? (winnerSide.ownerHandle ? `@${winnerSide.ownerHandle}` : winnerSide.teamName)
    : null;
  const verdictText = buildVerdictText(analysis.verdict, winnerName);

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
          padding: 48,
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

        {/* Brand + league */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${PURPLE} 0%, ${CYAN} 100%)`,
              }}
            />
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>FF Beacon</p>
          </div>
          <p style={{ fontSize: 16, color: INK_MUTED, margin: 0 }}>
            {clip(league.name, 40)}, {league.season}
          </p>
        </div>

        <p
          style={{
            fontSize: 16,
            color: PURPLE,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 3,
            fontWeight: 700,
          }}
        >
          Trade
        </p>
        <h1
          style={{
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: -1,
            margin: "8px 0 24px 0",
          }}
        >
          {verdictText}
        </h1>

        {/* Trade sides */}
        <div
          style={{
            display: "flex",
            gap: 24,
            flex: 1,
          }}
        >
          {analysis.sides.slice(0, 2).map((side, idx) => {
            const isWinner =
              analysis.verdict.winnerRosterId != null &&
              side.rosterId === analysis.verdict.winnerRosterId;
            return (
              <div
                key={side.rosterId}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  padding: 24,
                  borderRadius: 16,
                  border: `2px solid ${isWinner ? CYAN : LINE}`,
                  background: isWinner ? "rgba(34, 211, 238, 0.08)" : "rgba(255, 255, 255, 0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <p
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: INK,
                      margin: 0,
                    }}
                  >
                    {clip(side.teamName, 22)}
                  </p>
                  <p
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: isWinner ? CYAN : INK,
                      margin: 0,
                      fontFamily: "monospace",
                    }}
                  >
                    {formatNumber(side.totalValue)}
                  </p>
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: INK_SUBTLE,
                    margin: "2px 0 12px 0",
                    textTransform: "uppercase",
                    letterSpacing: 2,
                  }}
                >
                  Acquired
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {side.players.slice(0, 4).map((p) => (
                    <div
                      key={`${side.rosterId}-p-${p.sleeperId}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 18,
                        color: INK,
                      }}
                    >
                      <p style={{ margin: 0 }}>
                        {clip(p.name, 22)}
                        {p.position ? (
                          <span style={{ color: INK_SUBTLE, marginLeft: 6 }}>
                            {p.position}
                          </span>
                        ) : null}
                      </p>
                      <p style={{ margin: 0, color: INK_MUTED, fontFamily: "monospace" }}>
                        {formatNumber(p.value)}
                      </p>
                    </div>
                  ))}
                  {side.picks.slice(0, 4).map((pick, pi) => (
                    <div
                      key={`${side.rosterId}-pick-${pi}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 18,
                        color: INK,
                      }}
                    >
                      <p style={{ margin: 0 }}>
                        {pick.season} R{pick.pickLabel ?? pick.round}
                        {!pick.pickLabel && (
                          <span style={{ color: INK_SUBTLE, marginLeft: 6 }}>
                            {pick.pickPosition}
                          </span>
                        )}
                      </p>
                      <p style={{ margin: 0, color: INK_MUTED, fontFamily: "monospace" }}>
                        {formatNumber(pick.value)}
                      </p>
                    </div>
                  ))}
                  {side.players.length + side.picks.length > 4 && (
                    <p style={{ fontSize: 14, color: INK_SUBTLE, margin: 0 }}>
                      +{side.players.length + side.picks.length - 4} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 14, color: INK_SUBTLE, marginTop: 16 }}>
          Values via {context.sourceDisplay}, {context.formatDisplay}
          {context.pickSource && context.pickSource.slug !== context.sourceSlug
            ? `, picks via ${context.pickSource.display}`
            : ""}
        </p>
        <p
          style={{
            position: "absolute",
            bottom: 24,
            right: 48,
            fontSize: 16,
            color: INK_SUBTLE,
            margin: 0,
          }}
        >
          ffbeacon.com
        </p>
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

function buildVerdictText(
  verdict: { label: string; differentialPct: number },
  winnerName: string | null,
): string {
  if (verdict.label === "Even trade") return "Even trade";
  if (!winnerName) return verdict.label;
  if (verdict.label === "Slight edge") {
    return `Slight edge to ${winnerName}`;
  }
  return `${winnerName} won the trade`;
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

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}
