/**
 * Batch Signal Check analysis for a league's trades.
 *
 * The League Pulse transactions feed grades every trade through the SAME Signal
 * Check pipeline a user gets when they type the trade into /tools/signal-check:
 * FF Beacon native values, the league's derived format (closest supported format
 * as a fallback), the published calibration + trade-shape ruleset, and the same
 * verdict / confidence / explanation output. This module resolves the format and
 * value data ONCE per page render and runs the pure pipeline per trade, so a
 * feed of N trades costs one batch of value queries plus N deterministic passes.
 *
 * All Signal Check config reads (beacon_settings, signal_check_rulesets/rules)
 * are service-role only, so callers MUST pass the admin client.
 *
 * STARTUP PICKS ARE NOT ROOKIE PICKS.
 * A traded pick used to become `{kind: "pick", season, round}` unconditionally,
 * which Signal Check prices from `draft_pick_values`. That table holds ROOKIE
 * pick values only, and only rounds 1 to 4, so a dynasty STARTUP pick was priced
 * as a rookie pick when it had a row at all and as nothing when it did not. Now
 * a startup pick is resolved through lib/league-startup-picks.ts into the player
 * who was actually taken at that seat (or, for a draft still running, the player
 * the ADP simulation expects there) and graded as a player. Rookie picks and
 * future-season picks are untouched.
 *
 * A STARTUP PICK WE CANNOT RESOLVE BLOCKS THE GRADE.
 * This module already refuses to grade a trade containing a player it could not
 * match, because half an answer stated confidently is worse than no answer. An
 * unresolvable startup pick gets the same treatment rather than quietly falling
 * back to the rookie price, which is the bug, or being dropped from the trade,
 * which would grade four of five assets and say nothing about it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { currentNflSeason, type SleeperLeague } from "@/lib/sleeper";
import {
  deriveLeagueFormat,
  mapToFormatSlug,
  describeDerivedFormat,
  pickClosestSupportedFormat,
} from "@/lib/sleeper-to-format";
import { resolveFormat, supportedFormatCandidates } from "@/lib/signal-check/format";
import { buildValueResolver } from "@/lib/signal-check/values";
import { loadSignalCheckSettings, loadActiveRuleset } from "@/lib/signal-check/settings";
import { runPipeline } from "@/lib/signal-check/pipeline";
import { toBuilderView, type BuilderView } from "@/lib/signal-check/builder-view";
import { buildPickPositionResolver } from "@/lib/league-pick-position";
import { SignalCheckError } from "@/lib/signal-check/errors";
import type {
  AnalysisInput,
  AssetInput,
  PickPosition,
  SideKey,
} from "@/lib/signal-check/types";
import {
  loadStartupPickIndex,
  collectStartupPickQueries,
  type StartupPickIndex,
} from "@/lib/league-startup-picks";
import { describeTiming, type StartupTradeTiming } from "@/lib/startup-draft";
import { loadRankedBoardCached } from "@/lib/on-the-clock/board-loader";

type Client = SupabaseClient<Database>;

/** Per-asset headshot metadata, aligned by index to view.sides[side].assets. */
export interface LeagueTradeAssetMeta {
  kind: "player" | "pick";
  sleeperId: string | null;
  round: number | null;
  /**
   * For a pick: the draft year, and where in the round it is expected to land.
   *
   * Both are already known here, and the only other place they exist is inside
   * the rendered label ("2027 1st (mid)"). A consumer that needs to write the
   * pick a different way, as the Discord poll does at 55 characters a side,
   * would otherwise have to parse that sentence back apart.
   */
  season?: number | null;
  pickPosition?: PickPosition | null;
  /**
   * The FF Beacon player id behind this asset, when there is one. Null for a
   * pick.
   *
   * Carried because a consumer that wants anything else about the player (value
   * trend, positional finish, age) would otherwise have to map the Sleeper id
   * back through `players.external_ids` in a second query, having already been
   * handed the id this function resolved. Would You Rather reads it for the
   * 30-day value movement on its reveal.
   */
  playerId?: string | null;
  /**
   * Set when this asset is a startup draft pick that was resolved into the
   * player at that seat. The card shows the seat alongside the player so a
   * reader can see both what moved and what it became.
   */
  startupPick?: {
    /** "1.04" style seat label. */
    label: string;
    season: number;
    /** True when the player came from the ADP simulation, not a real selection. */
    simulated: boolean;
  };
}

