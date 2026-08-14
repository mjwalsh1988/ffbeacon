/**
 * "Who are the draft steals?" / "Which players should I avoid in my draft?"
 *
 * Answered from draft_value_targets, the same board the draft guide renders at
 * /guides/fantasy-football-draft-guide. Nothing is computed here: the nightly
 * job already compared our values and projected points above a replacement
 * starter against real ADP, wrote the three buckets, and wrote the plain-English
 * verdict sentence for every row. This capability reads that and reads nothing
 * else, so BEAM and the guide can never disagree about who the steals are.
 *
 * THE BUCKET IS NAMED, NEVER INFERRED. Steals and fades are opposite answers to
 * opposite questions, and a reader who asked who to avoid does not want the list
 * of who to take. The lexicon carries both sides as separate concepts and the
 * interpreter passes whichever one was said; a question that names the board
 * with no side ("what does the draft guide say") gets steals, because that is
 * what the board leads with.
 *
 * FORMAT COMES FROM THE READER, as everywhere else. A steal in Redraft PPR is
 * not a steal in Dynasty Superflex, because the ADP it is measured against is a
 * different market. When their format has no board, the answer falls to one that
 * does and says so, matching what the guide page itself does.
 */

import { z } from "zod";
import type {
  BeamAnswer,
  BeamCapability,
  BeamFact,
  BeamPlayerRow,
} from "@/lib/beam/types";
import { buildContext, positionNoun } from "@/lib/beam/answers/templates";
import {
  loadBoardBuckets,
  loadFormatsWithBoards,
  marketLabel,
  type BoardEntry,
} from "@/lib/draft-value/guide-data";
import { parseWith } from "./shared";

/** How many rows an answer carries when the reader named no number. */
export const DEFAULT_BOARD_COUNT = 10;
const MAX_BOARD_COUNT = 24;

/** Rows per page in the answer card, matching the leaderboard answer. */
const PAGE_SIZE = 10;

const schema = z.object({
  bucket: z.enum(["steal", "swing", "fade"]),
  /** Null means the whole board rather than one position. */
  position: z.string().max(8).nullable(),
  count: z.number().int().min(1).max(MAX_BOARD_COUNT),
});

type Params = z.infer<typeof schema>;

type Result = {
  rows: BeamPlayerRow[];
  /** The leading entry, for the sentence that explains why it is on the list. */
  leader: BoardEntry | null;
  /** How many the bucket holds before the count cap. */
  available: number;
  formatDisplay: string;
  /** Set when the reader's own format has no board and we used another. */
  fellBackFrom: string | null;
  season: number;
  computedAt: string | null;
  market: string;
};

/** What each bucket is called in the answer, singular and plural. */
const BUCKET_NOUN: Record<Params["bucket"], { one: string; many: string }> = {
  steal: { one: "steal", many: "steals" },
  swing: { one: "late-round swing", many: "late-round swings" },
  fade: { one: "fade", many: "fades" },
};

/** One sentence saying what the bucket MEANS, because the label alone does not. */
const BUCKET_MEANING: Record<Params["bucket"], string> = {
  steal: "Our board wants these players earlier than the room takes them.",
  swing: "Thin evidence on purpose: late picks worth spending on the upside.",
  fade: "The room is spending earlier on these players than our board says they are worth.",
};

