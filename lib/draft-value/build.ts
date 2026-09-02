/**
 * Build the Beacon Steals board (draft_value_targets).
 *
 * This is the I/O half. Every judgement lives in engine.ts, which is pure and
 * unit tested; this file only loads, joins, and writes.
 *
 * WHAT IT LOADS, PER FORMAT
 *   rankings + player_value_history   our value opinion, source ffbeacon
 *   player_weekly_projections         rescored under the FORMAT'S OWN canonical
 *                                     scoring via lib/projections/read.ts, so TE
 *                                     premium is exact rather than an invented
 *                                     multiplier
 *   player_projection_accuracy        beat rate, reliability, availability
 *   player_market_snapshots           the public ADP, via the SAME key mapping
 *                                     the live draft room uses
 *   draft_market_adp                  our own rooms, as a confidence input
 *
 * THE PROJECTION IS RESCORED, NOT READ OFF A COLUMN. The public ADP snapshot
 * table stores a market source's own point totals per scoring base, but no
 * column for TE premium, and a TEP board scored on that alone would price
 * tight ends as though the premium did not exist. Sleeper publishes weekly
 * projections as a stat map whose keys match a scoring map's keys (it emits
 * `bonus_rec_te` as the tight end's projected reception count), so scoring each
 * week's stat line against the format's canonical scoring gives the right
 * answer for all thirteen formats with no special cases.
 *
 * THE PROJECTION IS THE RAW SEASON TOTAL, NOT THE ADJUSTED ONE.
 * lib/projections/read.ts loadAdjustedProjections also applies opponent
 * strength, reliability and availability, but engine.ts ALREADY applies its
 * own reliability and availability discount to `projectedPoints` (see
 * `adjustmentMultiplier`, driven by the beatRate/shrunkMultiplier/
 * availabilityRate this file loads separately from player_projection_accuracy
 * a few lines below). Feeding it a number that already carries those two
 * adjustments would discount the same thing twice and silently understate
 * every player's points above replacement. So this file reads
 * `rawPoints` off each AdjustedProjection, the value BEFORE any multiplier,
 * summed across the season: mathematically identical to the old
 * sum-then-score, because the dot product distributes over a sum either way.
 * `rawPoints` therefore also drops the OPPONENT-STRENGTH adjustment, not only
 * reliability and availability: it is the projected stat line scored as-is,
 * before the defense a player faces that week ever multiplies it. A player
 * with a soft or brutal remaining slate reads the same as one with an
 * average slate on this board. That is an accepted tradeoff of reading
 * rawPoints rather than points, not a separate oversight.
 * Bringing opponent strength and injury into the Beacon Steals board too would
 * mean teaching engine.ts to accept a pre-adjusted number and dropping its own
 * reliability/availability step, which is a change to the pure, unit-tested
 * judgement layer this file is not the one to make.
 *
 * Formats with no FF Beacon rankings, or no ADP market, are SKIPPED rather than
 * written empty. An empty board is a bug; a missing board is a fact.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { adpFormatKeyCandidates } from "@/lib/on-the-clock/adp";
import { FFBEACON_SOURCE_SLUG } from "@/lib/signal-check/format";
import { loadAdjustedProjections, type AdjustedProjectionSummary } from "@/lib/projections/read";
import { getNflState } from "@/lib/sleeper";
import { resolveCurrentWeek } from "@/lib/league-matchups";
import {
  canonicalScoringForFormat,
  STEAL_POSITIONS,
  type DraftValueSettings,
  type StealPosition,
} from "./default-settings";
import { loadDraftValueSettings } from "./settings";
import { scoreFormat, type FormatShape, type PlayerInput } from "./engine";
import { buildVerdict } from "./verdict";

/**
 * No league tells this build when its playoffs start, so it uses the same
 * default trade-finder-data.ts falls back to when a league cannot say either.
 */
const DEFAULT_PLAYOFF_WEEK_START = 15;

type Client = SupabaseClient<Database>;
type TargetInsert = Database["public"]["Tables"]["draft_value_targets"]["Insert"];