/** What a graded trade says about the startup draft its picks belong to. */
export interface LeagueTradeStartupInfo {
  /** The startup draft season these picks belong to. */
  season: number;
  /** Where the trade sits relative to that draft. A label, never a price input. */
  timing: StartupTradeTiming;
  timingLabel: string | null;
  /** Startup picks priced from the player actually taken at the seat. */
  resolvedCount: number;
  /** Startup picks priced from the ADP simulation, because the seat is still open. */
  simulatedCount: number;
}

export interface LeagueTradeSignalCheck {
  view: BuilderView;
  assetMeta: Record<SideKey, LeagueTradeAssetMeta[]>;
  /** Non-null when this trade moved at least one dynasty startup draft pick. */
  startup: LeagueTradeStartupInfo | null;
}

export interface LeagueTradesAnalysis {
  /** Whether Signal Check is enabled for the site (feature flag). */
  enabled: boolean;
  /** The format used to grade every trade (league-derived or closest fallback). */
  formatDisplay: string | null;
  /** Set when the league's exact format isn't published and a fallback was used. */
  formatNotice: string | null;
  /** Keyed by sleeper_transaction_id. Only trades Signal Check could grade appear. */
  results: Map<string, LeagueTradeSignalCheck>;
  /**
   * The startup index this call built, so the caller can hand it to the fallback
   * valuation instead of building a second one.
   *
   * `draft_selections` is service-role only (migration 0188), and this function
   * requires the admin client. The transactions page's fallback path holds a
   * user-scoped client, which would read zero selection rows and then tell the
   * reader every startup pick is "not loaded yet" when the real reason is that
   * this client may not read them. Passing this index across keeps one honest
   * answer and saves the second pair of queries.
   */
  startupIndex?: StartupPickIndex | null;
}

export interface LeagueTradeInput {
  sleeperTransactionId: string;
  adds: Record<string, number> | null;
  /** Normalized draft-pick array (as persisted by pulseLeague). */
  draftPicks: unknown[];
  /**
   * When Sleeper recorded the trade, ISO.
   *
   * It does NOT decide whether a pick is a startup pick: that is settled by
   * which draft the pick belongs to, and of the mis-priced trades this fix was
   * built from, one was agreed before the draft opened, one during it, and one
   * after it finished. It is used for two narrower things: the reader-facing
   * "agreed before the startup draft" label, and separating a startup pick from
   * a rookie pick in a season that ran BOTH drafts, where the round number alone
   * cannot (see StartupDraftRecord.siblingRookieRounds).
   */
  createdAtSleeper?: string | null;
}

const EMPTY: LeagueTradesAnalysis = {
  enabled: false,
  formatDisplay: null,
  formatNotice: null,
  results: new Map(),
};

