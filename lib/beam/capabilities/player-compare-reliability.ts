/**
 * "Who has the better projection beat rate over the last 3 years, James Cook or
 * Josh Jacobs?"
 *
 * The two-player form of player-reliability.ts, one read for both players.
 *
 * A higher beat rate wins, and the sentence says the number of games behind it,
 * because 76% of 36 games and 76% of 4 games are not the same claim. When the
 * two are within a couple of points of each other the answer says they are
 * level rather than crowning a winner on noise.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { loadReliability, type Reliability } from "@/lib/beam/projections/load";
import { formatStatValue } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech } from "@/lib/beam/answers/templates";
import { coverageSentence, listSeasons } from "./player-reliability";
import {
  parseWith,
  playerLink,
  playerRefSchema,
  seasonWindowSchema,
} from "./shared";

const schema = z.object({
  a: playerRefSchema,
  b: playerRefSchema,
  window: seasonWindowSchema,
});

type Params = z.infer<typeof schema>;
type Result = { a: Reliability | null; b: Reliability | null };

/** Below this the two are level, not ranked. Four points of beat rate. */
const LEVEL_THRESHOLD = 0.04;

export const playerCompareReliability: BeamCapability<Params, Result> = {
  id: "player.compare.reliability",
  label: "Compare projection beat rates",
  description: "Which of two players beats his weekly projection more often.",
  playerScope: "historical",
  declineMessage: "We have not graded both of those players against their projections.",
  matcher: {
    base: 0.55,
    required: ["player", "reliability"],
    optional: ["season"],
    heads: ["who is better", "who had more"],
    playerCount: 2,
  },
  examples: [
    "Who has the better projection beat rate over the last 3 years, James Cook or Josh Jacobs?",
    "Who beats his projection more often, Puka Nacua or Garrett Wilson?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    const seasons = params.window.kind === "seasons" ? params.window.seasons : null;
    const rows = await loadReliability(
      ctx.supabase,
      [params.a.id, params.b.id],
      ctx.scoringKey,
      seasons,
    );
    return { a: rows.get(params.a.id) ?? null, b: rows.get(params.b.id) ?? null };
  },

  present(result, params, ctx): BeamAnswer {
    const caveats: string[] = [];
    const a = result.a;
    const b = result.b;
    const aRate = a?.beatRate ?? null;
    const bRate = b?.beatRate ?? null;

    const covered = [...new Set([...(a?.seasons ?? []), ...(b?.seasons ?? [])])].sort(
      (x, y) => x - y,
    );
    const coverage = coverageSentence(params.window, covered);
    if (coverage) caveats.push(coverage);

    let headline: string;
    if (aRate === null && bRate === null) {
      headline = `We have not graded either ${params.a.name} or ${params.b.name} against their projections.`;
    } else if (aRate === null) {
      headline = `We only have one side of this. ${params.b.name} beat his projection ${formatStatValue((bRate as number) * 100, "percent")} of the time, and we hold nothing graded for ${params.a.name}.`;
    } else if (bRate === null) {
      headline = `We only have one side of this. ${params.a.name} beat his projection ${formatStatValue(aRate * 100, "percent")} of the time, and we hold nothing graded for ${params.b.name}.`;
    } else {
      const aText = formatStatValue(aRate * 100, "percent");
      const bText = formatStatValue(bRate * 100, "percent");
      const period = covered.length > 0 ? ` across ${listSeasons(covered)}` : "";
      if (Math.abs(aRate - bRate) < LEVEL_THRESHOLD) {
        headline = `They are level. ${params.a.name} beat his projection ${aText} of the time and ${params.b.name} ${bText}${period}.`;
      } else {
        const aLeads = aRate > bRate;
        const leader = aLeads ? params.a : params.b;
        const trailer = aLeads ? params.b : params.a;
        const leaderRate = aLeads ? aText : bText;
        const trailerRate = aLeads ? bText : aText;
        const leaderRow = (aLeads ? a : b) as Reliability;
        headline = `${leader.name} has been the more reliable one: he beat his projection ${leaderRate} of the time (${leaderRow.weeksBeat} of ${leaderRow.weeksPlayed} games) against ${trailerRate} for ${trailer.name}${period}.`;
      }
    }

    const facts = [
      { label: params.a.name, value: rateFact(a) },
      { label: params.b.name, value: rateFact(b) },
    ];
    if (a?.meanDiff != null && b?.meanDiff != null) {
      facts.push({
        label: "Against projection",
        value: `${params.a.name} ${signedPoints(a.meanDiff)}, ${params.b.name} ${signedPoints(b.meanDiff)}, per game`,
      });
    }

    if ((a && a.weeksPlayed < 8) || (b && b.weeksPlayed < 8)) {
      caveats.push(
        "One of these rates comes from fewer than eight graded games, which is a small sample to rank on.",
      );
    }

    const context = buildContext({
      formatDisplay: ctx.formatDisplay,
      note: "Weekly projections graded against weekly results.",
    });

    return {
      headline,
      speech: buildSpeech({ headline, facts, caveats, context, maxFacts: facts.length }),
      facts,
      context,
      links: [playerLink(params.a), playerLink(params.b)],
      caveats,
    };
  },
};

function rateFact(r: Reliability | null): string {
  if (!r || r.beatRate === null) return "Not graded";
  return `${formatStatValue(r.beatRate * 100, "percent")} (${r.weeksBeat} of ${r.weeksPlayed})`;
}

function signedPoints(value: number): string {
  const magnitude = formatStatValue(Math.abs(value), "decimal1");
  return value >= 0 ? `+${magnitude}` : `-${magnitude}`;
}
