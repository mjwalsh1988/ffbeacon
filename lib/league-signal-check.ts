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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SleeperLeague } from "@/lib/sleeper";
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
import { SignalCheckError } from "@/lib/signal-check/errors";
import type { AnalysisInput, AssetInput, SideKey } from "@/lib/signal-check/types";

type Client = SupabaseClient<Database>;

/** Per-asset headshot metadata, aligned by index to view.sides[side].assets. */
export interface LeagueTradeAssetMeta {
  kind: "player" | "pick";
  sleeperId: string | null;
  round: number | null;
}

export interface LeagueTradeSignalCheck {
  view: BuilderView;
  assetMeta: Record<SideKey, LeagueTradeAssetMeta[]>;
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
}

export interface LeagueTradeInput {
  sleeperTransactionId: string;
  adds: Record<string, number> | null;
  /** Normalized draft-pick array (as persisted by pulseLeague). */
  draftPicks: unknown[];
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
  const playerMap = await mapSleeperPlayers(admin, Array.from(allSleeperIds));

  // Build each trade's analysis input, collecting the union of all assets so a
  // single value resolver covers the whole page.
  type Prepared = {
    id: string;
    input: AnalysisInput;
    assetMeta: Record<SideKey, LeagueTradeAssetMeta[]>;
    teamLabels: Partial<Record<SideKey, string | null>>;
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

    for (const [sid, rid] of Object.entries(adds)) {
      const playerId = playerMap.get(sid)!;
      const side = rosterToSide(Number(rid));
      const asset: AssetInput = { kind: "player", playerId };
      sideAssets[side].push(asset);
      assetMeta[side].push({ kind: "player", sleeperId: sid, round: null });
      unionAssets.push(asset);
    }

    if (format.allowsPicks) {
      for (const p of picks) {
        const pick = p as { season?: unknown; round?: unknown; owner_id?: unknown };
        const season = Number(pick.season);
        const round = Number(pick.round);
        const owner = Number(pick.owner_id);
        if (!Number.isFinite(season) || !Number.isFinite(round) || !Number.isFinite(owner)) continue;
        if (owner !== rosterA && owner !== rosterB) continue;
        const side = rosterToSide(owner);
        const asset: AssetInput = { kind: "pick", season, round };
        sideAssets[side].push(asset);
        assetMeta[side].push({ kind: "pick", sleeperId: null, round });
        unionAssets.push(asset);
      }
    }

    // Nothing of value on either side (e.g. an all-FAAB deal): let the feed's
    // plain layout handle it rather than grade an empty trade.
    if (sideAssets.a.length === 0 && sideAssets.b.length === 0) continue;

    prepared.push({
      id: t.sleeperTransactionId,
      input: { formatSlug: format.slug, sides: sideAssets },
      assetMeta,
      teamLabels: {
        a: params.rosterLabels[rosterA] ?? null,
        b: params.rosterLabels[rosterB] ?? null,
      },
    });
  }

  if (prepared.length === 0) {
    return { enabled: true, formatDisplay: format.display, formatNotice, results: new Map() };
  }

  // One value resolver + ruleset for every trade on the page. The resolver's
  // player/pick lookups are pure, so it's safe to share across pipeline runs.
  const unionInput: AnalysisInput = {
    formatSlug: format.slug,
    sides: { a: unionAssets, b: [] },
  };
  const built = await buildValueResolver(admin, format, unionInput);
  const ruleset = await loadActiveRuleset(admin);

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
      });
      const view = toBuilderView(analysis, settings, p.teamLabels);
      results.set(p.id, { view, assetMeta: p.assetMeta });
    } catch (err) {
      // A single bad trade never breaks the feed; it falls back to the plain
      // layout. SignalCheckError is an expected guardrail (e.g. picks in a
      // redraft format), so it's swallowed quietly.
      if (!(err instanceof SignalCheckError)) {
        console.error("[league signal-check] trade grade failed", p.id, err);
      }
    }
  }

  return { enabled: true, formatDisplay: format.display, formatNotice, results };
}