/** Distinct receiving roster ids from a trade's adds + normalized picks. */
function tradeRosters(adds: Record<string, number> | null, picks: unknown[]): number[] {
  const set = new Set<number>();
  for (const rid of Object.values(adds ?? {})) set.add(Number(rid));
  for (const p of picks) {
    const owner = (p as { owner_id?: unknown }).owner_id;
    if (owner != null) set.add(Number(owner));
  }
  return Array.from(set)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/** Map traded Sleeper player ids to FF Beacon player ids in one batched pass. */
async function mapSleeperPlayers(
  admin: Client,
  sleeperIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const numeric = Array.from(new Set(sleeperIds.filter((id) => /^\d+$/.test(id))));
  for (let i = 0; i < numeric.length; i += 200) {
    const chunk = numeric.slice(i, i + 200);
    const ors = chunk.map((id) => `external_ids->>sleeper.eq.${id}`).join(",");
    const { data } = await admin.from("players").select("id, external_ids").or(ors);
    for (const row of data ?? []) {
      const ext = row.external_ids as Record<string, unknown> | null;
      const sid = ext?.sleeper;
      if (typeof sid === "string" || typeof sid === "number") map.set(String(sid), row.id);
    }
  }
  return map;
}

export async function analyzeLeagueTrades(
  admin: Client,
  params: {
    sleeperLeague: SleeperLeague;
    trades: LeagueTradeInput[];
    /** sleeper_roster_id -> team display label, for the side headings. */
    rosterLabels: Record<number, string>;
    /**
     * leagues.id. Used to slot traded picks from projected standings; without it
     * every pick falls back to the early/mid/late blend.
     */
    leagueRowId: string;
  },
): Promise<LeagueTradesAnalysis> {
  if (params.trades.length === 0) return EMPTY;

  const settings = await loadSignalCheckSettings(admin);
  if (!settings.enabled) return EMPTY;

  // Resolve the league's format exactly as the Signal Check import path does:
  // prefer the exact derived format; if FF Beacon has no values for it, fall
  // back to the closest supported format (never crossing redraft/dynasty).
  const derived = deriveLeagueFormat(params.sleeperLeague);
  const exactSlug = mapToFormatSlug(derived);
  let format = exactSlug ? await resolveFormat(admin, exactSlug) : null;
  let formatNotice: string | null = null;
  if (!format) {
    const candidates = await supportedFormatCandidates(admin, settings);
    const closest = pickClosestSupportedFormat(derived, candidates);
    format = closest ? await resolveFormat(admin, closest.slug) : null;
    if (format) {
      formatNotice = `This league looks like ${describeDerivedFormat(derived)}, which FF Beacon does not publish its own values for yet. Trades are graded with the closest supported format, ${format.display}, so a few values may be slightly off.`;
    }
  }
  if (!format) return { ...EMPTY, enabled: true };

  // Map every traded player once across the whole page.
  const allSleeperIds = new Set<string>();
  for (const t of params.trades) {
    for (const sid of Object.keys(t.adds ?? {})) allSleeperIds.add(sid);
  }
  // Three independent reads, one wave. They were sequential, which cost three
  // round trips on a page that already knows it is latency-sensitive, and the
  // cost multiplied by league count on the player-profile trades tab, which
  // calls this once per league. Nothing here depends on anything else here.
  const resolvedFormat = format;
  const [playerMap, pickPositions, startupIndex] = await Promise.all([
    // Every traded player, mapped once across the whole page.
    mapSleeperPlayers(admin, Array.from(allSleeperIds)),
    // Draft order + projected standings once for the whole page, so every pick
    // on it is placed against the same ranking.
    buildPickPositionResolver(admin, params.leagueRowId),
    // Startup-pick resolution, once for the whole page. Every pick descriptor on
    // the page goes in up front so the ranked board is fetched at most once, and
    // only when a live startup draft genuinely has an open seat being traded.
    // The derived slug is deliberately used rather than the possibly-fallen-back
    // `format.slug`: whether a league is dynasty is a fact about the league, not
    // about which format FF Beacon happens to publish values for.
    resolvedFormat.allowsPicks
      ? loadStartupPickIndex(admin, {
          leagueRowId: params.leagueRowId,
          formatSlug: exactSlug ?? resolvedFormat.slug,
          picks: params.trades.flatMap((t) =>
            collectStartupPickQueries(t.draftPicks, t.createdAtSleeper ?? null),
          ),
          loadBoard: async () => {
            // Memoized per request. The player-profile trades tab calls this
            // function once per league across up to 30 leagues concurrently,
            // and they nearly all resolve to the same dynasty format.
            const board = await loadRankedBoardCached(
              admin,
              resolvedFormat.slug,
              currentNflSeason(),
            );
            return board.players;
          },
        })
      : Promise.resolve(null),
  ]);

  // Build each trade's analysis input, collecting the union of all assets so a
  // single value resolver covers the whole page.
  type Prepared = {
    id: string;
    input: AnalysisInput;
    assetMeta: Record<SideKey, LeagueTradeAssetMeta[]>;
    teamLabels: Partial<Record<SideKey, string | null>>;
    startup: LeagueTradeStartupInfo | null;
    /**
     * assetMeta entries whose sleeper id is not known yet, because the asset is
     * a startup pick that became a player. Backfilled from the value resolver
     * after it is built, which costs no extra query.
     */
    pendingHeadshots: Array<{ side: SideKey; index: number; playerId: string }>;
  };
  const prepared: Prepared[] = [];
  const unionAssets: AssetInput[] = [];

  for (const t of params.trades) {
    const adds = t.adds ?? {};
    const picks = t.draftPicks;
    const rosters = tradeRosters(adds, picks);
    // Signal Check grades two-team trades; skip anything else (the feed falls
    // back to the plain trade layout for those).
    if (rosters.length !== 2) continue;
    const [rosterA, rosterB] = rosters;
    const rosterToSide = (rid: number): SideKey => (rid === rosterA ? "a" : "b");

    // Block on any unmatched player so we never produce a misleading verdict.
    if (Object.keys(adds).some((sid) => !playerMap.has(sid))) continue;

    const sideAssets: Record<SideKey, AssetInput[]> = { a: [], b: [] };
    const assetMeta: Record<SideKey, LeagueTradeAssetMeta[]> = { a: [], b: [] };
    const pendingHeadshots: Prepared["pendingHeadshots"] = [];
    const parsedTradedAt = t.createdAtSleeper ? Date.parse(t.createdAtSleeper) : NaN;
    const tradedAtMs = Number.isFinite(parsedTradedAt) ? parsedTradedAt : null;

    for (const [sid, rid] of Object.entries(adds)) {
      const playerId = playerMap.get(sid)!;
      const side = rosterToSide(Number(rid));
      const asset: AssetInput = { kind: "player", playerId };
      sideAssets[side].push(asset);
      assetMeta[side].push({ kind: "player", sleeperId: sid, round: null, playerId });
      unionAssets.push(asset);
    }

    // Startup bookkeeping for this trade. A single unresolvable startup pick
    // abandons the grade entirely, exactly as an unmatched player does.
    let startupSeason: number | null = null;
    let startupResolved = 0;
    let startupSimulated = 0;
    let startupBlocked = false;

    if (format.allowsPicks) {
      for (const p of picks) {
        const pick = p as {
          season?: unknown;
          round?: unknown;
          owner_id?: unknown;
          roster_id?: unknown;
          previous_owner_id?: unknown;
        };
        const season = Number(pick.season);
        const round = Number(pick.round);
        const owner = Number(pick.owner_id);
        if (!Number.isFinite(season) || !Number.isFinite(round) || !Number.isFinite(owner)) continue;
        if (owner !== rosterA && owner !== rosterB) continue;
        const side = rosterToSide(owner);
        // roster_id is the pick's ORIGINAL team, which is what sets its slot,
        // and is regularly neither side of this trade: a pick can change hands
        // more than once. owner_id only says who ends up holding it. Sleeper
        // sometimes gives only previous_owner_id, so that is the fallback.
        const origin = Number.isFinite(Number(pick.roster_id))
          ? Number(pick.roster_id)
          : Number.isFinite(Number(pick.previous_owner_id))
            ? Number(pick.previous_owner_id)
            : null;

        // Startup first. A null result means this is not a startup pick, which
        // leaves the rookie/future path below exactly as it was.
        const startup = startupIndex?.resolve({
          season,
          round,
          originalRosterId: origin,
          tradedAtMs,
        });

        if (startup) {
          startupSeason = season;
          if (startup.substitution.kind !== "player") {
            startupBlocked = true;
            break;
          }
          const { playerId, simulated } = startup.substitution;

          // A trade made AFTER the draft can move the drafted player AND the
          // spent pick record that produced him. Counting both would price one
          // player twice, on one side, and hand that side a phantom win. The
          // player himself is the real asset, so the pick is dropped.
          //
          // Scoped to THIS side. A pick that resolves to a player the OTHER side
          // received is a real asset for this side and must still be counted.
          const alreadyOnThisSide = sideAssets[side].some(
            (x) => x.kind === "player" && x.playerId === playerId,
          );
          if (alreadyOnThisSide) continue;

          const asset: AssetInput = { kind: "player", playerId };
          sideAssets[side].push(asset);
          const index = assetMeta[side].length;
          assetMeta[side].push({
            kind: "player",
            sleeperId: null,
            round,
            playerId,
            startupPick: {
              label: startup.label ?? `${season} R${round}`,
              season,
              simulated,
            },
          });
          pendingHeadshots.push({ side, index, playerId });
          unionAssets.push(asset);
          if (simulated) startupSimulated += 1;
          else startupResolved += 1;
          continue;
        }

        const placed = origin !== null ? pickPositions.resolve(origin, season) : null;
        const asset: AssetInput = placed
          ? {
              kind: "pick",
              season,
              round,
              pickPosition: placed.position,
              slotEstimated: placed.estimated,
            }
          : { kind: "pick", season, round };
        sideAssets[side].push(asset);
        assetMeta[side].push({
          kind: "pick",
          sleeperId: null,
          round,
          playerId: null,
          season,
          pickPosition: placed?.position ?? null,
        });
        unionAssets.push(asset);
      }
    }

    // A startup pick we could not turn into a player would otherwise be priced
    // off the rookie table, which is the bug this whole path exists to remove.
    if (startupBlocked) continue;

    // Nothing of value on either side (e.g. an all-FAAB deal): let the feed's
    // plain layout handle it rather than grade an empty trade.
    if (sideAssets.a.length === 0 && sideAssets.b.length === 0) continue;

    const startupTouched = startupResolved + startupSimulated > 0;
    const timing =
      startupTouched && startupSeason !== null && startupIndex
        ? startupIndex.timingFor(startupSeason, t.createdAtSleeper ?? null)
        : "unknown";

    prepared.push({
      id: t.sleeperTransactionId,
      input: { formatSlug: format.slug, sides: sideAssets },
      assetMeta,
      teamLabels: {
        a: params.rosterLabels[rosterA] ?? null,
        b: params.rosterLabels[rosterB] ?? null,
      },
      startup:
        startupTouched && startupSeason !== null
          ? {
              season: startupSeason,
              timing,
              timingLabel: describeTiming(timing),
              resolvedCount: startupResolved,
              simulatedCount: startupSimulated,
            }
          : null,
      pendingHeadshots,
    });
  }

  if (prepared.length === 0) {
    // The index still travels. This return fires when every trade was filtered
    // out, which INCLUDES the case where they were all dropped for holding an
    // unresolvable startup pick, and those are exactly the trades the fallback
    // valuation is about to price.
    return {
      enabled: true,
      formatDisplay: format.display,
      formatNotice,
      results: new Map(),
      startupIndex,
    };
  }

  // One value resolver + ruleset for every trade on the page. The resolver's
  // player/pick lookups are pure, so it's safe to share across pipeline runs.
  // Independent of each other, so one wave rather than two.
  const unionInput: AnalysisInput = {
    formatSlug: format.slug,
    sides: { a: unionAssets, b: [] },
  };
  const [built, ruleset] = await Promise.all([
    buildValueResolver(admin, format, unionInput),
    loadActiveRuleset(admin),
  ]);

  const results = new Map<string, LeagueTradeSignalCheck>();
  for (const p of prepared) {
    try {
      const analysis = runPipeline({
        input: p.input,
        resolver: built.resolver,
        format,
        source: built.source,
        settings,
        rules: ruleset.rules,
        rulesetVersion: ruleset.version,
        formatAutoDetected: true,
        poolMax: built.poolMax,
      });
      const view = toBuilderView(analysis, settings, p.teamLabels);

      // A startup pick became a player, so it deserves that player's headshot.
      // The resolver already holds every player's Sleeper id from the meta query
      // it ran above, so this costs nothing.
      for (const pending of p.pendingHeadshots) {
        const meta = p.assetMeta[pending.side][pending.index];
        if (meta) meta.sleeperId = built.resolver.player(pending.playerId)?.sleeperId ?? null;
      }

      results.set(p.id, { view, assetMeta: p.assetMeta, startup: p.startup });
    } catch (err) {
      // A single bad trade never breaks the feed; it falls back to the plain
      // layout. SignalCheckError is an expected guardrail (e.g. picks in a
      // redraft format), so it's swallowed quietly.
      if (!(err instanceof SignalCheckError)) {
        console.error("[league signal-check] trade grade failed", p.id, err);
      }
    }
  }

  return {
    enabled: true,
    formatDisplay: format.display,
    formatNotice,
    results,
    startupIndex,
  };
}
