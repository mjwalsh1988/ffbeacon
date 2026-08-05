/**
 * A second opinion on the suggestion we are about to show.
 *
 * Trade Finder builds and balances packages on the values the league view is
 * already displaying: the reader's chosen source, in the league's own format.
 * Signal Check is a different opinion built on FF Beacon's own values, with the
 * published calibration and trade-shape rules on top. Running the suggestion
 * through it costs one graded trade and answers the question a reader will
 * reasonably ask, which is whether the site's own grader agrees.
 *
 * Two rules follow from that being a SECOND opinion:
 *
 *   It never decides anything. The suggestion, its ranking, and its acceptance
 *   band are settled before this runs. A grade that disagrees is shown next to
 *   the deal rather than suppressing it, because two honest value sets
 *   disagreeing is information, and hiding it would be the tell that we do not
 *   trust our own numbers.
 *
 *   It never breaks the page. Signal Check can be switched off site-wide, its
 *   config lives behind service-role reads, and a redraft league legitimately
 *   has no pick values. Every one of those returns null and the card renders
 *   without a grade.
 *
 * Only the ONE suggestion on screen is graded, not the whole ranked field. That
 * is the difference between one batch of value lookups and forty.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SleeperLeague } from "@/lib/sleeper";
import {
  deriveLeagueFormat,
  mapToFormatSlug,
  pickClosestSupportedFormat,
} from "@/lib/sleeper-to-format";
import { resolveFormat, supportedFormatCandidates } from "@/lib/signal-check/format";
import { buildValueResolver } from "@/lib/signal-check/values";
import {
  loadActiveRuleset,
  loadSignalCheckSettings,
} from "@/lib/signal-check/settings";
import { runPipeline } from "@/lib/signal-check/pipeline";
import { toBuilderView } from "@/lib/signal-check/builder-view";
import { SignalCheckError } from "@/lib/signal-check/errors";
import type { AnalysisInput, AssetInput } from "@/lib/signal-check/types";
import type { SuggestionAsset, TradeSuggestion } from "@/lib/trade-finder/types";

type Client = SupabaseClient<Database>;

export type SuggestionGrade = {
  /** "Even trade", "Slight edge to ...", whatever the ruleset renders. */
  verdictLabel: string;
  /** Which side the grader favours, from the reader's point of view. */
  favours: "you" | "them" | "neither";
  confidenceLabel: string | null;
  tradeShapeLabel: string | null;
  explanation: string;
  formatDisplay: string;
};

/** Suggestion assets in the shape the Signal Check pipeline consumes. */
function toAssetInputs(assets: SuggestionAsset[], allowPicks: boolean): AssetInput[] {
  const out: AssetInput[] = [];
  for (const asset of assets) {
    if (asset.kind === "player") {
      out.push({ kind: "player", playerId: asset.playerId });
    } else if (allowPicks) {
      out.push({ kind: "pick", season: asset.season, round: asset.round });
    }
  }
  return out;
}

/**
 * Grade one suggestion. Returns null whenever a grade would be a guess.
 *
 * Side "a" is always the reader, and a side's assets are what that side
 * RECEIVES, matching how lib/league-signal-check.ts maps a Sleeper trade (it
 * keys off `adds`, which names the receiving roster). So side a holds the
 * incoming package, and a verdict for side a is a verdict for the reader.
 *
 * MUST be handed the admin client: every Signal Check config read
 * (beacon_settings, signal_check_rulesets, signal_check_rules) is service-role
 * only, matching lib/league-signal-check.ts.
 */
export async function gradeSuggestion(
  admin: Client,
  sleeperLeague: SleeperLeague,
  suggestion: TradeSuggestion,
): Promise<SuggestionGrade | null> {
  try {
    const settings = await loadSignalCheckSettings(admin);
    if (!settings.enabled) return null;

    // Same format resolution the transactions feed uses: the league's exact
    // derived format when FF Beacon publishes values for it, otherwise the
    // closest supported one, never crossing redraft and dynasty.
    const derived = deriveLeagueFormat(sleeperLeague);
    const exactSlug = mapToFormatSlug(derived);
    let format = exactSlug ? await resolveFormat(admin, exactSlug) : null;
    if (!format) {
      const candidates = await supportedFormatCandidates(admin, settings);
      const closest = pickClosestSupportedFormat(derived, candidates);
      format = closest ? await resolveFormat(admin, closest.slug) : null;
    }
    if (!format) return null;

    const sides = {
      a: toAssetInputs(suggestion.incoming, format.allowsPicks),
      b: toAssetInputs(suggestion.outgoing, format.allowsPicks),
    };
    // Dropping picks in a redraft format can empty a side. A one-sided trade is
    // not a trade, and grading it would produce a confident verdict about half a
    // deal.
    if (sides.a.length === 0 || sides.b.length === 0) return null;

    const input: AnalysisInput = { formatSlug: format.slug, sides };
    const built = await buildValueResolver(admin, format, input);
    const ruleset = await loadActiveRuleset(admin);

    const analysis = runPipeline({
      input,
      resolver: built.resolver,
      format,
      source: built.source,
      settings,
      rules: ruleset.rules,
      rulesetVersion: ruleset.version,
      formatAutoDetected: true,
    });
    const view = toBuilderView(analysis, settings, {
      a: "You",
      b: suggestion.counterparty.teamName,
    });

    return {
      verdictLabel: view.verdictLabel,
      favours: view.isNeutral ? "neither" : view.winnerSide === "a" ? "you" : "them",
      confidenceLabel: view.confidenceLabel,
      tradeShapeLabel: view.tradeShapeLabel,
      explanation: view.explanation,
      formatDisplay: view.formatDisplay,
    };
  } catch (err) {
    // A guardrail (picks in a redraft format, an asset with no value row) is an
    // expected outcome here, not a fault. Anything else is worth a line in the
    // log, but never worth failing the suggestion over.
    if (!(err instanceof SignalCheckError)) {
      console.error("[trade-finder] signal check grade failed", err);
    }
    return null;
  }
}