export const draftBoard: BeamCapability<Params, Result> = {
  id: "draft.board",
  label: "Draft steals and fades",
  description:
    "The draft guide's board: who the room drafts too late, too early, or as a late swing.",
  playerScope: "current",
  declineMessage:
    "We do not have a draft board for that yet. The guide rebuilds it nightly once a market has enough ADP behind it.",
  matcher: {
    base: 0.55,
    required: ["draft-board"],
    optional: ["position"],
    heads: ["who is", "who is better", "what is"],
    // Nobody is named in a board question, which is most of what separates it
    // from a question about one player's draft value.
    playerCount: 0,
  },
  examples: [
    "Who are the draft steals?",
    "Which players should I avoid in my draft?",
    "Draft steals at running back",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    const { formats, season } = await loadFormatsWithBoards(ctx.supabase);
    if (season === null || formats.length === 0) return null;

    // The reader's format wins when it has a board. When it does not, fall to
    // the first that does rather than answering with nothing, which is what the
    // guide page does with the same data.
    const own = formats.find((f) => f.slug === ctx.formatSlug);
    const active = own ?? formats[0];

    const board = await loadBoardBuckets(ctx.supabase, {
      formatSlug: active.slug,
      season,
      limit: MAX_BOARD_COUNT,
    });

    const entries =
      params.bucket === "steal"
        ? board.steals
        : params.bucket === "fade"
          ? board.fades
          : board.swings;

    const forPosition = params.position
      ? entries.filter((entry) => entry.position === params.position)
      : entries;

    if (forPosition.length === 0) return null;

    const shown = forPosition.slice(0, params.count);

    return {
      // A row without a slug has nowhere to link and would collide with any
      // other slugless row as a React key. There should be none; dropping them
      // is cheaper than rendering a broken link if there ever is one.
      rows: shown
        .filter((entry): entry is BoardEntry & { slug: string } =>
          Boolean(entry.slug),
        )
        .map((entry, index) => ({
          rank: index + 1,
          name: entry.name,
          slug: entry.slug,
          position: entry.position,
          team: entry.team,
          sleeperId: entry.sleeperId,
        })),
      leader: shown[0] ?? null,
      available: forPosition.length,
      formatDisplay: active.display,
      fellBackFrom: own ? null : ctx.formatDisplay,
      season,
      computedAt: board.computedAt,
      market: marketLabel(board.marketSource, board.marketAdpKey),
    };
  },

  present(result, params): BeamAnswer {
    const noun = BUCKET_NOUN[params.bucket];
    const count = result.rows.length;
    const what = count === 1 ? noun.one : noun.many;
    // "at running back", singular: the position is the category the list was
    // filtered to, not a count of people. "6 steals at running backs" is the
    // kind of small wrongness that makes a sentence read like a template.
    const where = params.position ? ` at ${positionNoun(params.position)}` : "";

    const headline = `${count} ${what}${where} on our ${result.season} draft board in ${result.formatDisplay}.`;

    const caveats: string[] = [];
    if (result.fellBackFrom) {
      caveats.push(
        `We do not have a draft board for ${result.fellBackFrom} yet, so this is the ${result.formatDisplay} board.`,
      );
    }
    if (result.available > count) {
      // Deliberately not "the board holds N". We read the board capped, so N is
      // how many we fetched rather than how many exist, and quoting it as a
      // total would be a number we did not measure.
      caveats.push(
        `The board runs deeper than this. These are the top ${count}, and the guide has the rest.`,
      );
    }

    // The board already wrote a sentence for every row explaining where the
    // room takes him and where we would. Quoting the leader's is worth more
    // than repeating four numbers out of the table underneath it.
    const facts: BeamFact[] = [];
    if (result.leader) {
      facts.push({
        label: `Why ${result.leader.name} leads`,
        value: result.leader.verdict,
      });
    }

    const leaders = result.rows
      .slice(0, 3)
      .map((row) => row.name)
      .join(", ");
    const spokenTail =
      count > 3
        ? ` The other ${count - 3} are in the table below, ten to a page.`
        : "";

    return {
      headline,
      body: BUCKET_MEANING[params.bucket],
      table: {
        caption: `${count} ${what}${where} on the ${result.season} FF Beacon draft board in ${result.formatDisplay}`,
        rows: result.rows,
        pageSize: PAGE_SIZE,
      },
      speech: `${headline} ${BUCKET_MEANING[params.bucket]} ${leaders}.${spokenTail}${
        result.leader ? ` ${result.leader.verdict}` : ""
      }${caveats.length > 0 ? ` ${caveats.join(" ")}` : ""}`,
      facts,
      context: buildContext({
        formatDisplay: result.formatDisplay,
        asOf: result.computedAt,
        note: `Draft board measured against ${result.market}.`,
      }),
      links: [
        {
          href: "/guides/fantasy-football-draft-guide",
          label: "Open the draft guide",
        },
      ],
      caveats,
    };
  },
};
