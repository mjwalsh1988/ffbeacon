/**
 * On The Clock ranked-board loader (server-side, consume-only).
 *
 * Builds the draftable big board for a (format, source, season) by reading the
 * SAME rows the Rankings Board reads: rankings (rank/tier/position_rank + players
 * join), latest player_value_history value, and player_value_trends 7d movement.
 * It does NOT change the Rankings Board and does NOT touch any value pipeline.
 *
 * Two behaviors worth knowing (see progress.md OTC-T080 / OTC-T087):
 *  - Board season = the latest published ranking-season partition for the (format,
 *    source). This is a LABEL only, exactly like the production Rankings Board,
 *    which reads a fixed board season (currently 2025) rather than the calendar/NFL
 *    season. rankings.generated_at is refreshed daily and values come from the
 *    latest player_value_history rows, so the board is ALWAYS current regardless of
 *    the label. We do NOT use currentNflSeason() for the board, and the UI must not
 *    imply staleness. The no-rankings empty state triggers only when a (format,
 *    source) has zero ranking rows.
 *  - Per-table source resolution. Rankings and values can resolve to different
 *    sources (exactly as app/rankings/page.tsx does), via resolveSourceForFormat.
 *
 * K/DEF appear only when an active source ranks them (today only ffbeacon does, and
 * it is gated off); the loader includes them when present and coerces positions to
 * the six DraftPosition buckets.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { FFBEACON_SOURCE_SLUG, FFBEACON_SOURCE_DISPLAY } from "@/lib/signal-check/format";
import { computeAgeDecimal } from "@/lib/player-age";
import type { BoardResult, DraftPosition, PickBucketValue, RankedPlayer } from "./board-types";

type Client = SupabaseClient<Database>;

// The board must include every ranked player for the format, including K/DEF,
// which sit low by value (overall_rank ~500-800 for FF Beacon dynasty-SF: 797
// ranked total, K/DEF starting ~509). A 500 cap would truncate K/DEF out, so the
// cap is generous headroom over the largest current board (~800). The available
// list is paginated client-side, so the larger row count costs nothing visually.
const BOARD_ROW_CAP = 1500;

/** Coerce a raw players.position to one of the six draftable buckets, or null. */
export function toDraftPosition(pos: string | null | undefined): DraftPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DEF" || p === "DST") return "DEF";
  if (p === "PK") return "K";
  return null;
}

/**
 * Rookie when the player is in their first year. years_experience === 0 is the
 * source of truth; when it is null we fall back to "drafted this NFL season"
 * (draft_year === the incoming-class season). rookieSeason is the current class
 * year (currentNflSeason()), which is independent of the value-board season.
 */
export function deriveIsRookie(
  yearsExperience: number | null,
  draftYear: number | null,
  rookieSeasonNum: number,
): boolean {
  if (typeof yearsExperience === "number") return yearsExperience === 0;
  if (typeof draftYear === "number") return draftYear === rookieSeasonNum;
  return false;
}

/** Whole-years age from a birth_date (YYYY-MM-DD), or undefined. */
export function ageFromBirthDate(birthDate: string | null, now: Date): number | undefined {
  if (!birthDate) return undefined;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return undefined;
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 80 ? age : undefined;
}

function readSleeperId(externalIds: Record<string, unknown> | null): string | null {
  const v = externalIds?.sleeper;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  return null;
}

interface RankingJoinRow {
  overall_rank: number;
  position_rank: number;
  tier: number | null;
  players: {
    id: string;
    first_name: string;
    last_name: string;
    position: string;
    team: string | null;
    external_ids: Record<string, unknown> | null;
    draft_year: number | null;
    years_experience: number | null;
    birth_date: string | null;
  };
}

function emptyResult(
  status: BoardResult["status"],
  formatSlug: string,
  formatLabel: string,
  sourceLabel: string,
  sourceActive: boolean,
): BoardResult {
  return {
    status,
    players: [],
    formatSlug,
    formatLabel,
    sourceSlug: FFBEACON_SOURCE_SLUG,
    sourceLabel,
    valueSourceSlug: FFBEACON_SOURCE_SLUG,
    sourceActive,
    season: "",
    pickValues: [],
  };
}

/**
 * Reduce the raw ffbeacon draft_pick_values rows (captured_at desc) to the latest
 * value per (season, round, bucket). Only the three real buckets are kept;
 * 'unknown' is dropped. Values are coerced to finite numbers (PostgREST can return
 * numeric columns as strings).
 */
