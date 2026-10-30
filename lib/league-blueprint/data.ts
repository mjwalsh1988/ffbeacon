import "server-only";

/**
 * Team Blueprint loader (plan sections 6.1 and 8).
 *
 * THE WARM PATH IS THE FINGERPRINT AND NOTHING ELSE. A stored view whose
 * fingerprint matches and whose age is inside the TTL is returned after six
 * small reads (lib/league-blueprint/cache.ts) and one cache row: no derived
 * sync, no trade finder, no Sleeper call.
 *
 * THE REBUILD PATH, in order:
 *   1. claim one blueprint-build slot (after the caller validated the roster
 *      id and found the league; a refusal shows the stored view or the "Try
 *      again in a minute" state, and fails closed),
 *   2. coalesce on (league, roster, source) so two tabs share one build,
 *   3. run pulseLeagueDerived with Positional WAR and the Manager Ledger OFF
 *      (this page computes neither; it only reads what is cached),
 *   4. read every input, run the trade finder at most three times, grade the
 *      chosen deals in one batch, assemble the view (build.ts),
 *   5. fingerprint AFTER the derived sync so the stored row describes what it
 *      read, write the cache row and the day's age history row.
 * A rebuild that throws leaves the old row in place; the page renders it with
 * an "as of" line and says the latest rebuild failed.
 *
 * VIEWER INDEPENDENT (types.ts rule 3): no tendency, no declined keys, no
 * username enters a build. The format is the league's own (CLAUDE.md League
 * Pulse Format Resolution); the source is the reader's resolved one, which is
 * part of the cache key.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { pulseLeagueDerived, type LeagueCoreRow } from "@/lib/league-pulse";
import {
  resolveLeagueContext,
  type LeagueContext,
  type LeagueContextEmpty,
} from "@/lib/league-format-resolution";
import { buildLeagueFormatTags } from "@/lib/league-format-tags";
import { loadLeagueTeamCards, loadTrends } from "@/lib/league-view-data";
import { loadPowerPulseView } from "@/lib/league-power-pulse-data";
import { loadManagerLedgerView } from "@/lib/league-manager-ledger-data";
import { loadTradeFinderLeague } from "@/lib/trade-finder-data";
import { findTrades } from "@/lib/trade-finder/engine";
import { gradeSuggestions } from "@/lib/trade-finder-grade";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { idpEnabledFrom } from "@/lib/power-pulse/default-settings";
import { slotEligibility } from "@/lib/power-pulse/types";
import { alignedStartingSlots } from "@/lib/league-schedule/slots";
import { starterIdsFromRosterMetadata } from "@/lib/league-lineups/data";
import { loadLeaderboardsCached } from "@/lib/league-leaderboards/load";
import { loadSignalsFor } from "@/lib/market-signals/read";
import { loadMarketSignalSettings } from "@/lib/market-signals/settings";
import { coalesce } from "@/lib/request-coalesce";
import type { SleeperLeague } from "@/lib/sleeper";
import type { TradeGoal } from "@/lib/trade-finder/types";
import { writeAgeHistory } from "./age-history";
import { buildBlueprintView, type BlueprintInputs, type LedgerSlice, type PulseSlice } from "./build";
import {
  buildFingerprint,
  isFresh,
  loadFingerprintInput,
  readCachedBlueprint,
  type CachedBlueprint,
  staleOrFailed,
  writeCachedBlueprint,
} from "./cache";
import { claimBlueprintBuildSlot } from "./rate-limit";
import { loadLeagueBlueprintSettings, type LeagueBlueprintSettings } from "./settings";
import { buildStrategy } from "./strategy";
import type { BlueprintView, MarketSignalState } from "./types";

type Client = SupabaseClient<Database>;

export type BlueprintLoad =
  | { kind: "no-coverage"; context: LeagueContextEmpty }
  | { kind: "fresh"; view: BlueprintView; context: LeagueContext }
  | { kind: "rebuilt"; view: BlueprintView; context: LeagueContext }
  /** Shown with its "as of" line: the slot was refused or the rebuild threw. */
  | { kind: "stale"; view: BlueprintView; context: LeagueContext; reason: "rate-limited" | "failed" }
  | { kind: "rate-limited"; context: LeagueContext }
  | { kind: "failed"; context: LeagueContext; message: string };

