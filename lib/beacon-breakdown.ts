/**
 * Beacon Breakdown data + computation layer.
 *
 * Powers the head-to-head player comparison tool at /tools/beacon-breakdown.
 * Unlike the player profile (which resolves format/source per player), a
 * breakdown compares TWO players on ONE shared, resolved (format, source) pair,
 * so the resolver work happens once here and both players are read against it.
 *
 * Everything the tool renders is backed by real data we already store:
 *   - FF Beacon value          -> player_value_history (loadLatestValue)
 *   - overall / position rank   -> rankings
 *   - tier                      -> rankings.tier
 *   - value trend (7d/30d)      -> player_value_trends (loadTrends)
 *   - recent production         -> get_player_positional_finishes RPC
 *   - opportunity / role        -> Sleeper depth_chart_order (depthRoleForPlayer)
 *   - age                       -> players.birth_date
 *
 * The softer rows (Dynasty / Redraft Outlook, Risk, Upside) are TRANSPARENT
 * blends of those real signals, never fabricated numbers. When an input is
 * missing the row degrades to "Not enough data" and scores no edge, so we never
 * invent a verdict we can't defend.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  getAvailableSources,
  resolveSourceForFormat,
  describeSource,
} from "@/lib/source";
import {
  loadLatestValue,
  loadTrends,
  loadPositionalFinishes,
  recentFinishesForScoring,
  depthRoleForPlayer,
  readSleeperId,
  scoringKeyForType,
  type PositionalFinish,
  type PlayerRow,
} from "@/lib/player-profile";
import { BEACON_SOURCE_SLUG } from "@/components/beacon-value-icon";
import { computeAgeDecimal } from "@/lib/player-age";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Which side of the matchup holds the edge for a given row or takeaway. */
export type EdgeWinner = "a" | "b" | "even" | "na";

/** The two players slotted into the matchup. */
export type BreakdownSlot = "a" | "b";

/** Everything one player contributes to the comparison, already resolved for
 * the shared (format, source) pair. */
export type BreakdownPlayer = {
  slug: string;
  id: string;
  name: string;
  position: string;
  team: string | null;
  /** The team's primary brand color (nfl_teams.primary_color), for the card
   * gradient. Null when the player is a free agent or the team is unmapped. */
  teamPrimary: string | null;
  sleeperId: string | null;
  /** Whole-years age, used for the youth/age scoring below. */
  age: number | null;
  /** Exact age carried to one decimal, for display only (e.g. 23.4). */
  ageDecimal: number | null;
  yearsExperience: number | null;
  value: number | null;
  overallRank: number | null;
  positionRank: number | null;
  tier: number | null;
  change7d: number | null;
  change30d: number | null;
  change30dPct: number | null;
  trend30d: "up" | "down" | "stable" | null;
  volatility30d: number | null;
  latestFinish: PositionalFinish | null;
  recentFinishes: PositionalFinish[];
  depthRole: string | null;
};

/** One comparison row in the breakdown table. */
export type BreakdownRow = {
  key: string;
  /** Plain-language category label. */
  label: string;
  /** One-sentence explanation of what the row measures. */
  help: string;
  /** Player A's cell value (already formatted for display). */
  aDisplay: string;
  /** Player B's cell value. */
  bDisplay: string;
  /** Optional short qualitative note under each cell (derived rows). */
  aNote?: string;
  bNote?: string;
  winner: EdgeWinner;
  /** True when the numbers render with the FF Beacon value mark. */
  valueIsBeacon?: boolean;
};

export type EdgeLabel = "Toss-Up" | "Slight Edge" | "Clear Edge" | "Strong Edge";

/** The headline "Beacon Edge" verdict meter. */
export type BeaconEdge = {
  /** Player A's share of the combined signal, 0-100 (a + b === 100). */
  aPct: number;
  bPct: number;
  leader: "a" | "b" | "even";
  label: EdgeLabel;
  /** What the meter is measured on ("FF Beacon Value" or "Overall Rank"). */
  basis: string;
};

/** A plain-English scannable takeaway. */
export type Takeaway = {
  key: string;
  label: string;
  winner: EdgeWinner;
  detail: string;
};

export type BreakdownContext = {
  formatSlug: string;
  formatDisplay: string;
  sourceSlug: string | null;
  sourceDisplay: string | null;
  valueIsBeacon: boolean;
  /** Present when the requested source could not cover this format. */
  fallbackBanner: { requested: string; actual: string; formatDisplay: string } | null;
};

