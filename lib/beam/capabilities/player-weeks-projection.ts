/**
 * "Project the season total from weeks 2 through 4 of last year for Michael
 * Wilson."
 *
 * Take a stretch of weeks, work out what the player did per game inside it, and
 * stretch that pace across a full season. The arithmetic is deliberately the
 * arithmetic anyone would do by hand:
 *
 *   per game   = total in the window / games he actually played in the window
 *   projected  = per game * games in a season (17 since 2021, 16 before)
 *
 * WHY GAMES AND NOT WEEKS. A five-week window in which he was hurt for two is
 * three games of evidence, not five. Dividing by weeks would quietly halve a
 * player's pace for the crime of missing time, which is the opposite of what the
 * question asks: the reader wants to know what the good weeks were worth.
 *
 * THE PROJECTION IS NOT A FORECAST, and the answer says so. It assumes a full
 * season at exactly that pace, which nobody does; it is a way of putting a hot
 * or cold stretch on a scale people already understand. When the stat is fantasy
 * points we also say where that total would have finished at the position that
 * season, because "142 points" means nothing until it is "WR52 of 122".
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
  type SeasonAggregate,
  type StatValue,
} from "@/lib/beam/stats/query";
import { formatStatValue, lowerLabel, ordinal, withNoun } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech, positionNoun } from "@/lib/beam/answers/templates";
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
  weeks: weekRangeSchema,
});

type Params = z.infer<typeof schema>;

type Result = {
  value: StatValue;
  aggregate: SeasonAggregate | null;
  positionSupported: boolean;
  /** Games he actually played inside the window. The denominator. */
  games: number;
  /** 17 since 2021, 16 before it. */
  seasonGames: number;
  perGame: number | null;
  projected: number | null;
  /** Only for fantasy points: where that projected total would have finished. */
  finish: { rank: number; of: number; position: string } | null;
};

/** The NFL played 16 games a season through 2020 and 17 from 2021. */
function gamesInSeason(season: number): number {
  return season >= 2021 ? 17 : 16;
}