export type LoadBlueprintArgs = {
  admin: Client;
  league: Pick<LeagueCoreRow, "id" | "sleeper_league_id" | "season" | "status" | "roster_positions" | "scoring_settings" | "metadata" | "total_rosters">;
  rosterId: number;
  /** The reader's resolved source slug (null falls through to the registry default). */
  sourceSlug: string | null;
  /** True when pulseLeagueCore just resynced the league. */
  resynced: boolean;
  now?: Date;
  /**
   * What the page already read before the body streamed: the resolved context
   * and the stored row. Passed in so a warm render resolves the context and
   * reads the row once, not twice.
   */
  prefetched?: { context: LeagueContext | LeagueContextEmpty; cached: CachedBlueprint | null };
};

export async function loadBlueprint(args: LoadBlueprintArgs): Promise<BlueprintLoad> {
  const { admin, league, rosterId } = args;
  const now = args.now ?? new Date();
  const context =
    args.prefetched?.context ??
    (await resolveLeagueContext(admin, league.metadata as unknown as SleeperLeague, args.sourceSlug));
  if (context.coverage === "none") return { kind: "no-coverage", context: context as LeagueContextEmpty };
  const ctx = context as LeagueContext;
  const settings = await loadLeagueBlueprintSettings(admin);
  const season = String(league.season ?? now.getUTCFullYear());
  const ttlMs = settings.cache.ttlHours * 3_600_000;
  const keyArgs = { leagueRowId: league.id, rosterId, season, source: ctx.sourceSlug };

  const [cached, fpInput] = await Promise.all([
    args.prefetched ? Promise.resolve(args.prefetched.cached) : readCachedBlueprint(admin, keyArgs),
    loadFingerprintInput(admin, {
      ...keyArgs,
      formatConfigId: ctx.formatConfigId,
      settingsVersion: settings.version,
    }),
  ]);
  if (cached && isFresh(cached, buildFingerprint(fpInput), ttlMs, now.getTime())) {
    return { kind: "fresh", view: cached.view, context: ctx };
  }

  if (!(await claimBlueprintBuildSlot())) {
    return cached
      ? { kind: "stale", view: cached.view, context: ctx, reason: "rate-limited" }
      : { kind: "rate-limited", context: ctx };
  }

  try {
    const view = await coalesce(`blueprint:${league.id}:${rosterId}:${ctx.sourceSlug}`, () =>
      rebuildBlueprint({ ...args, context: ctx, settings, season, now }),
    );
    return { kind: "rebuilt", view, context: ctx };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[league-blueprint] rebuild failed", league.id, rosterId, message);
    return staleOrFailed(cached, ctx, message);
  }
}

function asIds(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== "0");
}

