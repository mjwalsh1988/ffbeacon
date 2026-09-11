/**
 * The player profile's factual summary (SEO-T972).
 *
 * A deterministic, server-rendered template over facts the overview tab
 * already has loaded: position rank, the 30-day value trend, the next
 * scheduled projection, and the last three positional finishes. It is a
 * template over facts, not generated prose: every clause is optional, a
 * missing fact drops its clause rather than printing a placeholder, and an
 * input carrying no facts at all renders nothing.
 *
 * Reuses the same phrasing helpers BEAM answers use (lib/beam/answers) so a
 * screen reader hears the same convention everywhere on the site: a position
 * is spelled out ("wide receiver"), never read as a two-letter code.
 *
 * Rank and trend are computed by the caller from the page's resolved format
 * and source (never a hardcoded default); the projection engine name is
 * likewise passed in already resolved through lib/projections/source-constants
 * projectionSourceDisplay, never hardcoded here.
 */

import { dec1, ordinal } from "@/lib/beam/answers/format";
import { positionNoun } from "@/lib/beam/answers/templates";

export type PlayerSummaryFinish = {
  season: number;
  /** Season-end rank within the position, e.g. 4 for "WR4". */
  finish: number;
};

export type PlayerSummaryFacts = {
  /** Full display name, used to open the first sentence that appears. */
  playerName: string;
  /** Last name only, used to open a second sentence without a pronoun. */
  playerSurname: string;
  position: string;
  /** The resolved format's display name (e.g. "Dynasty Superflex PPR"). */
  formatDisplay: string;
  /** Position rank from the resolved format/source's rankings row. */
  positionRank: number | null;
  /** 30-day value trend; pass null when the caller's own display gate
   *  (show_trend_30d) is not met, same as the trend chip elsewhere on the page. */
  trendDirection: "up" | "down" | "stable" | null;
  trendPct: number | null;
  /** The soonest unplayed week's projection, active scoring. */
  nextProjectionWeek: number | null;
  nextProjectionPoints: number | null;
  /** The resolved projection engine's display name. Required whenever a
   *  projection is named, per project rule: never a hardcoded word. */
  projectionEngineDisplay: string | null;
  /** Newest-first season finishes, already sliced to the last three. */
  lastThreeFinishes: PlayerSummaryFinish[];
};

function formatFinish(position: string, finish: number): string {
  return `${position.toUpperCase()}${finish}`;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function rankTrendSentence(subject: string, facts: PlayerSummaryFacts): string | null {
  const rankClause =
    facts.positionRank !== null
      ? `is the ${ordinal(facts.positionRank)} ${positionNoun(facts.position)} in ${facts.formatDisplay}`
      : null;

  const trendClause = (() => {
    if (facts.trendDirection === null) return null;
    if (facts.trendDirection === "stable") {
      return "has held steady in value over the last 30 days";
    }
    if (facts.trendPct === null) return null;
    const verb = facts.trendDirection === "up" ? "has risen" : "has fallen";
    return `${verb} ${dec1(Math.abs(facts.trendPct))}% in value over the last 30 days`;
  })();

  const clauses = [rankClause, trendClause].filter((c): c is string => c !== null);
  if (clauses.length === 0) return null;
  return `${subject} ${clauses.join(" and ")}.`;
}

function projectionFinishSentence(subject: string, facts: PlayerSummaryFacts): string | null {
  const projectionClause =
    facts.nextProjectionPoints !== null &&
    facts.nextProjectionWeek !== null &&
    facts.projectionEngineDisplay
      ? `is projected for ${dec1(facts.nextProjectionPoints)} points in Week ${facts.nextProjectionWeek} by ${facts.projectionEngineDisplay}`
      : null;

  const finishesClause =
    facts.lastThreeFinishes.length > 0
      ? `finished ${joinWithAnd(
          facts.lastThreeFinishes.map((f) => formatFinish(facts.position, f.finish)),
        )} over the last three seasons`
      : null;

  const clauses = [projectionClause, finishesClause].filter((c): c is string => c !== null);
  if (clauses.length === 0) return null;
  return `${subject} ${clauses.join(", and ")}.`;
}

/**
 * Build the two-sentence summary, or null when every fact is missing. The
 * first sentence rendered opens with the full name; a second sentence, if
 * any, opens with the surname so the player is not renamed mid-paragraph and
 * no pronoun is ever needed.
 */
export function buildPlayerSummary(facts: PlayerSummaryFacts): string | null {
  const first = rankTrendSentence(facts.playerName, facts);
  const second = projectionFinishSentence(
    first ? facts.playerSurname : facts.playerName,
    facts,
  );
  const sentences = [first, second].filter((s): s is string => s !== null);
  if (sentences.length === 0) return null;
  return sentences.join(" ");
}
