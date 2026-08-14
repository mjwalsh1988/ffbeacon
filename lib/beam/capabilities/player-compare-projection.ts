/**
 * "Who is projected higher, Bijan Robinson or Jahmyr Gibbs?"
 *
 * The two-player form of player-projection.ts, one read for both.
 *
 * Per game is reported alongside the total, because two players with different
 * numbers of projected games are not comparable on a total alone: a player on a
 * bye-heavy remaining slate is not worse, he has fewer chances.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { loadProjectionOutlook, type ProjectionOutlook } from "@/lib/beam/projections/load";
import { resolveSeasonClock } from "@/lib/breakdown/load-extras";
import { formatStatValue, shortName } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech } from "@/lib/beam/answers/templates";
import { parseWith, playerLink, playerRefSchema } from "./shared";

const schema = z.object({
  a: playerRefSchema,
  b: playerRefSchema,
});

type Params = z.infer<typeof schema>;
type Result = {
  a: ProjectionOutlook | null;
  b: ProjectionOutlook | null;
  restOfSeason: boolean;
  season: number | null;
};

export const playerCompareProjection: BeamCapability<Params, Result> = {
  id: "player.compare.projection",
  label: "Compare projections",
  description: "Which of two players is projected to score more.",
  playerScope: "current",
  declineMessage: "We do not hold projections for both of those players.",
  matcher: {
    base: 0.55,
    required: ["player", "projection"],
    optional: [],
    heads: ["who is better", "who had more", "how many"],
    playerCount: 2,
  },
  examples: [
    "Who is projected higher, Bijan Robinson or Jahmyr Gibbs?",
    "Compare the projections for Puka Nacua and Garrett Wilson",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    const clock = await resolveSeasonClock(ctx.supabase);
    if (clock.season === null) return null;

    const outlooks = await loadProjectionOutlook(
      ctx.supabase,
      [params.a.id, params.b.id],
      clock.season,
      clock.currentWeek,
      ctx.scoringKey,
    );
    const pick = (id: string) => {
      const outlook = outlooks.get(id) ?? null;
      return outlook && outlook.seasonWeeks > 0 ? outlook : null;
    };
    return {
      a: pick(params.a.id),
      b: pick(params.b.id),
      restOfSeason: clock.currentWeek > 1,
      season: clock.season,
    };
  },

  present(result, params, ctx): BeamAnswer {
    const caveats: string[] = [];
    const total = (o: ProjectionOutlook | null): number | null => {
      if (!o) return null;
      return result.restOfSeason ? o.remainingPoints : o.seasonPoints;
    };
    const games = (o: ProjectionOutlook | null): number =>
      !o ? 0 : result.restOfSeason ? o.remainingWeeks : o.seasonWeeks;

    const aPoints = total(result.a);
    const bPoints = total(result.b);
    const period = result.restOfSeason
      ? `over the rest of ${result.season}`
      : `in ${result.season}`;

    let headline: string;
    if (aPoints === null && bPoints === null) {
      headline = `We hold no projections for ${params.a.name} or ${params.b.name}.`;
    } else if (aPoints === null) {
      headline = `We only have one side of this. ${params.b.name} is projected for ${formatStatValue(bPoints as number, "decimal1")} points ${period}, and we hold nothing for ${params.a.name}.`;
    } else if (bPoints === null) {
      headline = `We only have one side of this. ${params.a.name} is projected for ${formatStatValue(aPoints, "decimal1")} points ${period}, and we hold nothing for ${params.b.name}.`;
    } else {
      const aLeads = aPoints > bPoints;
      const leader = aLeads ? params.a : params.b;
      const trailer = aLeads ? params.b : params.a;
      const leaderPoints = formatStatValue(aLeads ? aPoints : bPoints, "decimal1");
      const trailerPoints = formatStatValue(aLeads ? bPoints : aPoints, "decimal1");
      headline = `${leader.name} is projected higher ${period}: ${leaderPoints} points to ${shortName(trailer.name)}'s ${trailerPoints}.`;
    }

    const facts = [
      { label: params.a.name, value: pointsFact(aPoints, games(result.a)) },
      { label: params.b.name, value: pointsFact(bPoints, games(result.b)) },
    ];
    if (aPoints !== null && bPoints !== null) {
      facts.push({
        label: "Difference",
        value: `${formatStatValue(Math.abs(aPoints - bPoints), "decimal1")} points`,
      });
      if (games(result.a) !== games(result.b)) {
        caveats.push(
          `They are not projected for the same number of games (${games(result.a)} against ${games(result.b)}), so compare the per-game figures rather than the totals.`,
        );
      }
    }

    caveats.push(
      "Projections are a starting point. Ask for their beat rates to see who has actually cleared one more often.",
    );

    const context = buildContext({
      formatDisplay: ctx.formatDisplay,
      note: "Weekly projections, summed.",
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

function pointsFact(points: number | null, games: number): string {
  if (points === null) return "No projection";
  const perGame = games > 0 ? ` (${formatStatValue(points / games, "decimal1")} a game over ${games})` : "";
  return `${formatStatValue(points, "decimal1")} points${perGame}`;
}