async function rebuildBlueprint(
  args: LoadBlueprintArgs & {
    context: LeagueContext;
    settings: LeagueBlueprintSettings;
    season: string;
    now: Date;
  },
): Promise<BlueprintView> {
  const { admin, league, rosterId, context, settings, season, now } = args;
  const seasonNum = Number(season);

  // Refreshes rosters' power rankings and Power Pulse when their own TTLs say
  // so. Positional WAR and the Manager Ledger are never computed here.
  await pulseLeagueDerived(admin, league.id, {
    resynced: args.resynced,
    includePositionalWar: false,
    includeManagerLedger: false,
  });

  const isDynasty = context.derived.league_type === "dynasty";
  const [cards, pulseView, ledgerView, finder, rosterRow, pulseSettings, signalCheck, topRow] =
    await Promise.all([
      loadLeagueTeamCards(admin, league.id, context.formatConfigId, context.sourceSlug, season, league.status, isDynasty),
      loadPowerPulseView(admin, league.id, seasonNum, context.formatConfigId, context.sourceSlug),
      loadManagerLedgerView(admin, league.id, seasonNum),
      loadTradeFinderLeague(admin, {
        sleeperLeagueId: league.sleeper_league_id,
        sourceSlug: context.sourceSlug,
        identity: { rosterId },
      }),
      admin
        .from("rosters")
        .select("metadata, reserve_ids, taxi_ids")
        .eq("league_id", league.id)
        .eq("sleeper_roster_id", rosterId)
        .maybeSingle(),
      loadPowerPulseSettings(admin),
      loadSignalCheckSettings(admin).catch(() => null),
      admin
        .from("player_value_trends")
        .select("current_value")
        .eq("format_config_id", context.formatConfigId)
        .eq("source", context.sourceSlug)
        .order("current_value", { ascending: false })
        .limit(1),
    ]);
  if (!finder) throw new Error("The trade finder could not load this league.");
  const mine = cards.find((c) => c.sleeperRosterId === rosterId);
  if (!mine) throw new Error(`Roster ${rosterId} has no team card.`);
  const idpEnabled = idpEnabledFrom(pulseSettings);

  // Signals for every priced player in the league (buy targets live on other
  // rosters), and 30-day trends for the reader's own players.
  const leaguePlayerIds = finder.teams.flatMap((t) => t.players.map((p) => p.playerId));
  const myIds = mine.players.map((p) => p.id);
  const marketSettings = await loadMarketSignalSettings(admin);
  const [signalRows, trendRows] = await Promise.all([
    loadSignalsFor(admin, leaguePlayerIds, context.formatConfigId, context.sourceSlug, marketSettings.staleDays),
    loadTrends(admin, myIds, context.formatConfigId, context.sourceSlug, { window: "30d" }),
  ]);
  const signals = new Map<string, MarketSignalState>(
    [...signalRows].map(([id, row]) => [id, row.signal as MarketSignalState]),
  );
  const trends: BlueprintInputs["trends"] = new Map(
    Object.entries(trendRows).map(([id, t]) => [
      id,
      {
        value: t.current_value,
        change7d: t.change_7d,
        change7dPct: t.change_7d_pct,
        show7d: t.show_trend_7d,
        rankChange7d: t.rank_change_7d,
        change30d: t.change_30d,
        change30dPct: t.change_30d_pct,
        show30d: t.show_trend_30d,
        rankChange30d: t.rank_change_30d,
      },
    ]),
  );

  // The trade strategy board: the same strategy Trade Ideas opens on, run for
  // the viewed roster with no per-viewer inputs.
  const myStatus = pulseView?.teams.find((t) => t.sleeperRosterId === rosterId)?.status?.key ?? null;
  const strategyMode = finder.isDynasty && myStatus === "rebuilder" ? "value" : "contender";
  const quality =
    signalCheck && signalCheck.qualityEnabled ? signalCheck.quality : DEFAULT_TRADE_QUALITY_CONFIG;
  const pickByKey = new Map(finder.teams.flatMap((t) => t.picks.map((p) => [p.key, p] as const)));
  const strategy = await buildStrategy({
    run: (goal?: TradeGoal) =>
      findTrades({
        myRosterId: rosterId,
        teams: finder.teams,
        startingSlots: finder.startingSlots,
        isDynasty: finder.isDynasty,
        allowPicks: finder.allowPicks,
        strategy: strategyMode,
        goal,
        targetPlayerIds: [],
        offerPlayerIds: [],
        excludeKeys: [],
        quality: { config: quality, poolMax: finder.poolMax },
      }),
    grade: (suggestions) => gradeSuggestions(admin, finder.sleeperLeague, suggestions),
    myRosterId: rosterId,
    picks: pickByKey,
    maxRuns: settings.strategy.maxRuns,
    pivotGapPct: settings.strategy.pivotGapPct,
  });

  const spotlightWeek = await loadSpotlightWeek(league.id, rosterId).catch(() => null);

  const pulse: PulseSlice[] | null = pulseView
    ? pulseView.teams.map((t) => ({
        rosterId: t.sleeperRosterId,
        status: t.status,
        positionRanks: t.positionRanks,
        scoreDepthRank: t.scoreDepthRank,
        rankDivergence: t.rankDivergence,
        pulseRank: t.pulseRank,
      }))
    : null;
  const ledgerTeam = ledgerView?.teams.find((t) => t.sleeperRosterId === rosterId) ?? null;
  const ledger: LedgerSlice | null =
    ledgerTeam && ledgerTeam.efficiency !== null && ledgerTeam.pointsLeftPerWeek !== null
      ? {
          efficiency: ledgerTeam.efficiency,
          gradedWeeks: ledgerTeam.weeksGraded,
          pointsLeftPerWeek: ledgerTeam.pointsLeftPerWeek,
          efficiencyRank: ledgerTeam.efficiencyRank,
        }
      : null;

  const rosterPositions = Array.isArray(league.roster_positions)
    ? (league.roster_positions as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const aligned = alignedStartingSlots(rosterPositions, slotEligibility(idpEnabled)).map((s) => ({
    token: s.token,
    label: s.label,
    description: s.description,
  }));

  const generatedAt = now.toISOString();
  const view = buildBlueprintView({
    sleeperLeagueId: league.sleeper_league_id,
    season,
    rosterId,
    generatedAt,
    isDynasty,
    isSuperflex: context.derived.is_superflex,
    formatTags: buildLeagueFormatTags({
      rosterPositions,
      scoringSettings: league.scoring_settings,
      teamCount: league.total_rosters ?? cards.length,
    }),
    formatDisplay: context.formatDisplay,
    sourceSlug: context.sourceSlug,
    sourceDisplay: context.sourceDisplay,
    pickSourceDisplay: context.pickSource?.display ?? null,
    cards,
    finderTeams: finder.teams,
    startingSlots: finder.startingSlots,
    pulse,
    ledger,
    signals,
    trends,
    formatTopValue: Number(topRow.data?.[0]?.current_value ?? 0),
    alignedSlots: aligned,
    rawStarterSleeperIds: starterIdsFromRosterMetadata(rosterRow.data?.metadata),
    reserveSleeperIds: asIds(rosterRow.data?.reserve_ids),
    taxiSleeperIds: asIds(rosterRow.data?.taxi_ids),
    spotlightWeek,
    strategy,
    settings,
  });

  // Fingerprint after the derived sync, so the stored row names what it read.
  const fpInput = await loadFingerprintInput(admin, {
    leagueRowId: league.id,
    rosterId,
    season,
    formatConfigId: context.formatConfigId,
    source: context.sourceSlug,
    settingsVersion: settings.version,
  });
  await writeCachedBlueprint(admin, {
    leagueRowId: league.id,
    rosterId,
    season,
    formatConfigId: context.formatConfigId,
    source: context.sourceSlug,
    view,
    fingerprint: buildFingerprint(fpInput),
  });
  await writeAgeHistory(admin, { leagueRowId: league.id, rosterId, season, age: view.age, at: now }).catch(
    (err) => console.error("[league-blueprint] age history write failed", err),
  );
  return view;
}

/**
 * The latest settled week's top scorer on this roster, with his season
 * per-game average in this league, both from the Leaderboards views (cached
 * ten minutes per league and week, shared with the Leaderboards page). Null
 * before any week settles.
 */
async function loadSpotlightWeek(
  leagueRowId: string,
  rosterId: number,
): Promise<BlueprintInputs["spotlightWeek"]> {
  const week = await loadLeaderboardsCached(leagueRowId, "latest");
  if (!week || week.week === null) return null;
  let best: { sleeperId: string; points: number } | null = null;
  for (const leader of week.boards.all) {
    const held = leader.ownership.find((o) => o.week === week.week && o.rosterId === rosterId);
    if (!held) continue;
    if (!best || leader.points > best.points) best = { sleeperId: leader.player.sleeperId, points: leader.points };
  }
  if (!best) return null;
  const seasonView = await loadLeaderboardsCached(leagueRowId, null);
  // The season boards are truncated to their leaders, so look in the
  // player's own position board as well as the overall one.
  const boards = seasonView ? [seasonView.boards.all, ...Object.values(seasonView.boards)] : [];
  const seasonRow =
    boards.flatMap((b) => b ?? []).find((l) => l.player.sleeperId === best!.sleeperId) ?? null;
  return {
    sleeperId: best.sleeperId,
    week: week.week,
    points: Math.round(best.points * 10) / 10,
    average: seasonRow?.perGame != null ? Math.round(seasonRow.perGame * 10) / 10 : null,
  };
}
