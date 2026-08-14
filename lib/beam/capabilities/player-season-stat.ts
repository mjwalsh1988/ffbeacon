/**
 * "How many passing yards did Brock Purdy have in 2025?"
 *
 * The capability BEAM was built around. One player, one stat, one season, one
 * indexed read, one sentence.
 *
 * Three outcomes that are NOT the same and must not be rendered the same way:
 *   - a number
 *   - a true zero (he played, he recorded none of these)
 *   - nothing (we hold no rows, or the stat does not apply to his position)
 * Collapsing the last two into "0" is the difference between an assistant and a
 * broken query.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability, BeamContext } from "@/lib/beam/types";
import {
  BEAM_STAT_IDS,
  getStat,
  statSupportsPosition,
  type BeamStatId,
} from "@/lib/beam/stats/registry";
import {
  computeStat,
  coverageCaveat,
  loadSeasonAggregates,
  type SeasonAggregate,
  type StatValue,
} from "@/lib/beam/stats/query";
import { formatStatValue, withNoun } from "@/lib/beam/answers/format";
import {
  buildContext,
  buildSpeech,
  noDataSentence,
  statSentence,
  trueZeroSentence,
  wrongPositionSentence,
} from "@/lib/beam/answers/templates";
import { seasonCaveat } from "@/lib/beam/clock";
import {
  outOfRangeCaveat,
  parseWith,
  periodLabel,
  playerLink,
  playerRefSchema,
  seasonOutOfRange,
  seasonSchema,
  weekRangeSchema,
} from "./shared";

const schema = z.object({
  player: playerRefSchema,
  statId: z.enum(BEAM_STAT_IDS),
  season: seasonSchema,
  /** Set when the reader asked about a stretch of weeks rather than a season. */
  weeks: weekRangeSchema.nullable().default(null),
});

type Params = z.infer<typeof schema>;

type Result = {
  value: StatValue;
  aggregate: SeasonAggregate | null;
  positionSupported: boolean;
};

export const playerSeasonStat: BeamCapability<Params, Result> = {
  id: "player.season.stat",
  label: "Player season statistic",
  description: "One statistic for one player in one season.",
  playerScope: "historical",
  declineMessage: "We could not work out that statistic for that player.",
  matcher: {
    base: 0.4,
    required: ["player", "stat"],
    optional: ["season", "weeks"],
    heads: ["how many", "what were", "how much"],
    playerCount: 1,
  },
  examples: [
    "How many passing yards did Brock Purdy have in 2025?",
    "How many passing yards did Brock Purdy have last year between weeks 2 and 8?",
    "How many touchdowns did Josh Allen throw last year?",
    "How many targets did CeeDee Lamb see?",
    "How many carries did Saquon Barkley have in 2024?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx) {
    const stat = getStat(params.statId as BeamStatId);
    if (!statSupportsPosition(stat, params.player.position)) {
      return { value: { statId: stat.id, value: null, isTrueZero: false }, aggregate: null, positionSupported: false };
    }
    if (seasonOutOfRange(params.season.season, ctx.clock)) {
      return { value: { statId: stat.id, value: null, isTrueZero: false }, aggregate: null, positionSupported: true };
    }

    const aggregates = await loadSeasonAggregates(
      ctx.supabase,
      [params.player.id],
      params.season.season,
      ctx.scoringKey,
      "regular",
      params.weeks,
    );
    const aggregate = aggregates.get(params.player.id) ?? null;
    if (!aggregate) {
      return { value: { statId: stat.id, value: null, isTrueZero: false }, aggregate: null, positionSupported: true };
    }
    return { value: computeStat(stat, aggregate), aggregate, positionSupported: true };
  },

  present(result, params, ctx): BeamAnswer {
    const stat = getStat(params.statId as BeamStatId);
    const player = params.player;
    const season = params.season.season;
    const period = periodLabel(season, params.weeks);
    const caveats: string[] = [];

    const askedFor: "explicit" | "current" | "none" =
      params.season.source === "explicit"
        ? "explicit"
        : params.season.source === "current"
          ? "current"
          : "none";
    const clockNote = seasonCaveat(ctx.clock, season, askedFor);
    if (clockNote) caveats.push(clockNote);

    let headline: string;

    if (!result.positionSupported) {
      headline = wrongPositionSentence(player.name, stat, player.position);
    } else if (result.value.value === null) {
      headline = noDataSentence(player.name, stat, period);
      if (seasonOutOfRange(season, ctx.clock)) {
        caveats.push(outOfRangeCaveat(season, ctx.clock));
      } else if (params.weeks && result.aggregate && result.aggregate.weeks === 0) {
        // He may have played that season and not those weeks. Saying so is the
        // difference between "we hold nothing" and "he was not out there".
        caveats.push(
          `We hold no game logs for ${player.name} in ${period}, which usually means he did not play those weeks.`,
        );
      }
    } else if (result.value.isTrueZero) {
      headline = trueZeroSentence(player.name, stat, period);
    } else {
      headline = statSentence(player.name, stat, result.value.value, period);
    }

    const facts = [];
    if (result.value.value !== null) {
      facts.push({
        label: stat.label,
        value: withNoun(
          result.value.value,
          formatStatValue(result.value.value, stat.format),
          stat.nounSingular,
          stat.nounPlural,
        ),
      });
    }
    if (result.aggregate && result.aggregate.gamesPlayed > 0) {
      facts.push({
        label: "Games played",
        value: formatStatValue(result.aggregate.gamesPlayed, "count"),
      });
      // A per-game figure is the number most people actually want next, and it
      // costs nothing once the total is in hand. Skipped for rates, where a
      // per-game average of an average is meaningless.
      if (
        result.value.value !== null &&
        (stat.aggregation.kind === "sum" || stat.aggregation.kind === "combine")
      ) {
        facts.push({
          label: "Per game",
          value: formatStatValue(
            result.value.value / result.aggregate.gamesPlayed,
            "decimal1",
          ),
        });
      }
    }
    facts.push({ label: "Season", value: String(season) });
    if (params.weeks) {
      facts.push({
        label: "Weeks",
        value:
          params.weeks.start === params.weeks.end
            ? String(params.weeks.start)
            : `${params.weeks.start} to ${params.weeks.end}`,
      });
    }

    if (result.aggregate) {
      const coverage = coverageCaveat(result.aggregate);
      if (coverage && stat.aggregation.kind === "fantasy") caveats.push(coverage);
    }

    const isFantasy = stat.aggregation.kind === "fantasy";
    const context = buildContext({
      // Only fantasy points depend on the reader's scoring. Stamping every stat
      // with a format would imply that passing yards change between leagues.
      formatDisplay: isFantasy ? ctx.formatDisplay : null,
      note: params.weeks
        ? "Totalled from the weekly game logs for those weeks."
        : "Season totals from weekly game logs.",
    });

    return {
      headline,
      speech: buildSpeech({ headline, facts, caveats, context }),
      facts,
      context,
      links: [playerLink(player)],
      caveats,
    };
  },
};