export type BreakdownResult = {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  rows: BreakdownRow[];
  edge: BeaconEdge;
  takeaways: Takeaway[];
  verdict: string;
  context: BreakdownContext;
};

/** A player option returned by resolveBreakdownPlayers when a slug is unknown. */
export type BreakdownLookup =
  | { ok: true; result: BreakdownResult }
  | { ok: false; missing: string[] };

const PLAYER_SELECT =
  "id, slug, first_name, last_name, full_name, position, team, status, birth_date, external_ids, metadata, years_experience";

/** Age in whole years from an ISO birth date, or null. Mirrors the profile bio
 * helper; kept local so the lib has no component dependency. */
function computeAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const parts = birthDate.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [y, m, d] = parts;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 80 ? age : null;
}

function normalizeTrend(dir: string | null): "up" | "down" | "stable" | null {
  if (dir === "up" || dir === "down" || dir === "stable") return dir;
  return null;
}

/** Depth-chart role -> opportunity weight (higher = more volume). null when
 * the player is not depth-charted. */
function roleWeight(role: string | null): number | null {
  if (!role) return null;
  switch (role) {
    case "Starter":
      return 4;
    case "Handcuff":
    case "Backup":
      return 2;
    case "Depth Piece":
      return 1;
    case "Dart Throw":
      return 0;
    default:
      return null;
  }
}

/**
 * Resolve the shared (format, source) context and load both players, then
 * compute the full breakdown. Slugs that match no active player are returned in
 * `missing` so the page can render a friendly "player not found" state.
 */
