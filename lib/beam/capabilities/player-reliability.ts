/**
 * "What is James Cook's projection beat rate over the last 3 years?"
 *
 * A beat rate is the share of weeks a player OUTSCORED the projection published
 * for him that week. It is the most useful number we hold about a player that
 * nobody publishes on a card, because it separates the two ways a player can
 * disappoint: being projected badly and being used badly.
 *
 * THE SEASONS ASKED FOR AND THE SEASONS WE HOLD ARE DIFFERENT SETS, and the
 * answer names the second. Asking for three years when we grade two is normal,
 * not an error, and quietly answering with two while the reader believes they
 * got three is the kind of wrongness that is impossible to notice.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { loadReliability, type Reliability } from "@/lib/beam/projections/load";
import { formatStatValue } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech } from "@/lib/beam/answers/templates";
import {
  parseWith,
  playerLink,
  playerRefSchema,
  seasonWindowSchema,
  windowLabel,
  type SeasonWindowParam,
} from "./shared";

const schema = z.object({
  player: playerRefSchema,
  window: seasonWindowSchema,
});

type Params = z.infer<typeof schema>;
type Result = { reliability: Reliability | null };

export const playerReliability: BeamCapability<Params, Result> = {
  id: "player.reliability",
  label: "Projection beat rate",
  description: "How often a player outscores the projection published for him.",
  playerScope: "historical",
  declineMessage: "We have not graded that player against his projections yet.",
  matcher: {
    base: 0.5,
    required: ["player", "reliability"],
    optional: ["season"],
    heads: ["what is", "how good is"],
    playerCount: 1,
  },
  examples: [
    "What is James Cook's projection beat rate?",
    "How reliable is Puka Nacua against his projections?",
    "What is Bijan Robinson's beat rate over the last 2 seasons?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    const seasons = params.window.kind === "seasons" ? params.window.seasons : null;
    const rows = await loadReliability(ctx.supabase, [params.player.id], ctx.scoringKey, seasons);
    return { reliability: rows.get(params.player.id) ?? null };
  },

  present(result, params, ctx): BeamAnswer {
    const player = params.player;
    const asked = windowLabel(params.window);
    const caveats: string[] = [];

    if (!result.reliability || result.reliability.beatRate === null) {
      const headline = `We have not graded ${player.name} against his projections${
        params.window.kind === "seasons" ? ` for ${asked}` : ""
      }.`;
      const context = buildContext({
        formatDisplay: ctx.formatDisplay,
        note: "Projection accuracy from weekly projections against weekly results.",
      });
      return {
        headline,
        speech: headline,
        facts: [],
        context,
        links: [playerLink(player)],
        caveats,
      };
    }

    const r = result.reliability;
    const beatRate = r.beatRate as number;
    const covered = coverageSentence(params.window, r.seasons);
    if (covered) caveats.push(covered);

    const rate = formatStatValue(beatRate * 100, "percent");
    const headline = `${player.name} beat his weekly projection ${rate} of the time, ${r.weeksBeat} of ${r.weeksPlayed} games${
      r.seasons.length > 0 ? ` across ${listSeasons(r.seasons)}` : ""
    }.`;

    const facts = [
      { label: "Beat rate", value: rate },
      { label: "Games beaten", value: `${r.weeksBeat} of ${r.weeksPlayed}` },
    ];
    if (r.meanDiff !== null) {
      const signed = r.meanDiff >= 0 ? "above" : "below";
      facts.push({
        label: "Against projection",
        value: `${formatStatValue(Math.abs(r.meanDiff), "decimal1")} points ${signed} a game`,
      });
    }
    if (r.availabilityRate !== null && r.availabilityRate < 1) {
      facts.push({
        label: "Availability",
        value: `${formatStatValue(r.availabilityRate * 100, "percent")} of projected games`,
      });
    }
    if (r.ratioStdev !== null) {
      facts.push({
        label: "Week-to-week swing",
        // Spelled out rather than left as a bare number: a standard deviation
        // of a ratio means nothing to most readers without the direction.
        value: `${formatStatValue(r.ratioStdev, "decimal1")}, higher means streakier`,
      });
    }

    // A beat rate is a fraction, and a fraction over five games is a rumour.
    if (r.weeksPlayed < 8) {
      caveats.push(
        `That is only ${r.weeksPlayed} graded ${r.weeksPlayed === 1 ? "game" : "games"}, which is a small sample for a rate.`,
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
      links: [playerLink(player)],
      caveats,
    };
  },
};

/** "2024 and 2025", "2023, 2024 and 2025". */
export function listSeasons(seasons: number[]): string {
  if (seasons.length === 0) return "";
  if (seasons.length === 1) return String(seasons[0]);
  const head = seasons.slice(0, -1).join(", ");
  return `${head} and ${seasons[seasons.length - 1]}`;
}

/**
 * The sentence that appears when the reader asked for more seasons than we
 * grade. Silence here would be the answer pretending to a depth it does not
 * have.
 */
export function coverageSentence(
  window: SeasonWindowParam,
  covered: number[],
): string | null {
  if (window.kind !== "seasons") return null;
  const missing = window.seasons.filter((s) => !covered.includes(s));
  if (missing.length === 0) return null;
  if (covered.length === 0) {
    return `We hold no graded projections for ${listSeasons(window.seasons)}.`;
  }
  return `You asked about ${listSeasons(window.seasons)}. We only grade projections for ${listSeasons(covered)}, so that is what this covers.`;
}