export function shapePickValues(
  rows: { season: number; round: number; pick_position: string; value: number | string }[],
): PickBucketValue[] {
  const out: PickBucketValue[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const bucket = row.pick_position;
    if (bucket !== "early" && bucket !== "mid" && bucket !== "late") continue;
    const key = `${row.season}|${row.round}|${bucket}`;
    if (seen.has(key)) continue; // captured_at desc, so the first per key is latest
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    seen.add(key);
    out.push({ season: row.season, round: row.round, bucket, value });
  }
  return out;
}

/**
 * Load the FF Beacon ranked board for a format. On The Clock FORCES the value
 * source to FF Beacon ("ffbeacon"); it does NOT use the global source selector.
 * Mirroring Signal Check, the loader reads FF Beacon data regardless of the
 * source's is_active flag (it gates only on the source ROW existing and having
 * ranking data); is_active=false is surfaced as sourceActive=false (an admin
 * note), not a hard block. A missing source row returns "source-unavailable".
 *
 * The board season is the LATEST published ffbeacon ranking-season partition for
 * the format (a LABEL only; rankings regenerate daily and values come from the
 * latest player_value_history rows, so values are always current). `rookieSeason`
 * (currentNflSeason()) is used only for rookie derivation.
 */
export async function loadRankedBoard(
  supabase: Client,
  params: {
    formatSlug: string;
    rookieSeason: string;
  },
): Promise<BoardResult> {
  const { formatSlug, rookieSeason } = params;

  try {
    // The FF Beacon source row (read regardless of is_active, like Signal Check).
    const { data: sourceRow } = await supabase
      .from("source_registry")
      .select("slug, display_name, is_active")
      .eq("slug", FFBEACON_SOURCE_SLUG)
      .maybeSingle();

    if (!sourceRow) {
      // The FF Beacon source row is missing entirely: a config/admin problem.
      return emptyResult("source-unavailable", formatSlug, formatSlug, FFBEACON_SOURCE_DISPLAY, false);
    }
    const sourceActive = Boolean(sourceRow.is_active);
    const sourceLabel = sourceRow.display_name || FFBEACON_SOURCE_DISPLAY;

    const { data: format } = await supabase
      .from("format_configs")
      .select("id, slug, display_name")
      .eq("slug", formatSlug)
      .maybeSingle();

    if (!format) {
      return emptyResult("error", formatSlug, formatSlug, sourceLabel, sourceActive);
    }

    // The board season = the latest published ffbeacon ranking-season partition for
    // this format. A LABEL only (see the function doc); not a freshness signal.
    const { data: latestRow } = await supabase
      .from("rankings")
      .select("season")
      .eq("format_config_id", format.id)
      .eq("source", FFBEACON_SOURCE_SLUG)
      .is("week", null)
      .order("season", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow) {
      return emptyResult("no-rankings", format.slug, format.display_name, sourceLabel, sourceActive);
    }
    const seasonToUse = latestRow.season as number;

    // Rankings (with the player fields the cockpit needs) + values + trends, all
    // for source='ffbeacon', in parallel. We do NOT filter player_value_history by
    // player id: with hundreds of UUIDs the PostgREST URL overflows; the (format,
    // source) pair already bounds the rows (mirrors the Rankings Board note).
    const [rankingsResult, valuesResult, trendsResult, picksResult, stealsResult] = await Promise.all([
      supabase
        .from("rankings")
        .select(
          "overall_rank, position_rank, tier, players!inner(id, first_name, last_name, position, team, external_ids, draft_year, years_experience, birth_date)",
        )
        .eq("format_config_id", format.id)
        .eq("source", FFBEACON_SOURCE_SLUG)
        .eq("season", seasonToUse)
        .is("week", null)
        .order("overall_rank")
        .limit(BOARD_ROW_CAP),
      supabase
        .from("player_value_history")
        .select("player_id, value, captured_at")
        .eq("format_config_id", format.id)
        .eq("source", FFBEACON_SOURCE_SLUG)
        .order("captured_at", { ascending: false }),
      supabase
        .from("player_value_trends")
        .select("player_id, change_7d, change_7d_pct, trend_7d, show_trend_7d")
        .eq("format_config_id", format.id)
        .eq("source", FFBEACON_SOURCE_SLUG),
      // FF Beacon draft-pick values for this format (forced ffbeacon source, never
      // KTC). Latest snapshot per (season, round, bucket) is taken in shapePickValues.
      // Empty for redraft formats, which publish no future picks; the Trade Analyzer
      // then simply offers no future-pick buckets.
      supabase
        .from("draft_pick_values")
        .select("season, round, pick_position, value, captured_at")
        .eq("format_config_id", format.id)
        .eq("source", FFBEACON_SOURCE_SLUG)
        .order("captured_at", { ascending: false }),
      // Beacon Steals, precomputed nightly. The live room reads the SAME rows
      // the draft guide renders, so a player's verdict cannot differ between
      // the two. Absent (a format with no ADP market, or before the first
      // nightly build) simply leaves the fields undefined and the room falls
      // back to its original rank-vs-ADP line.
      // Scoped to the NEWEST season on the board and ordered, both deliberately.
      // The primary key is (format_slug, season, player_id) and the build prunes
      // per season, so last season's rows survive; filtering on format alone
      // would let the Map below keep whichever season happened to arrive last.
      // The order also makes the BOARD_ROW_CAP truncation point deterministic
      // instead of arbitrary.
      supabase
        .from("draft_value_targets")
        .select("player_id, beacon_pick, steal_score, category, verdict, confidence, season")
        .eq("format_slug", format.slug)
        .order("season", { ascending: false })
        .order("steal_score", { ascending: false })
        .limit(BOARD_ROW_CAP),
    ]);

    const rankings = (rankingsResult.data ?? []) as unknown as RankingJoinRow[];

    const valueByPlayer = new Map<string, number>();
    for (const v of valuesResult.data ?? []) {
      if (!valueByPlayer.has(v.player_id)) valueByPlayer.set(v.player_id, v.value);
    }
    const trendByPlayer = new Map<
      string,
      { change_7d: number | null; change_7d_pct: number | null; trend_7d: string | null; show_trend_7d: boolean }
    >();
    for (const t of trendsResult.data ?? []) trendByPlayer.set(t.player_id, t);

    const stealByPlayer = new Map<
      string,
      {
        beacon_pick: number | null;
        steal_score: number | null;
        category: string;
        verdict: string;
        confidence: number | null;
      }
    >();
    // Rows arrive newest season first, so the first row per player is the
    // current one and a later season's row can never overwrite it.
    for (const s of stealsResult.data ?? []) {
      if (!stealByPlayer.has(s.player_id)) stealByPlayer.set(s.player_id, s);
    }

    const now = new Date();
    const rookieSeasonNum = Number(rookieSeason);

    const players: RankedPlayer[] = [];
    const posCounts: Record<string, number> = {};
    for (const r of rankings) {
      const pl = r.players;
      const position = toDraftPosition(pl.position);
      if (!position) continue; // drop IDP / non-draftable positions

      const trend = trendByPlayer.get(pl.id);
      const steal = stealByPlayer.get(pl.id);
      players.push({
        playerId: pl.id,
        sleeperId: readSleeperId(pl.external_ids),
        name: `${pl.first_name} ${pl.last_name}`.trim(),
        position,
        team: pl.team,
        overallRank: r.overall_rank,
        positionRank: r.position_rank,
        tier: r.tier ?? 1,
        value: valueByPlayer.get(pl.id) ?? 0,
        isRookie: deriveIsRookie(pl.years_experience, pl.draft_year, rookieSeasonNum),
        yearsExperience: pl.years_experience ?? undefined,
        age: ageFromBirthDate(pl.birth_date, now),
        ageDecimal: computeAgeDecimal(pl.birth_date, now) ?? undefined,
        beaconPick: steal?.beacon_pick ?? null,
        stealScore: steal?.steal_score ?? null,
        stealCategory: steal?.category ?? null,
        stealVerdict: steal?.verdict ?? null,
        stealConfidence: steal?.confidence ?? null,
        change7d: trend?.change_7d ?? null,
        change7dPct: trend?.change_7d_pct ?? null,
        trend7d: trend?.trend_7d ?? null,
        show7d: trend?.show_trend_7d ?? false,
      });
      posCounts[position] = (posCounts[position] ?? 0) + 1;
    }

    return {
      status: players.length > 0 ? "ok" : "no-rankings",
      players,
      formatSlug: format.slug,
      formatLabel: format.display_name,
      sourceSlug: FFBEACON_SOURCE_SLUG,
      sourceLabel,
      valueSourceSlug: FFBEACON_SOURCE_SLUG,
      sourceActive,
      season: String(seasonToUse),
      pickValues: shapePickValues(picksResult.data ?? []),
    };
  } catch (err) {
    console.error("[on-the-clock/board-loader] failed", err);
    return emptyResult("error", formatSlug, formatSlug, FFBEACON_SOURCE_DISPLAY, false);
  }
}