export async function loadBreakdown(
  supabase: AnySupabase,
  slugA: string,
  slugB: string,
  params: { formatParam?: string; sourceParam?: string },
): Promise<BreakdownLookup> {
  const db = supabase as SupabaseClient<Database>;

  const [formatResolution, sourceResolution, { data: playerRows }] = await Promise.all([
    resolveFormatSlug(db, params.formatParam),
    resolveSourceSlug(db, params.sourceParam),
    db.from("players").select(PLAYER_SELECT).in("slug", [slugA, slugB]),
  ]);

  const bySlug = new Map<string, PlayerRow>();
  for (const row of (playerRows ?? []) as unknown as PlayerRow[]) {
    bySlug.set(row.slug, row);
  }
  const missing = [slugA, slugB].filter((s) => !bySlug.has(s));
  if (missing.length > 0) return { ok: false, missing };

  const [{ data: formatConfig }, registry] = await Promise.all([
    db
      .from("format_configs")
      .select("id, slug, display_name, scoring_type")
      .eq("slug", formatResolution.slug)
      .maybeSingle(),
    getAvailableSources(db),
  ]);

  const formatConfigId = formatConfig?.id ?? null;
  const formatDisplay = formatConfig?.display_name ?? formatResolution.slug;
  const scoringKey = scoringKeyForType(formatConfig?.scoring_type);
  const requestedSource = sourceResolution.slug;

  const valueResolution = formatConfig
    ? resolveSourceForFormat(registry, "player_value_history", formatConfig.slug, requestedSource)
    : { source: null, requested: requestedSource, fellBack: false, availableForFormat: [] };
  const rankingsResolution = formatConfig
    ? resolveSourceForFormat(registry, "rankings", formatConfig.slug, requestedSource)
    : { source: null, requested: requestedSource, fellBack: false, availableForFormat: [] };

  const valueSource = valueResolution.source;
  const rankingsSource = rankingsResolution.source;

  const fallbackBanner =
    valueResolution.fellBack && valueResolution.source
      ? {
          requested: describeSource(registry, valueResolution.requested),
          actual: describeSource(registry, valueResolution.source),
          formatDisplay,
        }
      : null;

  // Team primary colors for the matchup card gradients, one query for both.
  const teamColors = new Map<string, string>();
  const teamAbbrs = [bySlug.get(slugA)!.team, bySlug.get(slugB)!.team].filter(
    (t): t is string => Boolean(t),
  );
  if (teamAbbrs.length > 0) {
    const { data: teamRows } = await db
      .from("nfl_teams")
      .select("abbreviation, primary_color")
      .in("abbreviation", teamAbbrs);
    for (const t of teamRows ?? []) {
      if (t.primary_color) teamColors.set(t.abbreviation, t.primary_color);
    }
  }

  // Latest season-long rankings for both players in one query, newest first so
  // the first row we see per player is the current one.
  const rankByPlayer = new Map<
    string,
    { overall: number | null; position: number | null; tier: number | null }
  >();
  if (formatConfigId && rankingsSource) {
    const ids = [bySlug.get(slugA)!.id, bySlug.get(slugB)!.id];
    const { data: rankRows } = await db
      .from("rankings")
      .select("player_id, overall_rank, position_rank, tier, generated_at")
      .eq("format_config_id", formatConfigId)
      .eq("source", rankingsSource)
      .is("week", null)
      .in("player_id", ids)
      .order("generated_at", { ascending: false });
    for (const r of rankRows ?? []) {
      if (rankByPlayer.has(r.player_id)) continue;
      rankByPlayer.set(r.player_id, {
        overall: r.overall_rank ?? null,
        position: r.position_rank ?? null,
        tier: r.tier ?? null,
      });
    }
  }

  async function buildPlayer(row: PlayerRow): Promise<BreakdownPlayer> {
    const [value, trends, finishes] = await Promise.all([
      loadLatestValue(db, row.id, formatConfigId, valueSource),
      loadTrends(db, row.id, formatConfigId, valueSource),
      loadPositionalFinishes(db, row.id),
    ]);
    const recent = recentFinishesForScoring(finishes, scoringKey, 3);
    const rank = rankByPlayer.get(row.id);
    return {
      slug: row.slug,
      id: row.id,
      name: row.full_name ?? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
      position: row.position,
      team: row.team,
      teamPrimary: row.team ? teamColors.get(row.team) ?? null : null,
      sleeperId: readSleeperId(row),
      age: computeAge(row.birth_date),
      ageDecimal: computeAgeDecimal(row.birth_date),
      yearsExperience: row.years_experience ?? null,
      value: value ?? trends?.current_value ?? null,
      overallRank: rank?.overall ?? null,
      positionRank: rank?.position ?? null,
      tier: rank?.tier ?? null,
      change7d: trends?.change_7d ?? null,
      change30d: trends?.change_30d ?? null,
      change30dPct: trends?.change_30d_pct ?? null,
      trend30d: normalizeTrend(trends?.trend_30d ?? null),
      volatility30d: null, // loadTrends does not select volatility; reserved.
      latestFinish: recent[0] ?? null,
      recentFinishes: recent,
      depthRole: depthRoleForPlayer(row),
    };
  }

  const rowA = bySlug.get(slugA)!;
  const rowB = bySlug.get(slugB)!;
  const [a, b] = await Promise.all([buildPlayer(rowA), buildPlayer(rowB)]);

  const valueIsBeacon = valueSource === BEACON_SOURCE_SLUG;
  const rows = buildRows(a, b, valueIsBeacon);
  const edge = computeEdge(a, b);
  const takeaways = buildTakeaways(a, b);
  const verdict = buildVerdict(a, b, edge);

  return {
    ok: true,
    result: {
      a,
      b,
      rows,
      edge,
      takeaways,
      verdict,
      context: {
        formatSlug: formatResolution.slug,
        formatDisplay,
        sourceSlug: valueSource,
        sourceDisplay: valueSource ? describeSource(registry, valueSource) : null,
        valueIsBeacon,
        fallbackBanner,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Scoring helpers (all pairwise, so no source-scale assumptions leak) */
/* ------------------------------------------------------------------ */

/** Pairwise share for a "higher is better" metric. Returns a's share of the
 * pair in 0..1, or null when either input is missing. */
function shareHigh(aVal: number | null, bVal: number | null): number | null {
  if (aVal == null || bVal == null) return null;
  const total = aVal + bVal;
  if (total <= 0) return 0.5;
  return aVal / total;
}

/** Pairwise share for a "lower is better" metric (ranks, finishes). */
function shareLow(aVal: number | null, bVal: number | null): number | null {
  if (aVal == null || bVal == null) return null;
  const ia = 1 / Math.max(aVal, 0.5);
  const ib = 1 / Math.max(bVal, 0.5);
  const total = ia + ib;
  if (total <= 0) return 0.5;
  return ia / total;
}

/** Absolute youth score 0..1: 22-or-younger = 1, 28-or-older = 0. */
function youthScore(age: number | null): number | null {
  if (age == null) return null;
  const s = (28 - age) / (28 - 22);
  return Math.min(1, Math.max(0, s));
}

/** Absolute production score 0..1 from a positional finish (1 = best). */
function productionScore(finish: number | null): number | null {
  if (finish == null) return null;
  return Math.min(1, Math.max(0, 1 - (finish - 1) / 24));
}

/** Turn an a-share (0..1) into an EdgeWinner with a near-even guard. */
function winnerFromShare(share: number | null, guard = 0.03): EdgeWinner {
  if (share == null) return "na";
  if (share > 0.5 + guard) return "a";
  if (share < 0.5 - guard) return "b";
  return "even";
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function fmtValue(v: number | null): string {
  return v != null && v > 0 ? v.toLocaleString() : "-";
}

function fmtRank(r: number | null): string {
  return r != null ? `#${r}` : "-";
}

function finishText(p: BreakdownPlayer): string {
  const f = p.latestFinish;
  if (!f) return "-";
  return `${p.position.toUpperCase()}${f.finish} (${f.season})`;
}

function fmtChange(pct: number | null, raw: number | null): string {
  if (pct == null && raw == null) return "Flat";
  if (raw != null && raw === 0) return "Flat";
  const sign = (raw ?? pct ?? 0) > 0 ? "+" : "";
  if (pct != null) return `${sign}${pct.toFixed(1)}%`;
  return `${sign}${(raw ?? 0).toLocaleString()}`;
}

function dynastyPhrase(p: BreakdownPlayer): string {
  const strong = p.tier != null ? p.tier <= 2 : (p.value ?? 0) > 5000;
  const mid = p.tier != null ? p.tier <= 4 : (p.value ?? 0) > 2000;
  const young = p.age != null && p.age <= 24;
  const old = p.age != null && p.age >= 29;
  if (strong && young) return "Cornerstone";
  if (strong && old) return "Win-now asset";
  if (strong) return "Blue-chip";
  if (mid && young) return "Ascending";
  if (mid && old) return "Fading vet";
  if (young) return "Long-term dart";
  return "Depth hold";
}

function redraftPhrase(p: BreakdownPlayer): string {
  const f = p.latestFinish?.finish ?? null;
  const rank = p.overallRank ?? null;
  if (f != null && f <= 6) return "Weekly starter";
  if (rank != null && rank <= 24) return "Weekly starter";
  if ((f != null && f <= 18) || (rank != null && rank <= 60)) return "Every-week flex";
  if ((f != null && f <= 36) || (rank != null && rank <= 120)) return "Matchup play";
  return "Bench / streamer";
}

function riskPhrase(p: BreakdownPlayer): string {
  const swingy = p.change30dPct != null && Math.abs(p.change30dPct) >= 12;
  const old = p.age != null && p.age >= 29;
  const proven = p.tier != null && p.tier <= 2;
  if (proven && !old && !swingy) return "Rock solid";
  if (old && swingy) return "Volatile";
  if (old) return "Age risk";
  if (swingy) return "Swingy";
  return "Steady";
}

function upsidePhrase(p: BreakdownPlayer): string {
  const rising = p.trend30d === "up" || (p.change30dPct != null && p.change30dPct >= 5);
  const young = p.age != null && p.age <= 24;
  const highTier = p.tier != null && p.tier <= 2;
  if (rising && young) return "Breakout arrow";
  if (highTier && young) return "Ceiling play";
  if (rising) return "Trending up";
  if (young) return "Room to grow";
  if (p.trend30d === "down") return "Cooling off";
  return "Known quantity";
}

/** Risk score where HIGHER = safer, so shareHigh flags the safer player. */
function safetyScore(p: BreakdownPlayer): number | null {
  const parts: number[] = [];
  const youth = youthScore(p.age);
  if (youth != null) parts.push(youth);
  if (p.change30dPct != null) {
    // Less movement = safer. 0% swing -> 1, 25%+ swing -> 0.
    parts.push(Math.min(1, Math.max(0, 1 - Math.abs(p.change30dPct) / 25)));
  }
  if (p.tier != null) {
    // Proven tier is safer. Tier 1 -> 1, tier 6 -> 0.
    parts.push(Math.min(1, Math.max(0, (6 - p.tier) / 5)));
  }
  if (parts.length === 0) return null;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

/** Upside score, higher = more upside. */
function upsideScore(p: BreakdownPlayer): number | null {
  const parts: number[] = [];
  const youth = youthScore(p.age);
  if (youth != null) parts.push(youth);
  if (p.change30dPct != null) {
    parts.push(Math.min(1, Math.max(0, 0.5 + p.change30dPct / 40)));
  }
  if (p.tier != null) {
    parts.push(Math.min(1, Math.max(0, (6 - p.tier) / 5)));
  }
  if (parts.length === 0) return null;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

function buildRows(
  a: BreakdownPlayer,
  b: BreakdownPlayer,
  valueIsBeacon: boolean,
): BreakdownRow[] {
  const rows: BreakdownRow[] = [];

  // 1. FF Beacon Value
  rows.push({
    key: "value",
    label: "FF Beacon Value",
    help: "Current market value on the trusted FF Beacon scale for this format.",
    aDisplay: fmtValue(a.value),
    bDisplay: fmtValue(b.value),
    winner: winnerFromShare(shareHigh(a.value, b.value), 0.02),
    valueIsBeacon,
  });

  // 2. Overall Rank
  rows.push({
    key: "overall-rank",
    label: "Overall Rank",
    help: "Where each player sits among every player at every position.",
    aDisplay: fmtRank(a.overallRank),
    bDisplay: fmtRank(b.overallRank),
    winner: winnerFromShare(shareLow(a.overallRank, b.overallRank), 0),
  });

  // 3. Positional Rank
  rows.push({
    key: "position-rank",
    label: "Positional Rank",
    help: "Rank within their own position group.",
    aDisplay: a.positionRank != null ? `${a.position.toUpperCase()}${a.positionRank}` : "-",
    bDisplay: b.positionRank != null ? `${b.position.toUpperCase()}${b.positionRank}` : "-",
    winner: winnerFromShare(shareLow(a.positionRank, b.positionRank), 0),
  });

  // 4. Recent Production
  rows.push({
    key: "production",
    label: "Recent Production",
    help: "Most recent full-season finish within their position by fantasy points.",
    aDisplay: finishText(a),
    bDisplay: finishText(b),
    winner: winnerFromShare(
      shareLow(a.latestFinish?.finish ?? null, b.latestFinish?.finish ?? null),
      0,
    ),
  });

  // 5. Opportunity / Volume
  rows.push({
    key: "opportunity",
    label: "Opportunity",
    help: "Role on their team's depth chart, a proxy for expected volume.",
    aDisplay: a.depthRole ?? "-",
    bDisplay: b.depthRole ?? "-",
    winner: winnerFromShare(shareHigh(roleWeight(a.depthRole), roleWeight(b.depthRole)), 0.05),
  });

  // 6. Value Trend (30-day)
  rows.push({
    key: "trend",
    label: "30-Day Trend",
    help: "How each player's value has moved over the last month.",
    aDisplay: fmtChange(a.change30dPct, a.change30d),
    bDisplay: fmtChange(b.change30dPct, b.change30d),
    winner: winnerFromShare(
      shareHigh(
        a.change30dPct != null ? a.change30dPct + 100 : null,
        b.change30dPct != null ? b.change30dPct + 100 : null,
      ),
      0.01,
    ),
  });

  // 7. Dynasty Outlook (value + youth)
  {
    const vShare = shareHigh(a.value, b.value);
    const yShare = shareHigh(youthScore(a.age), youthScore(b.age));
    let share: number | null = null;
    if (vShare != null && yShare != null) share = 0.6 * vShare + 0.4 * yShare;
    else share = vShare ?? yShare;
    rows.push({
      key: "dynasty",
      label: "Dynasty Outlook",
      help: "Long-term hold value, blending market value with age.",
      aDisplay: dynastyPhrase(a),
      bDisplay: dynastyPhrase(b),
      aNote: a.ageDecimal != null ? `Age ${a.ageDecimal.toFixed(1)}` : undefined,
      bNote: b.ageDecimal != null ? `Age ${b.ageDecimal.toFixed(1)}` : undefined,
      winner: winnerFromShare(share, 0.04),
    });
  }

  // 8. Redraft Outlook (overall rank + recent production)
  {
    const rShare = shareLow(a.overallRank, b.overallRank);
    const pShare = shareHigh(
      productionScore(a.latestFinish?.finish ?? null),
      productionScore(b.latestFinish?.finish ?? null),
    );
    let share: number | null = null;
    if (rShare != null && pShare != null) share = 0.6 * rShare + 0.4 * pShare;
    else share = rShare ?? pShare;
    rows.push({
      key: "redraft",
      label: "Redraft Outlook",
      help: "Win-now value for this season, blending rank with recent production.",
      aDisplay: redraftPhrase(a),
      bDisplay: redraftPhrase(b),
      winner: winnerFromShare(share, 0.04),
    });
  }

  // 9. Age & Long-Term Appeal
  rows.push({
    key: "age",
    label: "Age & Long-Term Appeal",
    help: "Younger players hold value longer in dynasty formats.",
    aDisplay: a.ageDecimal != null ? `${a.ageDecimal.toFixed(1)} yrs` : "-",
    bDisplay: b.ageDecimal != null ? `${b.ageDecimal.toFixed(1)} yrs` : "-",
    winner: winnerFromShare(shareHigh(youthScore(a.age), youthScore(b.age)), 0.06),
  });

  // 10. Risk Level (edge to the safer player)
  rows.push({
    key: "risk",
    label: "Risk Level",
    help: "Lower-risk profiles combine a proven tier, steady value, and prime age.",
    aDisplay: riskPhrase(a),
    bDisplay: riskPhrase(b),
    winner: winnerFromShare(shareHigh(safetyScore(a), safetyScore(b)), 0.05),
  });

  // 11. Upside
  rows.push({
    key: "upside",
    label: "Upside",
    help: "Room to climb, blending recent momentum, youth, and tier.",
    aDisplay: upsidePhrase(a),
    bDisplay: upsidePhrase(b),
    winner: winnerFromShare(shareHigh(upsideScore(a), upsideScore(b)), 0.05),
  });

  return rows;
}

/* ------------------------------------------------------------------ */
/* Beacon Edge meter                                                   */
/* ------------------------------------------------------------------ */

function labelForShare(higherShare: number): EdgeLabel {
  // higherShare is the leader's share of the combined signal (0.5..1).
  if (higherShare < 0.53) return "Toss-Up";
  if (higherShare < 0.58) return "Slight Edge";
  if (higherShare < 0.67) return "Clear Edge";
  return "Strong Edge";
}

function computeEdge(a: BreakdownPlayer, b: BreakdownPlayer): BeaconEdge {
  // Prefer FF Beacon value (the single trusted scale). Fall back to overall
  // rank when either value is missing so the meter still resolves.
  let aShare = shareHigh(a.value, b.value);
  let basis = "FF Beacon Value";
  if (aShare == null) {
    aShare = shareLow(a.overallRank, b.overallRank);
    basis = "Overall Rank";
  }
  if (aShare == null) {
    return { aPct: 50, bPct: 50, leader: "even", label: "Toss-Up", basis: "Not enough data" };
  }
  const aPct = Math.round(aShare * 100);
  const bPct = 100 - aPct;
  const higherShare = Math.max(aShare, 1 - aShare);
  const label = labelForShare(higherShare);
  const leader = label === "Toss-Up" ? "even" : aShare > 0.5 ? "a" : "b";
  return { aPct, bPct, leader, label, basis };
}

/* ------------------------------------------------------------------ */
/* Quick takeaways + verdict                                           */
/* ------------------------------------------------------------------ */

function nameFor(a: BreakdownPlayer, b: BreakdownPlayer, w: EdgeWinner): string {
  if (w === "a") return a.name;
  if (w === "b") return b.name;
  return "Too close to call";
}

function buildTakeaways(a: BreakdownPlayer, b: BreakdownPlayer): Takeaway[] {
  const out: Takeaway[] = [];

  // Best long-term value (dynasty blend)
  {
    const vShare = shareHigh(a.value, b.value);
    const yShare = shareHigh(youthScore(a.age), youthScore(b.age));
    const share = vShare != null && yShare != null ? 0.6 * vShare + 0.4 * yShare : vShare ?? yShare;
    const w = winnerFromShare(share, 0.04);
    out.push({
      key: "long-term",
      label: "Best long-term value",
      winner: w,
      detail:
        w === "even"
          ? "Their dynasty profiles grade out even."
          : `${nameFor(a, b, w)} pairs the stronger value and age profile for the long haul.`,
    });
  }

  // Best win-now option (redraft blend)
  {
    const rShare = shareLow(a.overallRank, b.overallRank);
    const pShare = shareHigh(
      productionScore(a.latestFinish?.finish ?? null),
      productionScore(b.latestFinish?.finish ?? null),
    );
    const share = rShare != null && pShare != null ? 0.6 * rShare + 0.4 * pShare : rShare ?? pShare;
    const w = winnerFromShare(share, 0.04);
    out.push({
      key: "win-now",
      label: "Best win-now option",
      winner: w,
      detail:
        w === "even"
          ? "Both offer similar production for this season."
          : `${nameFor(a, b, w)} is the safer start for winning this week.`,
    });
  }

  // Safer floor
  {
    const w = winnerFromShare(shareHigh(safetyScore(a), safetyScore(b)), 0.05);
    out.push({
      key: "floor",
      label: "Safer floor",
      winner: w,
      detail:
        w === "even"
          ? "Neither carries meaningfully more risk than the other."
          : `${nameFor(a, b, w)} has the steadier, lower-risk profile.`,
    });
  }

  // Higher upside
  {
    const w = winnerFromShare(shareHigh(upsideScore(a), upsideScore(b)), 0.05);
    out.push({
      key: "upside",
      label: "Higher upside",
      winner: w,
      detail:
        w === "even"
          ? "Their ceilings look comparable right now."
          : `${nameFor(a, b, w)} has more room to climb from here.`,
    });
  }

  // Better trade target (value + momentum)
  {
    const vShare = shareHigh(a.value, b.value);
    const mShare = shareHigh(
      a.change30dPct != null ? a.change30dPct + 100 : null,
      b.change30dPct != null ? b.change30dPct + 100 : null,
    );
    const share = vShare != null && mShare != null ? 0.7 * vShare + 0.3 * mShare : vShare ?? mShare;
    const w = winnerFromShare(share, 0.03);
    out.push({
      key: "trade-target",
      label: "Better trade target",
      winner: w,
      detail:
        w === "even"
          ? "Value and momentum are a wash between them."
          : `${nameFor(a, b, w)} carries the stronger, more in-demand signal.`,
    });
  }

  return out;
}

function buildVerdict(a: BreakdownPlayer, b: BreakdownPlayer, edge: BeaconEdge): string {
  // Dynasty vs redraft leaders drive the nuance.
  const vShare = shareHigh(a.value, b.value);
  const yShare = shareHigh(youthScore(a.age), youthScore(b.age));
  const dynShare = vShare != null && yShare != null ? 0.6 * vShare + 0.4 * yShare : vShare ?? yShare;
  const dynW = winnerFromShare(dynShare, 0.04);

  const rShare = shareLow(a.overallRank, b.overallRank);
  const pShare = shareHigh(
    productionScore(a.latestFinish?.finish ?? null),
    productionScore(b.latestFinish?.finish ?? null),
  );
  const redShare = rShare != null && pShare != null ? 0.6 * rShare + 0.4 * pShare : rShare ?? pShare;
  const redW = winnerFromShare(redShare, 0.04);

  if (edge.label === "Toss-Up") {
    return `This one is close. ${a.name} and ${b.name} grade out nearly even on the Beacon Edge, so your league format and roster needs should break the tie.`;
  }

  const leaderName = edge.leader === "a" ? a.name : b.name;
  const otherName = edge.leader === "a" ? b.name : a.name;

  // Clean sweep: same player leads dynasty and redraft.
  if (dynW !== "na" && dynW === redW && nameFor(a, b, dynW) === leaderName) {
    return `${leaderName} is the clearer pick, holding the ${edge.label.toLowerCase()} on the Beacon Edge with the stronger long-term value and the better win-now production. ${otherName} is the fallback, not the favorite.`;
  }

  // Split profile: one wins dynasty, the other win-now.
  if (dynW !== "na" && redW !== "na" && dynW !== redW && dynW !== "even" && redW !== "even") {
    const dynName = nameFor(a, b, dynW);
    const redName = nameFor(a, b, redW);
    return `${dynName} carries the stronger long-term dynasty signal, while ${redName} offers the safer win-now production profile. ${leaderName} holds the overall ${edge.label.toLowerCase()} once value is weighed.`;
  }

  return `${leaderName} holds the ${edge.label.toLowerCase()} on the Beacon Edge, grading out ahead of ${otherName} across the signals that matter most for this format.`;
}
