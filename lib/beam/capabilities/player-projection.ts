/**
 * "What is Bijan Robinson projected for?"
 *
 * The weekly projections we already hold, summed. In the preseason that is the
 * whole season; once games start it is what is left, which is the number that
 * actually matters to someone deciding what to do this week.
 *
 * The answer always says which of the two it gave, and how many games are in it.
 * A projected total with no games attached is unreadable: 240 points is a good
 * season and a spectacular six weeks.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { loadProjectionOutlook, type ProjectionOutlook } from "@/lib/beam/projections/load";
import { resolveSeasonClock } from "@/lib/breakdown/load-extras";
import { formatStatValue } from "@/lib/beam/answers/format";
import { buildContext, buildSpeech } from "@/lib/beam/answers/templates";
import { parseWith, playerLink, playerRefSchema } from "./shared";

const schema = z.object({
  player: playerRefSchema,
});

type Params = z.infer<typeof schema>;
type Result = { outlook: ProjectionOutlook | null; restOfSeason: boolean };

export const playerProjection: BeamCapability<Params, Result> = {
  id: "player.projection",
  label: "Player projection",
  description: "What a player is projected to score, for the season or the rest of it.",
  playerScope: "current",
  declineMessage: "We do not hold projections for that player.",
  matcher: {
    base: 0.5,
    required: ["player", "projection"],
    optional: [],
    heads: ["what is", "how many", "what are"],
    playerCount: 1,
  },
  examples: [
    "What is Bijan Robinson projected for?",
    "What are Puka Nacua's projections?",
    "What is James Cook's rest of season projection?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    // The projection clock is not the stat clock: projections exist for a season
    // that has not been played, which is the whole point of them. This is the
    // same resolver Beacon Breakdown uses, so the two cannot drift apart.
    const clock = await resolveSeasonClock(ctx.supabase);
    if (clock.season === null) return null;

    const outlooks = await loadProjectionOutlook(
      ctx.supabase,
      [params.player.id],
      clock.season,
      clock.currentWeek,
      ctx.scoringKey,
    );
    const outlook = outlooks.get(params.player.id) ?? null;
    if (!outlook || outlook.seasonWeeks === 0) return { outlook: null, restOfSeason: false };
    return { outlook, restOfSeason: clock.currentWeek > 1 };
  },

  present(result, params, ctx): BeamAnswer {
    const player = params.player;
    const caveats: string[] = [];

    if (!result.outlook) {
      const headline = `We do not hold weekly projections for ${player.name}.`;
      const context = buildContext({
        formatDisplay: ctx.formatDisplay,
        note: "Weekly projections.",
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

    const o = result.outlook;
    const points = result.restOfSeason ? o.remainingPoints : o.seasonPoints;
    const weeks = result.restOfSeason ? o.remainingWeeks : o.seasonWeeks;
    const perGame = weeks > 0 ? points / weeks : null;
    const total = formatStatValue(points, "decimal1");

    const headline = result.restOfSeason
      ? `${player.name} is projected for ${total} points over the rest of ${o.season}, across ${weeks} remaining ${weeks === 1 ? "game" : "games"}.`
      : `${player.name} is projected for ${total} points in ${o.season}, across ${weeks} ${weeks === 1 ? "game" : "games"}.`;

    const facts = [
      {
        label: result.restOfSeason ? "Rest of season" : `${o.season} projection`,
        value: `${total} points`,
      },
      { label: "Games projected", value: String(weeks) },
    ];
    if (perGame !== null) {
      facts.push({ label: "Per game", value: formatStatValue(perGame, "decimal1") });
    }
    if (result.restOfSeason) {
      facts.push({
        label: `Full ${o.season}`,
        value: `${formatStatValue(o.seasonPoints, "decimal1")} points`,
      });
    }
    if (o.next) {
      facts.push({
        label: `Week ${o.next.week}`,
        value: `${formatStatValue(o.next.points, "decimal1")} points${o.next.opponent ? ` against ${o.next.opponent}` : ""}`,
      });
    }

    // A projection is a starting point, not a verdict, and BEAM holds the number
    // that says how much to trust it. Pointing at it is more useful than
    // repeating the projection with more decimal places.
    caveats.push(
      "A projection is a starting point. Ask for his beat rate to see how often he has actually cleared one.",
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
      links: [playerLink(player)],
      caveats,
    };
  },
};
