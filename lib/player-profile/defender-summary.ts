/**
 * The defender profile's factual summary (plan IDP-204).
 *
 * The same contract as lib/player-profile/summary.ts: a template over facts,
 * every clause optional, nothing printed for a missing fact, and null when
 * there are no facts at all. What differs is which facts a defender has. He
 * has no rank in any value source and no trade value, so neither is mentioned,
 * even to say it is missing; the market card says that once, in its own
 * place. Every point figure names its scoring.
 *
 * Positions are spelled out ("linebackers"), because a screen reader reads
 * "LB21" as letters. The finish codes stay in the sentence for the eye and
 * are followed by the words that give them meaning.
 */

import { dec1 } from "@/lib/beam/answers/format";
import { positionNoun } from "@/lib/site";

export type DefenderSummaryFacts = {
  playerName: string;
  playerSurname: string;
  position: string;
  /** "Sleeper default IDP scoring" or the preset the finishes were ranked on. */
  scoringLabel: string;
  /** Newest first, already sliced to the last three seasons. */
  lastThreeFinishes: { season: number; finish: number }[];
  /** Share of team defensive snaps last full season, 0 to 1. */
  snapShare: { season: number; pct: number } | null;
  nextWeek: { week: number; points: number } | null;
  projectionEngineDisplay: string | null;
};

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function buildDefenderSummary(facts: DefenderSummaryFacts): string | null {
  const plural = positionNoun(facts.position, "plural");
  const code = facts.position.toUpperCase();

  const firstClauses: string[] = [];
  if (facts.lastThreeFinishes.length > 0) {
    const finishes = joinWithAnd(facts.lastThreeFinishes.map((f) => `${code}${f.finish}`));
    firstClauses.push(
      `finished ${finishes} among ${plural} in ${facts.scoringLabel} in ${
        facts.lastThreeFinishes.length === 1 ? "the last ranked season" : `the last ${facts.lastThreeFinishes.length} ranked seasons`
      }`,
    );
  }
  if (facts.snapShare) {
    firstClauses.push(
      `was on the field for ${Math.round(facts.snapShare.pct * 100)}% of team defensive snaps in ${facts.snapShare.season}`,
    );
  }

  const first = firstClauses.length > 0 ? `${facts.playerName} ${firstClauses.join(", and ")}.` : null;

  const second =
    facts.nextWeek && facts.projectionEngineDisplay
      ? `${first ? facts.playerSurname : facts.playerName} is projected for ${dec1(
          facts.nextWeek.points,
        )} points in Week ${facts.nextWeek.week} in ${facts.scoringLabel}, from ${
          facts.projectionEngineDisplay
        }'s projected stat line.`
      : null;

  const sentences = [first, second].filter((s): s is string => s !== null);
  return sentences.length > 0 ? sentences.join(" ") : null;
}