const PAGE = 1000;
const UPSERT_CHUNK = 500;

/** Coerce a raw players.position to one of the four Beacon Steals buckets. */
export function toStealPosition(position: string | null | undefined): StealPosition | null {
  const p = (position ?? "").toUpperCase();
  return (STEAL_POSITIONS as readonly string[]).includes(p) ? (p as StealPosition) : null;
}

/** The scoring base whose accuracy rows match a format's canonical scoring. */
export function accuracyScoringBase(scoringType: string): string {
  if (scoringType === "half_ppr") return "pts_half_ppr";
  if (scoringType === "standard") return "pts_std";
  return "pts_ppr";
}

export interface BuildResult {
  formatsBuilt: number;
  formatsSkipped: { slug: string; reason: string }[];
  rowsWritten: number;
  season: number;
  modelVersion: string;
  durationMs: number;
}

interface FormatRow {
  id: string;
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  te_premium_bonus: number;
  is_superflex: boolean;
}

/** Reliability, availability, and beat rate, keyed by (player, scoring base). */
async function loadAccuracy(
  supabase: Client,
  scoringBase: string,
): Promise<Map<string, { beatRate: number | null; shrunk: number | null; availability: number | null }>> {
  const out = new Map<
    string,
    { beatRate: number | null; shrunk: number | null; availability: number | null }
  >();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_projection_accuracy")
      .select("player_id, beat_rate, shrunk_multiplier, availability_rate")
      // The NULL-season row is the recency-blended one, which is what the Power
      // Pulse engine reads. Per-season rows would ignore the recency weighting.
      .is("season", null)
      .eq("scoring", scoringBase)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`projection accuracy read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      out.set(row.player_id, {
        beatRate: row.beat_rate,
        shrunk: row.shrunk_multiplier,
        availability: row.availability_rate,
      });
    }
    if (data.length < PAGE) break;
  }

  return out;
}

/**
 * The public ADP map for a format, plus which key and source it came from.
 *
 * Uses adpFormatKeyCandidates, the SAME ordered fall-through the live draft room
 * grades picks against, so a player's market number cannot differ between the
 * guide and On The Clock. Falls through to the first candidate key that actually
 * has data, and never crosses the superflex or dynasty lines.
 */
type MarketSnapshot = { source: string; rows: { player_id: string; adp: Record<string, unknown> }[] };

/**
 * The latest market snapshot per source, fetched ONCE for the whole run.
 *
 * This does not depend on the format: every format reads the same rows and only
 * differs in which key it picks out of the `adp` jsonb, which is in-memory work.
 * Calling it per format meant 675 rows and two round trips repeated eight times,
 * 5,400 rows fetched to learn 675 rows' worth of information. Hoisted here
 * alongside the stat lines and the accuracy cache, which were already hoisted.
 */
async function loadMarketSnapshots(supabase: Client, season: number): Promise<MarketSnapshot[]> {
  const out: MarketSnapshot[] = [];

  for (const source of ["sleeper", "dynastyprocess"] as const) {
    const { data: latest } = await supabase
      .from("player_market_snapshots")
      .select("snapshot_date")
      .eq("source", source)
      .order("snapshot_date", { ascending: false })
      .eq("season", season)
      .limit(1)
      .maybeSingle();
    if (!latest?.snapshot_date) continue;

    const rows: { player_id: string; adp: Record<string, unknown> }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("player_market_snapshots")
        .select("player_id, adp")
        .eq("source", source)
        .eq("season", season)
        .eq("snapshot_date", latest.snapshot_date)
        .not("player_id", "is", null)
        .range(from, from + PAGE - 1);
      if (error) break;
      if (!data || data.length === 0) break;
      for (const row of data) {
        if (row.player_id) {
          rows.push({ player_id: row.player_id, adp: (row.adp ?? {}) as Record<string, unknown> });
        }
      }
      if (data.length < PAGE) break;
    }

    if (rows.length > 0) out.push({ source, rows });
  }

  return out;
}

/**
 * Pick the ADP market a format should be graded against, out of already-fetched
 * snapshots. Pure apart from its inputs.
 *
 * Uses adpFormatKeyCandidates, the SAME ordered fall-through the live draft room
 * grades picks against, so a player's market number cannot differ between the
 * guide and On The Clock. Never crosses the superflex or dynasty lines.
 */
export function selectMarketAdp(
  snapshots: readonly MarketSnapshot[],
  formatSlug: string,
  pool: "everyone" | "rookies" = "everyone",
): { adp: Map<string, number>; key: string; source: string } | null {
  const candidates = adpFormatKeyCandidates(formatSlug, pool);

  for (const snapshot of snapshots) {
    for (const key of candidates) {
      const map = new Map<string, number>();
      for (const row of snapshot.rows) {
        const value = Number(row.adp[key]);
        if (Number.isFinite(value) && value > 0) map.set(row.player_id, value);
      }
      // A key only a handful of players carry is a partial write, not a market.
      // Scoring against it would give almost every player a null gap.
      if (map.size >= 50) return { adp: map, key, source: snapshot.source };
    }
  }

  return null;
}

/**
 * Our own room ADP for a format's startup cohort.
 *
 * Selects picks_sampled, NOT drafts_sampled, as the confidence gate. They are
 * different questions and the first version asked the wrong one:
 * `drafts_sampled` is how many drafts are in the COHORT, a property of the
 * cohort rather than of the player, so a player taken once in forty drafts
 * cleared the same gate as one taken forty times. Measured on production, 127
 * rows had the gate open on a single observed pick. `picks_sampled` is how many
 * times THIS player was actually taken, which is what the plan specifies and
 * what migration 0189 calls the honest denominator.
 */
async function loadRoomAdp(
  supabase: Client,
  formatSlug: string,
  season: number,
): Promise<Map<string, { adp: number; picks: number }>> {
  const out = new Map<string, { adp: number; picks: number }>();
  const { data, error } = await supabase
    .from("draft_market_adp")
    .select("player_id, adp, picks_sampled")
    .eq("format_slug", formatSlug)
    .eq("player_pool", "everyone")
    .eq("season", season);
  if (error || !data) return out;
  for (const row of data) {
    out.set(row.player_id, { adp: Number(row.adp), picks: row.picks_sampled });
  }
  return out;
}

/**
 * Rebuild the whole board. Returns a report rather than throwing on a
 * per-format problem, so one thin format cannot take the run down.
 */
export async function runBuildDraftValue(
  supabase: Client,
  options: { season?: number } = {},
): Promise<BuildResult> {
  const started = Date.now();
  const settings: DraftValueSettings = await loadDraftValueSettings(supabase);

  // The projection season. Weekly projections are the scarce input, so the
  // latest season they cover is the season the board describes.
  let season = options.season;
  if (!season) {
    const { data } = await supabase
      .from("player_weekly_projections")
      .select("season")
      .eq("season_type", "regular")
      .order("season", { ascending: false })
      .limit(1)
      .maybeSingle();
    season = data?.season ?? new Date().getFullYear();
  }

  const { data: formatRows, error: formatErr } = await supabase
    .from("format_configs")
    .select("id, slug, display_name, league_type, scoring_type, te_premium_bonus, is_superflex")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (formatErr) throw new Error(`format_configs read failed: ${formatErr.message}`);

  const include = settings.formats.include;
  const exclude = new Set(settings.formats.exclude);
  const formats = (formatRows ?? []).filter(
    (f) => (include.length === 0 || include.includes(f.slug)) && !exclude.has(f.slug),
  ) as FormatRow[];

  // Depends on the SEASON only, never on the format, so it is loaded once for
  // the whole run rather than once per format.
  const marketSnapshots = await loadMarketSnapshots(supabase, season);

  // No league tells this build what week it is either. Resolved once for the
  // whole run: it only feeds the injury multiplier's week-to-week discount
  // inside loadAdjustedProjections, and that discount is moot anyway (see the
  // header note on why this file reads rawPoints rather than the adjusted
  // figure), so a single best-effort value for the whole run is enough.
  const nflState = await getNflState();
  const currentWeek = resolveCurrentWeek(nflState, season, DEFAULT_PLAYOFF_WEEK_START);

  const skipped: BuildResult["formatsSkipped"] = [];
  const builtSlugs: string[] = [];
  let rowsWritten = 0;
  const runAt = new Date().toISOString();

  // Accuracy depends only on the scoring base, so it is loaded once per base
  // rather than once per format.
  const accuracyByBase = new Map<string, Awaited<ReturnType<typeof loadAccuracy>>>();

  interface FormatContext {
    format: FormatRow;
    market: { adp: Map<string, number>; key: string; source: string };
    accuracy: Awaited<ReturnType<typeof loadAccuracy>>;
    roomAdp: Map<string, { adp: number; picks: number }>;
    rankings: {
      player_id: string;
      overall_rank: number;
      position_rank: number;
      position: string;
    }[];
    valueByPlayer: Map<string, number>;
    scoring: ReturnType<typeof canonicalScoringForFormat>;
    stealRankings: FormatContext["rankings"];
    /**
     * Groups formats that will read the identical projection: the projected
     * point total only varies with the scoring type and the TE premium bonus
     * (canonicalScoringForFormat's only two inputs), never with league type,
     * superflex, or roster shape. Two formats sharing this key share one
     * loadAdjustedProjections call below instead of running it twice.
     */
    configKey: string;
  }

  // Pass 1: everything a format needs EXCEPT its projections, which is the
  // one query bundle that does not actually vary per format (see configKey
  // above). Failures here are per-format, same skip reasons as before.
  const contexts: FormatContext[] = [];

  for (const format of formats) {
    try {
      const market = selectMarketAdp(marketSnapshots, format.slug);
      if (!market) {
        skipped.push({ slug: format.slug, reason: "no ADP market with enough coverage" });
        continue;
      }

      const base = accuracyScoringBase(format.scoring_type);
      let accuracy = accuracyByBase.get(base);
      if (!accuracy) {
        accuracy = await loadAccuracy(supabase, base);
        accuracyByBase.set(base, accuracy);
      }

      const roomAdp = await loadRoomAdp(supabase, format.slug, season);

      // Our value board for this format: the latest published ranking season.
      const { data: latestRanking } = await supabase
        .from("rankings")
        .select("season")
        .eq("format_config_id", format.id)
        .eq("source", FFBEACON_SOURCE_SLUG)
        .is("week", null)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latestRanking?.season) {
        skipped.push({ slug: format.slug, reason: "no FF Beacon rankings" });
        continue;
      }

      const rankings: FormatContext["rankings"] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("rankings")
          .select("player_id, overall_rank, position_rank, players!inner(position)")
          .eq("format_config_id", format.id)
          .eq("source", FFBEACON_SOURCE_SLUG)
          .eq("season", latestRanking.season)
          .is("week", null)
          .order("overall_rank", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`rankings read failed: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const row of data) {
          const joined = row as unknown as {
            player_id: string;
            overall_rank: number;
            position_rank: number;
            players: { position: string };
          };
          rankings.push({
            player_id: joined.player_id,
            overall_rank: joined.overall_rank,
            position_rank: joined.position_rank,
            position: joined.players.position,
          });
        }
        if (data.length < PAGE) break;
      }
      if (rankings.length === 0) {
        skipped.push({ slug: format.slug, reason: "no FF Beacon rankings" });
        continue;
      }

      // Latest value per player, from the PRE-CALC table rather than from raw
      // history.
      //
      // The first version paged the whole (format, ffbeacon) history ordered by
      // captured_at desc and kept first-wins per player. Measured on production
      // that was 60,652 rows and 61 round trips per format to recover 805
      // values: 558ms of database time and 6.5MB of JSON for 60KB of answer,
      // 32MB across the eight built formats. Worse, the cost GREW: history gains
      // about 779 rows per format per day and is never pruned, so the paged read
      // grows linearly in round trips and quadratically in database time. It was
      // on track to blow the 300 second cron ceiling inside a year.
      //
      // player_value_trends holds exactly one row per (player, format, source)
      // forever, is rebuilt by the 10:00 cron five hours before this job, and is
      // what CLAUDE.md's Pre-Calculated Tables rule says to read. Same answer,
      // 7ms instead of 558ms, one round trip instead of 61, and flat as the
      // database ages.
      //
      // This THROWS rather than breaking out of a loop. The old `if (error)
      // break` swallowed a failure and produced a board where every beaconValue
      // was null, at which point the value ladder silently fell back to ranking
      // by -beaconRank and nobody could tell from the output.
      const valueByPlayer = new Map<string, number>();
      const { data: trendRows, error: trendErr } = await supabase
        .from("player_value_trends")
        .select("player_id, current_value")
        .eq("format_config_id", format.id)
        .eq("source", FFBEACON_SOURCE_SLUG);
      if (trendErr) throw new Error(`value trends read failed: ${trendErr.message}`);
      for (const row of trendRows ?? []) {
        if (row.current_value !== null) {
          valueByPlayer.set(row.player_id, Number(row.current_value));
        }
      }

      const scoring = canonicalScoringForFormat({
        scoringType: format.scoring_type,
        tePremiumBonus: Number(format.te_premium_bonus),
      });

      // Steal-eligible rows only (K, DEF, and IDP are out of scope), so the
      // batch below never fetches a projection nobody is going to use.
      const stealRankings = rankings.filter((row) => toStealPosition(row.position) !== null);

      contexts.push({
        format,
        market,
        accuracy,
        roomAdp,
        rankings,
        valueByPlayer,
        scoring,
        stealRankings,
        configKey: `${base}|${Number(format.te_premium_bonus) || 0}`,
      });
    } catch (err) {
      // One thin or broken format must not take the whole board down.
      skipped.push({
        slug: format.slug,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Pass 2: one loadAdjustedProjections call per distinct configKey, instead
  // of one per format. The rows and their rescoring depend only on the
  // scoring type and the TE premium bonus, so this is the same dedupe
  // accuracyByBase already does for accuracy, applied to the far more
  // expensive projection bundle (a settings read, two source-availability
  // probes, a chunked projection count-then-select, an internal accuracy
  // load, and a defense-splits load). Formats are grouped by their shared
  // player universe so the union is loaded once and every format in the
  // group reads out of the same Map.
  const groups = new Map<string, FormatContext[]>();
  for (const ctx of contexts) {
    const list = groups.get(ctx.configKey) ?? [];
    list.push(ctx);
    groups.set(ctx.configKey, list);
  }

  const projectionsByConfig = new Map<string, Map<string, AdjustedProjectionSummary>>();

  for (const [configKey, group] of groups) {
    const playerIds = new Set<string>();
    const positionByPlayer = new Map<string, string>();
    for (const ctx of group) {
      for (const row of ctx.stealRankings) {
        playerIds.add(row.player_id);
        positionByPlayer.set(row.player_id, row.position);
      }
    }

    try {
      // See the header note: rawPoints, not the adjusted `points`, because
      // engine.ts already applies its own reliability/availability discount
      // from the beatRate/shrunkMultiplier/availabilityRate loaded above, and
      // the two must not stack. scoringSettings is identical for every format
      // in this group by construction of configKey.
      const { byPlayer } = await loadAdjustedProjections({
        supabase,
        playerIds: [...playerIds],
        season,
        fromWeek: 1,
        scoringSettings: group[0].scoring,
        positionByPlayer,
        currentWeek,
      });
      projectionsByConfig.set(configKey, byPlayer);
    } catch (err) {
      // A broken projection load only takes down the formats that share this
      // configKey, not the whole board.
      const reason = err instanceof Error ? err.message : String(err);
      for (const ctx of group) skipped.push({ slug: ctx.format.slug, reason });
    }
  }

  // Pass 3: score and write, per format.
  for (const ctx of contexts) {
    const projections = projectionsByConfig.get(ctx.configKey);
    if (!projections) continue; // pass 2 already recorded why

    try {
      const { format, market, accuracy, roomAdp, rankings, valueByPlayer } = ctx;

      const inputs: PlayerInput[] = [];
      for (const row of rankings) {
        const position = toStealPosition(row.position);
        if (!position) continue; // K, DEF, and IDP are out of scope

        const summary = projections.get(row.player_id);
        let projected: number | null = null;
        if (summary && summary.weeks > 0) {
          let total = 0;
          for (const week of summary.byWeek.values()) total += week.rawPoints;
          projected = total;
        }
        const acc = accuracy.get(row.player_id);
        const room = roomAdp.get(row.player_id);

        inputs.push({
          playerId: row.player_id,
          position,
          beaconRank: row.overall_rank,
          beaconValue: valueByPlayer.get(row.player_id) ?? null,
          positionRank: row.position_rank,
          projectedPoints: projected,
          beatRate: acc?.beatRate ?? null,
          shrunkMultiplier: acc?.shrunk ?? null,
          availabilityRate: acc?.availability ?? null,
          marketAdp: market.adp.get(row.player_id) ?? null,
          marketAdpKey: market.key,
          marketSource: market.source,
          roomAdp: room?.adp ?? null,
          roomPicksSampled: room?.picks ?? null,
        });
      }

      const shape: FormatShape = {
        slug: format.slug,
        leagueType: format.league_type === "dynasty" ? "dynasty" : "redraft",
        isSuperflex: format.is_superflex,
      };

      const scored = scoreFormat(inputs, shape, settings);

      const rows: TargetInsert[] = scored.map((s) => ({
        format_slug: format.slug,
        season,
        player_id: s.playerId,
        market_adp: s.marketAdp,
        market_adp_key: s.marketAdpKey,
        market_source: s.marketSource,
        room_adp: s.roomAdp,
        room_drafts_sampled: s.roomPicksSampled,
        beacon_rank: s.beaconRank,
        beacon_value: s.beaconValue,
        beacon_pick: s.beaconPick,
        position_rank: s.positionRank,
        position: s.position,
        projected_points: s.projectedPoints,
        points_above_replacement: s.pointsAboveReplacement,
        beat_rate: s.beatRate,
        availability: s.availability,
        value_gap: s.valueGap,
        position_adjusted_gap: s.positionAdjustedGap,
        steal_score: s.stealScore,
        confidence: s.confidence,
        category: s.category,
        verdict: buildVerdict(s, {
          formatLabel: format.display_name,
          teams: settings.leagueShape.teams,
          roomMinPicks: settings.confidence.roomMinDrafts,
          thinConfidence: settings.confidence.minConfidence,
        }),
        model_version: settings.modelVersion,
        computed_at: runAt,
      }));

      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase
          .from("draft_value_targets")
          .upsert(chunk, { onConflict: "format_slug,season,player_id" });
        if (error) throw new Error(`draft_value_targets upsert failed: ${error.message}`);
      }

      builtSlugs.push(format.slug);
      rowsWritten += rows.length;
    } catch (err) {
      // One thin or broken format must not take the whole board down.
      skipped.push({
        slug: ctx.format.slug,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Drop anything this run did not rewrite: a player who left a format's board
  // would otherwise keep a stale verdict forever.
  //
  // Scoped to the formats we ACTUALLY BUILT, not just to the season. The first
  // version deleted every row older than this run across the whole season, so a
  // single transient failure on one format (a rankings read blip, a market
  // hiccup) silently erased that format's entire board until the next nightly
  // run, while the cron still reported success because other formats had built.
  if (builtSlugs.length > 0) {
    const { error: pruneErr } = await supabase
      .from("draft_value_targets")
      .delete()
      .eq("season", season)
      .in("format_slug", builtSlugs)
      .lt("computed_at", runAt);
    if (pruneErr) console.warn("[draft-value] stale prune failed", pruneErr.message);
  }

  return {
    formatsBuilt: builtSlugs.length,
    formatsSkipped: skipped,
    rowsWritten,
    season,
    modelVersion: settings.modelVersion,
    durationMs: Date.now() - started,
  };
}
