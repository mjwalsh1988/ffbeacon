/**
 * "How did Jahmyr Gibbs do in 2025?"
 *
 * A whole season in one card. The stats shown are chosen by position, using the
 * same groupings the player profile's stats tab uses, so a receiver's line leads
 * with targets and a quarterback's leads with passing yards. A BEAM stat line
 * and the profile disagreeing about what matters for a position would be a
 * product with two opinions.
 *
 * Stats with no data are dropped rather than shown as zero. A line full of
 * zeroes reads as a bad season; it usually means we hold nothing.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { statLineFor } from "@/lib/beam/stats/registry";
import {
  computeStat,
  coverageCaveat,
  loadSeasonAggregates,
  type SeasonAggregate,
} from "@/lib/beam/stats/query";
import { formatStatValue } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech } from "@/lib/beam/answers/templates";
import { seasonCaveat } from "@/lib/beam/clock";
import {
  outOfRangeCaveat,
  parseWith,
  playerLink,
  playerRefSchema,
  seasonOutOfRange,
  seasonSchema,
} from "./shared";

const schema = z.object({
  player: playerRefSchema,
  season: seasonSchema,
});

type Params = z.infer<typeof schema>;
type Result = { aggregate: SeasonAggregate | null };

export const playerStatLine: BeamCapability<Params, Result> = {
  id: "player.stat.line",
  label: "Player season line",
  description: "A whole season's headline statistics for one player.",
  playerScope: "historical",
  declineMessage: "We do not hold a game log for that player and season.",
  matcher: {
    base: 0.3,
    required: ["player"],
    optional: ["season"],
    heads: ["how did", "what were"],
    playerCount: 1,
  },
  examples: [
    "How did Jahmyr Gibbs do in 2025?",
    "What were Puka Nacua's numbers last year?",
    "How did Brock Purdy do in 2024?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx) {
    if (seasonOutOfRange(params.season.season, ctx.clock)) return { aggregate: null };
    const aggregates = await loadSeasonAggregates(
      ctx.supabase,
      [params.player.id],
      params.season.season,
      ctx.scoringKey,
    );
    return { aggregate: aggregates.get(params.player.id) ?? null };
  },

  present(result, params, ctx): BeamAnswer {
    const player = params.player;
    const season = params.season.season;
    const caveats: string[] = [];

    const askedFor: "explicit" | "current" | "none" =
      params.season.source === "explicit"
        ? "explicit"
        : params.season.source === "current"
          ? "current"
          : "none";
    const clockNote = seasonCaveat(ctx.clock, season, askedFor);
    if (clockNote) caveats.push(clockNote);

    if (!result.aggregate || result.aggregate.weeks === 0) {
      const headline = `We do not have a ${season} game log for ${player.name}.`;
      if (seasonOutOfRange(season, ctx.clock)) caveats.push(outOfRangeCaveat(season, ctx.clock));
      const context = buildContext({ note: null });
      return {
        headline,
        speech: buildSpeech({ headline, facts: [], caveats, context }),
        facts: [],
        context,
        links: [playerLink(player)],
        caveats,
      };
    }

    const aggregate = result.aggregate;
    const facts = statLineFor(player.position)
      .map((stat) => {
        const computed = computeStat(stat, aggregate);
        if (computed.value === null) return null;
        return {
          label: stat.label,
          value: formatStatValue(computed.value, stat.format),
        };
      })
      .filter((f): f is { label: string; value: string } => f !== null);

    const games = aggregate.gamesPlayed;
    const headline =
      games > 0
        ? `Here is ${player.name}'s ${season} season across ${formatStatValue(games, "count")} ${games === 1 ? "game" : "games"}.`
        : `Here is what we hold for ${player.name} in ${season}.`;

    const coverage = coverageCaveat(aggregate);
    if (coverage) caveats.push(coverage);

    const context = buildContext({
      formatDisplay: ctx.formatDisplay,
      note: "Fantasy points use your selected scoring; the rest are raw season totals.",
    });

    return {
      headline,
      // The whole line is the answer here, so nothing is trimmed out of the
      // spoken version the way it is for a single-stat card.
      speech: buildSpeech({ headline, facts, caveats, context, maxFacts: facts.length }),
      facts,
      context,
      links: [playerLink(player)],
      caveats,
    };
  },
};
