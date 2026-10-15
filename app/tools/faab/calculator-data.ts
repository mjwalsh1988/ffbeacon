import "server-only";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  resolveSourceForFormat,
  getActiveFormats,
  getAvailableSources,
  describeSource,
  reconcileFormatWithSource,
  type ActiveFormatRow,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { loadFaabSettings } from "@/lib/faab/settings";
import type { FaabSettings } from "@/lib/faab/types";
import {
  resolveHandleGate,
  resolveSleeperViewer,
} from "@/lib/sleeper-handle/resolve";
import type { HandleGateState, SleeperViewer } from "@/lib/sleeper-handle/types";
import { loadFaabPlayerListCached } from "@/lib/faab/player-list";
import { loadManualDefendersCached } from "@/lib/faab/manual-defenders";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { idpEnabledFrom } from "@/lib/power-pulse/default-settings";
import { currentNflSeason } from "@/lib/nfl-season";
import { isDiscordMember } from "@/lib/discord-membership";
import type { MastheadChip } from "@/components/app-shell/page-masthead";
import type { FaabPlayer } from "./faab-form";
import { loadMarketFacts, type MarketFacts } from "./market-stats";

/**
 * Everything the FAAB calculator needs before it can render, resolved through
 * the reader's format and source chain. Shared by /tools/faab and
 * /tools/faab/guillotine so the two front doors price every claim from the
 * same data.
 */
export type FaabCalculatorData = {
  settings: FaabSettings;
  players: FaabPlayer[];
  format: ActiveFormatRow | null;
  formatSlug: string;
  requestedSourceSlug: string | null;
  reconciled: ReturnType<typeof reconcileFormatWithSource>;
  fallbackBanner: { requested: string | null; actual: string } | null;
  rankingsSourceName: string | null;
  valueSourceName: string | null;
  valueSourceIsBeacon: boolean;
  handleGate: HandleGateState;
  urlViewer: SleeperViewer | null;
  isMember: boolean;
  marketFacts: MarketFacts | null;
  mastheadChips: MastheadChip[];
};

export async function loadFaabCalculatorData(params: {
  format?: string;
  source?: string;
  username?: string | string[];
}): Promise<FaabCalculatorData> {
  const supabase = await createClient();
  // Settings are service-role-only (RLS); read them server-side with the admin
  // client, same as Signal Check. loadFaabSettings never throws and falls back
  // to safe code defaults, so the calculator renders even if the row is absent.
  // The three are independent, so resolve them in parallel.
  const [settings, formatResolution, sourceResolution] = await Promise.all([
    loadFaabSettings(createAdminClient()),
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
  ]);
  const requestedSourceSlug = sourceResolution.slug;

  // These are independent of each other, so they go together rather than in a
  // waterfall: the source registry and formats, who the league panel is
  // acting for, the reader's Discord membership, and the market cells behind
  // the "what leagues actually pay" section. The market read is cached daily
  // and shared with the FAQ, which quotes it.
  const [registry, allFormats, handleGate, urlViewer, isMember, marketFacts] =
    await Promise.all([
    getAvailableSources(supabase),
    getActiveFormats(supabase),
    resolveHandleGate(supabase, params.username),
    // The gate answers "guest" for a signed-out reader without ever consulting
    // the URL, so on its own a shared `?username=` link would do nothing for
    // the readers most likely to be following one. This is the same
    // fall-through League Pulse uses, and both reads are memoized per request.
    resolveSleeperViewer(supabase, params.username),
    isDiscordMember(),
    loadMarketFacts(settings.priors.minCellSamples),
  ]);

  // Keep the reader's source and move the FORMAT when that source does not
  // cover it, with a banner. A read-time correction only: nothing is written
  // to the cookie or the saved preference.
  const reconciled = reconcileFormatWithSource(
    registry,
    allFormats,
    requestedSourceSlug,
    formatResolution.slug,
  );
  const formatSlug = reconciled.formatSlug;
  const format = allFormats.find((f) => f.slug === formatSlug) ?? null;

  let players: FaabPlayer[] = [];
  let fallbackBanner: { requested: string | null; actual: string } | null = null;
  let rankingsSourceName: string | null = null;
  let valueSourceName: string | null = null;
  let valueSourceIsBeacon = false;
  if (format) {
    const rankingsResolution = resolveSourceForFormat(
      registry,
      "rankings",
      format.slug,
      requestedSourceSlug,
    );
    const valueHistoryResolution = resolveSourceForFormat(
      registry,
      "player_value_history",
      format.slug,
      requestedSourceSlug,
    );
    if (rankingsResolution.source) {
      rankingsSourceName = describeSource(registry, rankingsResolution.source);
    }
    if (valueHistoryResolution.source) {
      valueSourceName = describeSource(registry, valueHistoryResolution.source);
      valueSourceIsBeacon = valueHistoryResolution.source === "ffbeacon";
    }
    if (rankingsResolution.fellBack && rankingsResolution.source) {
      fallbackBanner = {
        requested: describeSource(registry, rankingsResolution.requested),
        actual: describeSource(registry, rankingsResolution.source),
      };
    }

    if (rankingsResolution.source) {
      // One cached read for the whole list. The result is identical for every
      // visitor on this (format, rankings source, value source) and the data
      // behind it changes at most nightly.
      players = await loadFaabPlayerListCached({
        formatConfigId: format.id,
        rankingsSource: rankingsResolution.source,
        valueSource: valueHistoryResolution.source ?? null,
      });
    }
  }

  // Defenders for the manual calculator, after every ranked player and marked
  // "not ranked": no value source ranks one. Only while the IDP switch is on,
  // like every other IDP surface; the switch is read from memoised settings,
  // so with it off this costs nothing.
  if (players.length > 0 && idpEnabledFrom(await loadPowerPulseSettings(createAdminClient()))) {
    try {
      const defenders = await loadManualDefendersCached(Number(currentNflSeason()));
      players = [...players, ...defenders.map((d) => ({ ...d, unranked: true }))];
    } catch (error) {
      // The offensive list still works; the defenders are an addition to it.
      console.error("[faab] manual defender list failed", error);
    }
  }

  // Masthead context, all of it resolved above: the format these bids are
  // priced in, the value source behind them, and the size of the player pool.
  const mastheadChips: MastheadChip[] = [];
  if (format?.display_name) {
    mastheadChips.push({ label: format.display_name, tone: "cyan" });
  }
  if (valueSourceName) {
    mastheadChips.push({ label: `Values via ${valueSourceName}`, tone: "purple" });
  }

  return {
    settings,
    players,
    format,
    formatSlug,
    requestedSourceSlug,
    reconciled,
    fallbackBanner,
    rankingsSourceName,
    valueSourceName,
    valueSourceIsBeacon,
    handleGate,
    urlViewer,
    isMember,
    marketFacts,
    mastheadChips,
  };
}