export const playerWeeksProjection: BeamCapability<Params, Result> = {
  id: "player.weeks.projection",
  label: "Project a week range over a season",
  description:
    "Takes a player's per-game pace across a stretch of weeks and extends it over a full season.",
  playerScope: "historical",
  declineMessage: "We could not project that stretch of weeks.",
  matcher: {
    base: 0.5,
    // "project" is required, not merely rewarded. Without it this capability
    // and the plain week-range total score the same and the projection wins on
    // registry order, which would answer a straight "how many yards in weeks 2
    // to 8" with a full-season extrapolation nobody asked for.
    required: ["player", "weeks", "project"],
    optional: ["stat", "season"],
    heads: [],
    playerCount: 1,
  },
  examples: [
    "Project the season total from weeks 2 through 4 of last year for Michael Wilson",
    "What pace was Puka Nacua on from weeks 1 to 6 in 2025?",
    "Project Bijan Robinson's rushing yards from weeks 10 through 17 of last year",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    const stat = getStat(params.statId as BeamStatId);
    const seasonGames = gamesInSeason(params.season.season);
    const empty: Result = {
      value: { statId: stat.id, value: null, isTrueZero: false },
      aggregate: null,
      positionSupported: true,
      games: 0,
      seasonGames,
      perGame: null,
      projected: null,
      finish: null,
    };

    if (!statSupportsPosition(stat, params.player.position)) {
      return { ...empty, positionSupported: false };
    }
    if (seasonOutOfRange(params.season.season, ctx.clock)) return empty;

    const aggregates = await loadSeasonAggregates(
      ctx.supabase,
      [params.player.id],
      params.season.season,
      ctx.scoringKey,
      "regular",
      params.weeks,
    );
    const aggregate = aggregates.get(params.player.id) ?? null;
    if (!aggregate || aggregate.weeks === 0) return { ...empty, aggregate };

    const value = computeStat(stat, aggregate);

    // Games played is the honest denominator. When the games-played flag is
    // missing (it is null on some older rows), fall back to the number of weekly
    // rows we hold, which is the same thing for anyone who was not inactive.
    const games = aggregate.gamesPlayed > 0 ? aggregate.gamesPlayed : aggregate.weeks;
    if (value.value === null || games <= 0) {
      return { ...empty, aggregate, value, games };
    }

    // A rate is already per-something. Projecting "yards per carry" over 17
    // games is arithmetic with no meaning, so the per-game and projected figures
    // are left null and the presenter reports the rate on its own.
    const isRate =
      stat.aggregation.kind === "ratio" ||
      stat.aggregation.kind === "avgPerGame" ||
      (stat.aggregation.kind === "fantasy" && stat.aggregation.perGame);

    const perGame = isRate ? null : value.value / games;
    const projected = perGame === null ? null : perGame * seasonGames;

    let finish: Result["finish"] = null;
    if (
      projected !== null &&
      stat.aggregation.kind === "fantasy" &&
      params.player.position
    ) {
      finish = await projectedFinish(
        ctx.supabase,
        params.season.season,
        ctx.scoringKey,
        params.player.position,
        projected,
      );
    }

    return {
      value,
      aggregate,
      positionSupported: true,
      games,
      seasonGames,
      perGame,
      projected,
      finish,
    };
  },

  present(result, params, ctx): BeamAnswer {
    const stat = getStat(params.statId as BeamStatId);
    const player = params.player;
    const season = params.season.season;
    const period = periodLabel(season, params.weeks);
    const caveats: string[] = [];

    if (!result.positionSupported) {
      const headline = `We do not track ${lowerLabel(stat.label)} for ${player.position ? `a ${positionNoun(player.position)}` : "this player"}, so there is nothing to project for ${player.name}.`;
      const context = buildContext({ note: "Weekly game logs." });
      return {
        headline,
        speech: headline,
        facts: [],
        context,
        links: [playerLink(player)],
        caveats,
      };
    }

    if (result.value.value === null || result.projected === null) {
      const headline = `We do not have enough of ${player.name}'s ${lowerLabel(stat.label)} in ${period} to project from.`;
      if (seasonOutOfRange(season, ctx.clock)) {
        caveats.push(outOfRangeCaveat(season, ctx.clock));
      } else if (result.aggregate && result.aggregate.weeks === 0) {
        caveats.push(
          `We hold no game logs for him in ${period}, which usually means he did not play those weeks.`,
        );
      } else if (result.value.value !== null && result.perGame === null) {
        caveats.push(
          `${stat.label} is already an average, so stretching it over a season would not mean anything. In ${period} it was ${formatStatValue(result.value.value, stat.format)}.`,
        );
      }
      const context = buildContext({ note: "Weekly game logs." });
      return {
        headline,
        speech: `${headline} ${caveats.join(" ")}`.trim(),
        facts: [],
        context,
        links: [playerLink(player)],
        caveats,
      };
    }

    const perGame = result.perGame as number;
    const projected = result.projected;
    const perGameText = formatStatValue(perGame, "decimal1");
    const projectedText = formatStatValue(projected, stat.format);
    const label = lowerLabel(stat.label);

    const headline = `Over ${period}, ${player.name} averaged ${perGameText} ${label} a game. At that pace across ${result.seasonGames} games he would have finished with ${projectedText}.`;

    const facts = [
      {
        label: `In ${period}`,
        value: withNoun(
          result.value.value,
          formatStatValue(result.value.value, stat.format),
          stat.nounSingular,
          stat.nounPlural,
        ),
      },
      { label: "Games in that stretch", value: formatStatValue(result.games, "count") },
      { label: "Per game", value: perGameText },
      {
        label: `Projected over ${result.seasonGames} games`,
        value: projectedText,
      },
    ];

    if (result.finish) {
      facts.push({
        label: "That would have finished",
        value: `${result.finish.position}${result.finish.rank} of ${result.finish.of} that season`,
      });
    }

    // The assumption is stated every time, because a projection that does not
    // say what it assumed is a prediction, and this is not one.
    caveats.push(
      `This holds his ${period} pace across a full ${result.seasonGames}-game season, and assumes he plays every one of them.`,
    );

    const windowWeeks = params.weeks.end - params.weeks.start + 1;
    if (result.games < windowWeeks) {
      // Per game and per week are the same number until someone misses time,
      // and then they answer two different questions: what he was worth when he
      // played, and what he was worth to a roster that had to start someone.
      // Both are shown, rather than picking one and hoping.
      facts.splice(3, 0, {
        label: "Per week across the stretch",
        value: formatStatValue(result.value.value / windowWeeks, "decimal1"),
      });
      caveats.push(
        `He has a game log for ${result.games} of those ${windowWeeks} weeks, so the per-game figure and the projection are over the ${result.games} he played.`,
      );
    }
    if (result.games <= 2) {
      caveats.push(
        `${result.games === 1 ? "One game" : "Two games"} is a small sample, and one big week moves a projection like this a long way.`,
      );
    }

    const isFantasy = stat.aggregation.kind === "fantasy";
    const context = buildContext({
      formatDisplay: isFantasy ? ctx.formatDisplay : null,
      note: "Per-game pace from the weekly game logs, extended over a full season.",
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

/**
 * Where a projected fantasy total would have finished at the player's position
 * that season.
 *
 * Counted against player_positional_finishes, the same table the profile page
 * uses for a real finish, so BEAM's "would have been WR33" and the site's actual
 * finishes are measured the same way. Two cheap reads: how many players beat the
 * number, and how many were ranked at all.
 */
async function projectedFinish(
  db: Parameters<typeof loadSeasonAggregates>[0],
  season: number,
  scoring: string,
  position: string,
  projected: number,
): Promise<{ rank: number; of: number; position: string } | null> {
  const [better, field] = await Promise.all([
    db
      .from("player_positional_finishes")
      .select("player_id", { count: "exact", head: true })
      .eq("season", season)
      .eq("scoring", scoring)
      .eq("position", position)
      .gt("total_points", projected),
    db
      .from("player_positional_finishes")
      .select("players_ranked")
      .eq("season", season)
      .eq("scoring", scoring)
      .eq("position", position)
      .limit(1)
      .maybeSingle(),
  ]);

  const ahead = better.count;
  const of = (field.data as { players_ranked: number } | null)?.players_ranked ?? null;
  if (ahead === null || of === null) return null;
  return { rank: ahead + 1, of, position };
}

/** Exported for the presenter's fact label, and for tests. */
export { gamesInSeason, ordinal };
