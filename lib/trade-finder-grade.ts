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
 * The whole shortlist is graded, because the reader can page through it and a
 * deal without a grade would look like a deal we were quiet about. It costs one
 * batch of value lookups rather than one per suggestion: see gradeSuggestions.
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
  const [grade] = await gradeSuggestions(admin, sleeperLeague, [suggestion]);
  return grade ?? null;
}

/**
 * Grade a whole shortlist for the cost of grading one.
 *
 * The reader can now page through the ranked field, so every deal in it needs a
 * grade rather than only the one that happened to come first. Doing that the
 * obvious way, a call to gradeSuggestion per suggestion, would be twelve rounds
 * of settings, ruleset, format, player, value and pick lookups, and the note at
 * the top of this file about one batch versus forty would be exactly right.
 *
 * So the lookups are shared instead. A league's suggestions are drawn from the
 * same rosters, so the union of their assets is barely larger than any single
 * deal's: one resolver built over that union answers every one of them. The
 * pipeline itself is pure, so the twelve runs after it touch no database at all.
 *
 * Returns an array aligned by index with `suggestions`, null wherever a grade
 * would be a guess. Never throws.
 */
export async function gradeSuggestions(
  admin: Client,
  sleeperLeague: SleeperLeague,
  suggestions: TradeSuggestion[],
): Promise<(SuggestionGrade | null)[]> {
  const empty = suggestions.map(() => null);
  if (suggestions.length === 0) return [];

  try {
    const settings = await loadSignalCheckSettings(admin);
    if (!settings.enabled) return empty;

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
    if (!format) return empty;

    const allowsPicks = format.allowsPicks;
    const sidesFor = suggestions.map((s) => ({
      a: toAssetInputs(s.incoming, allowsPicks),
      b: toAssetInputs(s.outgoing, allowsPicks),
    }));

    // One synthetic analysis holding every asset in the shortlist. It is never
    // run through the pipeline; it exists only so the resolver knows what to
    // fetch. Duplicates are harmless, buildValueResolver dedupes player ids and
    // loads pick values for the whole format in one query regardless.
    const union: AnalysisInput = {
      formatSlug: format.slug,
      sides: {
        a: sidesFor.flatMap((s) => [...s.a, ...s.b]),
        b: [],
      },
    };
    const built = await buildValueResolver(admin, format, union);
    const ruleset = await loadActiveRuleset(admin);

    return suggestions.map((suggestion, i) => {
      const sides = sidesFor[i];
      // Dropping picks in a redraft format can empty a side. A one-sided trade
      // is not a trade, and grading it would produce a confident verdict about
      // half a deal.
      if (sides.a.length === 0 || sides.b.length === 0) return null;

      try {
        const input: AnalysisInput = { formatSlug: format.slug, sides };
        const analysis = runPipeline({
          input,
          resolver: built.resolver,
          format,
          source: built.source,
          settings,
          rules: ruleset.rules,
          rulesetVersion: ruleset.version,
          formatAutoDetected: true,
          poolMax: built.poolMax,
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
        } satisfies SuggestionGrade;
      } catch (err) {
        // Caught per suggestion, not per batch: one deal carrying an asset with
        // no value row must not cost the other eleven their grades.
        if (!(err instanceof SignalCheckError)) {
          console.error("[trade-finder] signal check grade failed", err);
        }
        return null;
      }
    });
  } catch (err) {
    // A guardrail (picks in a redraft format, an asset with no value row) is an
    // expected outcome here, not a fault. Anything else is worth a line in the
    // log, but never worth failing the suggestions over.
    if (!(err instanceof SignalCheckError)) {
      console.error("[trade-finder] signal check batch grade failed", err);
    }
    return empty;
  }
}
