/**
 * "Top 10 quarterbacks", "best 25 running backs", "top 10 overall players".
 *
 * A ranked list rather than a fact about one player, so this is the one
 * capability that answers with a table. The rows are deliberately thin: rank,
 * face, name, position and team. Anything more would be a worse copy of the
 * rankings page, and that page is one link away at the bottom of every answer.
 *
 * A RANK IS MEANINGLESS WITHOUT ITS FORMAT. The read is the same `rankings` row
 * every other surface uses, for the reader's resolved format and source, and the
 * caption names both. A top ten in Dynasty Superflex and a top ten in Redraft
 * PPR share maybe half their names.
 *
 * ONE ROW PER PLAYER, NOT ONE BATCH PER BOARD. `rankings` holds a single row
 * per (player, format, source, week) and each row carries its own
 * `generated_at` from whenever that player was last written, so this board has
 * 316 rows across 5 distinct stamps. Filtering to the newest stamp looked
 * principled and returned the handful of players who happened to be written in
 * that instant: a "top 10" with one player in it, ranked 185th. The board is the
 * whole set; the newest stamp is only what the answer reports as "updated".
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability, BeamPlayerRow } from "@/lib/beam/types";
import { readSleeperId } from "@/lib/player-profile";
import { positionNoun, buildContext } from "@/lib/beam/answers/templates";
import { MAX_TOP_N } from "@/lib/beam/interpret/top-n";
import { parseWith } from "./shared";

const schema = z.object({
  /** Null means the overall board rather than one position. */
  position: z.string().max(8).nullable(),
  count: z.number().int().min(1).max(MAX_TOP_N),
  /** False when the reader named no number and we used the default. */
  countStated: z.boolean(),
});

type Params = z.infer<typeof schema>;
type Result = { rows: BeamPlayerRow[]; generatedAt: string | null };

/** Rows per page in the answer card. */
const PAGE_SIZE = 10;

type RankingRow = {
  overall_rank: number | null;
  position_rank: number | null;
  players: {
    slug: string | null;
    full_name: string | null;
    position: string | null;
    team: string | null;
    external_ids: Record<string, unknown> | null;
  } | null;
};

export const rankingsTop: BeamCapability<Params, Result> = {
  id: "rankings.top",
  label: "Top players",
  description: "A ranked list of the best players overall or at one position.",
  playerScope: "current",
  declineMessage: "We do not have a ranking board for that yet.",
  matcher: {
    base: 0.55,
    required: ["leaderboard"],
    optional: ["position"],
    heads: ["who is", "what is", "who had more"],
    // No player is named in a leaderboard question, which is most of what
    // separates it from every other capability here.
    playerCount: 0,
  },
  examples: [
    "Top 10 quarterbacks",
    "Who are the top 25 running backs?",
    "Top 10 overall players",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    if (!ctx.formatConfigId || !ctx.sourceSlug) return null;

    // The freshest stamp on the board, for the "updated" line. Not a filter.
    const { data: latest } = await ctx.supabase
      .from("rankings")
      .select("generated_at")
      .eq("format_config_id", ctx.formatConfigId)
      .eq("source", ctx.sourceSlug)
      .is("week", null)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const generatedAt = (latest as { generated_at: string | null } | null)?.generated_at ?? null;

    const rankColumn = params.position ? "position_rank" : "overall_rank";

    let query = ctx.supabase
      .from("rankings")
      .select(
        "overall_rank, position_rank, players!inner(slug, full_name, position, team, external_ids)",
      )
      .eq("format_config_id", ctx.formatConfigId)
      .eq("source", ctx.sourceSlug)
      .is("week", null)
      .not(rankColumn, "is", null);

    if (params.position) {
      query = query.eq("players.position", params.position);
    }

    const { data, error } = await query
      .order(rankColumn, { ascending: true })
      .limit(params.count);

    if (error) {
      console.error("[beam] leaderboard read failed", error);
      return null;
    }

    const rows: BeamPlayerRow[] = [];
    for (const raw of (data ?? []) as unknown as RankingRow[]) {
      const player = raw.players;
      if (!player?.slug || !player.full_name) continue;
      const rank = params.position ? raw.position_rank : raw.overall_rank;
      if (rank === null) continue;
      rows.push({
        rank,
        name: player.full_name,
        slug: player.slug,
        position: player.position,
        team: player.team,
        // readSleeperId takes the row, not the column, and falls back to the
        // slug tail when external_ids has no Sleeper key.
        sleeperId: readSleeperId({
          slug: player.slug,
          external_ids: player.external_ids,
        }),
      });
    }

    return { rows, generatedAt };
  },

  present(result, params, ctx): BeamAnswer {
    const caveats: string[] = [];
    const what = params.position
      ? plural(positionNoun(params.position))
      : "players overall";

    if (result.rows.length === 0) {
      const headline = `We do not have a ${what} board in ${ctx.formatDisplay} right now.`;
      return {
        headline,
        speech: headline,
        facts: [],
        context: buildContext({
          formatDisplay: ctx.formatDisplay,
          sourceDisplay: ctx.sourceDisplay,
        }),
        links: [{ href: "/rankings", label: "Open the rankings board" }],
        caveats,
      };
    }

    // Asked for more than the board holds. Saying so beats a short list that
    // looks like the answer to a question nobody asked.
    if (result.rows.length < params.count) {
      caveats.push(
        `You asked for ${params.count}. The ${ctx.formatDisplay} board holds ${result.rows.length} ranked ${what}, so that is the whole list.`,
      );
    }
    if (!params.countStated) {
      caveats.push(`You did not say how many, so this is the top ${result.rows.length}.`);
    }

    const shown = result.rows.length;
    const headline = `The top ${shown} ${what} in ${ctx.formatDisplay}.`;

    // Spoken as a sentence, because a table read cell by cell is not an answer.
    // The first three are named and the rest are counted; the table itself is
    // navigable by anyone who wants row four.
    const leaders = result.rows
      .slice(0, 3)
      .map((row) => `${row.rank}, ${row.name}`)
      .join(". ");
    const speech =
      shown <= 3
        ? `${headline} ${leaders}.`
        : `${headline} ${leaders}. The remaining ${shown - 3} are in the table below, ten to a page.`;

    return {
      headline,
      table: {
        caption: `Top ${shown} ${what} in ${ctx.formatDisplay}, from ${ctx.sourceDisplay ?? "our"} rankings`,
        rows: result.rows,
        pageSize: PAGE_SIZE,
      },
      speech: `${speech}${caveats.length > 0 ? ` ${caveats.join(" ")}` : ""}`,
      facts: [],
      context: buildContext({
        formatDisplay: ctx.formatDisplay,
        sourceDisplay: ctx.sourceDisplay,
        asOf: result.generatedAt,
      }),
      links: [{ href: "/rankings", label: "Open the full rankings board" }],
      caveats,
    };
  },
};

/** "quarterback" to "quarterbacks". Every position noun we produce is regular. */
function plural(noun: string): string {
  return noun.endsWith("s") ? noun : `${noun}s`;
}
