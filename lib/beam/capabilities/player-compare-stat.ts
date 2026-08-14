/**
 * "Who had more receiving yards in 2025, CeeDee Lamb or Garrett Wilson?"
 *
 * The same read as the single-player stat capability with two ids in the `in`
 * clause, so a comparison costs one query rather than two.
 *
 * Direction matters. For interceptions, fumbles, and drops the winner is the
 * lower number, and a template that always says "had more" would congratulate a
 * quarterback on his turnovers.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import {
  BEAM_STAT_IDS,
  getStat,
  statSupportsPosition,
  type BeamStatId,
} from "@/lib/beam/stats/registry";
import {
  computeStat,
  loadSeasonAggregates,
  type StatValue,
} from "@/lib/beam/stats/query";
import { formatStatValue, lowerLabel } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech, compareSentence } from "@/lib/beam/answers/templates";
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
  a: playerRefSchema,
  b: playerRefSchema,
  statId: z.enum(BEAM_STAT_IDS),
  season: seasonSchema,
  /** Set when the reader asked about a stretch of weeks rather than a season. */
  weeks: weekRangeSchema.nullable().default(null),
});

type Params = z.infer<typeof schema>;
type Result = { a: StatValue; b: StatValue };


export const playerCompareStat: BeamCapability<Params, Result> = {
  id: "player.compare.stat",
  label: "Compare a statistic",
  description: "One statistic for two players in the same season.",
  playerScope: "historical",
  declineMessage: "We could not compare those two on that statistic.",
  matcher: {
    base: 0.45,
    required: ["player", "stat"],
    optional: ["season", "weeks"],
    heads: ["who had more", "how many"],
    playerCount: 2,
  },
  examples: [
    "Who had more receiving yards in 2025, CeeDee Lamb or Garrett Wilson?",
    "How many receiving yards did Marvin Harrison and Michael Wilson each have between weeks 2 and 9 of last year?",
    "Who had more rushing touchdowns last year, Saquon Barkley or Derrick Henry?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx) {
    const stat = getStat(params.statId as BeamStatId);
    const empty: StatValue = { statId: stat.id, value: null, isTrueZero: false };
    if (seasonOutOfRange(params.season.season, ctx.clock)) return { a: empty, b: empty };

    const aggregates = await loadSeasonAggregates(
      ctx.supabase,
      [params.a.id, params.b.id],
      params.season.season,
      ctx.scoringKey,
      "regular",
      params.weeks,
    );

    const valueFor = (id: string, position: string | null): StatValue => {
      if (!statSupportsPosition(stat, position)) return empty;
      const aggregate = aggregates.get(id);
      return aggregate ? computeStat(stat, aggregate) : empty;
    };

    return {
      a: valueFor(params.a.id, params.a.position),
      b: valueFor(params.b.id, params.b.position),
    };
  },

  present(result, params, ctx): BeamAnswer {
    const stat = getStat(params.statId as BeamStatId);
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

    const aValue = result.a.value;
    const bValue = result.b.value;

    let headline: string;
    if (aValue === null && bValue === null) {
      headline = `We do not have ${lowerLabel(stat.label)} for either of them in ${period}.`;
      if (seasonOutOfRange(season, ctx.clock)) caveats.push(outOfRangeCaveat(season, ctx.clock));
    } else if (aValue === null) {
      headline = `We only have one side of this. ${params.b.name} had ${formatStatValue(bValue as number, stat.format)} ${lowerLabel(stat.label)} in ${period}, and we hold nothing for ${params.a.name}.`;
    } else if (bValue === null) {
      headline = `We only have one side of this. ${params.a.name} had ${formatStatValue(aValue, stat.format)} ${lowerLabel(stat.label)} in ${period}, and we hold nothing for ${params.b.name}.`;
    } else {
      // Direction comes from the registry, so the winner and the verb that
      // describes them can never disagree.
      const aLeads = stat.lowerIsBetter ? aValue < bValue : aValue > bValue;
      const leader = aLeads ? params.a : params.b;
      const trailer = aLeads ? params.b : params.a;
      const leaderValue = aLeads ? aValue : bValue;
      const trailerValue = aLeads ? bValue : aValue;
      headline = compareSentence(
        leader.name,
        trailer.name,
        stat,
        leaderValue,
        trailerValue,
        period,
      );
    }

    const facts = [
      {
        label: params.a.name,
        value: aValue === null ? "No data" : formatStatValue(aValue, stat.format),
      },
      {
        label: params.b.name,
        value: bValue === null ? "No data" : formatStatValue(bValue, stat.format),
      },
    ];
    if (aValue !== null && bValue !== null) {
      facts.push({
        label: "Difference",
        value: formatStatValue(Math.abs(aValue - bValue), stat.format),
      });
    }
    if (params.weeks) {
      facts.push({
        label: "Weeks",
        value:
          params.weeks.start === params.weeks.end
            ? `${params.weeks.start} of ${season}`
            : `${params.weeks.start} to ${params.weeks.end} of ${season}`,
      });
    }

    const context = buildContext({
      formatDisplay: stat.aggregation.kind === "fantasy" ? ctx.formatDisplay : null,
      note: params.weeks
        ? "Totalled from the weekly game logs for those weeks."
        : "Season totals from weekly game logs.",
    });

    return {
      headline,
      speech: buildSpeech({ headline, facts, caveats, context }),
      facts,
      context,
      links: [
        playerLink(params.a),
        playerLink(params.b),
        {
          href: `/tools/beacon-breakdown?a=${encodeURIComponent(params.a.slug)}&b=${encodeURIComponent(params.b.slug)}`,
          label: "Full head-to-head in Beacon Breakdown",
        },
      ],
      caveats,
    };
  },
};
