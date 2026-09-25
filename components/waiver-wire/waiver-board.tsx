/**
 * The waiver board: a panel per position, each holding a grid of player cards.
 *
 * THE DEFAULT VIEW IS GROUPED BY POSITION, AND THAT IS A CORRECTNESS FIX RATHER
 * THAN A LAYOUT PREFERENCE. Ranking every available player against each other
 * on points above replacement sounds right and produces a board of kickers and
 * defenses. The reason is structural: replacement level for a wide receiver in
 * a twelve-team league is about the 47th best one, which is better than
 * anything that ever reaches waivers, so every skill player scores negative. A
 * defense only has to beat the 12th best defense, and the wire is full of
 * defenses nobody rosters, so they all score positive. The comparison is
 * arithmetically honest and completely useless: it answers "who beats their own
 * replacement" when the reader asked "who should I add".
 *
 * Grouping removes the cross-position comparison entirely. Inside a position,
 * ordering on the same score is exactly right, and that is where it is used.
 *
 * WHY PANELS AND A GRID RATHER THAN A STACK OF WIDE ROWS. One column of
 * full-width rows is a very long page of very empty lines at desktop width, and
 * it gives a reader no structure to navigate by: twenty-four identical blocks
 * with no visible beginning or end to anything. The shared `Panel` gives each
 * position a header band, a beacon hairline and a real region landmark, and the
 * two-up card grid inside halves the scroll. `components/waiver-wire/
 * player-card.tsx` carries the reasoning for the card itself.
 *
 * AN EMPTY BOARD ALWAYS SAYS WHY. "Nobody is worth adding this week" is a
 * claim, and it is never the one we are making. Each `BoardEmptyReason` gets
 * its own sentence naming the specific thing that is missing, because a reader
 * who knows the projections have not landed will come back on Wednesday and a
 * reader looking at a shrug will not.
 *
 * Presentational server component.
 */

import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import type {
  BoardEmptyReason,
  BoardPosition,
  WaiverBoard,
} from "@/lib/waiver-wire/types";
import { OFFENSE_POSITIONS, positionNoun, positionNounMap } from "@/lib/site";
import { WaiverPlayerCard } from "./player-card";

/** How many players a SINGLE-POSITION board shows at once. */
const VISIBLE_ROWS = 24;

/**
 * How many of each position the grouped default view shows.
 *
 * The shape of a real waiver week. Running backs and receivers are where claims
 * are actually made, tight end is thinner, and the two streaming positions get
 * a short list because a reader wants this week's option rather than a ranking
 * of all thirty-two. Every group links through to its own full list.
 */
const GROUP_DEPTH: Record<BoardPosition, number> = {
  RB: 6,
  WR: 6,
  TE: 4,
  QB: 4,
  DEF: 4,
  K: 2,
};

/** The order the groups render in. Where claims are actually made, first. */
const GROUP_ORDER: BoardPosition[] = ["RB", "WR", "TE", "QB", "DEF", "K"];

const GROUP_HEADING: Record<BoardPosition, string> = {
  ...positionNounMap(OFFENSE_POSITIONS, { form: "plural", heading: true }),
  DEF: `Streaming ${positionNoun("DEF", "plural", "short")}`,
};

/**
 * One line per group, and it carries the structural truth exactly once.
 *
 * Replacement level for a skill position in a twelve-team league is better than
 * nearly everything that ever reaches waivers, so almost every player on this
 * board projects below the last startable one at his position. That is worth
 * saying, and it was being said in every single card's sentence, twenty-four
 * times down one page, until it read as wallpaper. Said once per section it is
 * a useful frame for the six cards under it.
 */
const GROUP_HELPER: Record<BoardPosition, string> = {
  RB: "Where most claims are won. Almost nothing on any wire beats a startable back outright, so these are the best of what is genuinely free, led by whoever just inherited carries.",
  WR: "The deepest position on the board and the slowest to show a role change in points, which is why these are ranked on targets before anything else.",
  TE: "Thin by nature. One reliable target share is usually worth more here than the projection suggests, because the position falls away so fast behind it.",
  QB: "Rarely worth a large bid in a one-quarterback league and often worth one in superflex, so read these against your own lineup rather than the number.",
  DEF: "A one-week rental rather than a claim you keep, ranked on this week's matchup and priced accordingly.",
  K: "Stream the matchup. Nothing here is worth real money, and the gap between the first and the last of them is about a point.",
};

const POSITION_WORD: Record<BoardPosition, string> = positionNounMap(OFFENSE_POSITIONS, {
  form: "plural",
  short: ["DEF"],
});

const EMPTY_COPY: Record<BoardEmptyReason, { heading: string; body: string }> = {
  "no-season": {
    heading: "No season to build a board from",
    body: "We hold no weekly projections for any season yet, so there is nothing to rank. This is the state between the end of one season and the first projection release of the next.",
  },
  "no-projections": {
    heading: "This week's projections have not landed",
    body: "We hold the players and we hold who rosters them, but nobody on the list has a projection for this week yet. Projections publish a few days ahead of each slate, so this page fills in on its own. Nothing here is a judgement about the players.",
  },
  "no-roster-rates": {
    heading: "The availability numbers have not been built",
    body: "Every card on this board leads with what share of real leagues already roster a player, and that figure is rebuilt nightly. Without it we would be guessing at who is actually free, so the board waits rather than publishing a list that might be full of players nobody can add.",
  },
  "no-rankings": {
    heading: "No ranked players for this format and source",
    body: "The board starts from the ranked player list for whichever format and source you have selected, and that combination currently has none. Switching the source in the header should bring it back.",
  },
};

function EmptyBoard({ reason }: { reason: BoardEmptyReason }) {
  const copy = EMPTY_COPY[reason];
  return (
    <div className="rounded-modal border border-dashed border-line-accent bg-surface/40 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-cyan" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{copy.heading}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{copy.body}</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            The{" "}
            <Link
              href="/tools/faab"
              className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
            >
              FAAB calculator
            </Link>{" "}
            works from your own connected league and does not depend on this board, so it can
            still price a claim for you in the meantime.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyPosition({ position }: { position: BoardPosition }) {
  return (
    <p className="rounded-card border border-dashed border-line bg-surface/40 p-5 text-sm leading-relaxed text-ink-muted">
      Nothing at this position clears the bar this week. That is a real answer rather than a
      missing one: every {POSITION_WORD[position]} we rank is either already rostered nearly
      everywhere or projects below the last startable one.
    </p>
  );
}

/** The grid every group and the filtered view both render into. */
function CardGrid({
  rows,
  isPast,
}: {
  rows: WaiverBoard["rows"];
  isPast: boolean;
}) {
  return (
    <ol role="list" className="grid gap-3 lg:grid-cols-2">
      {rows.map((row, i) => (
        <WaiverPlayerCard key={row.playerId} row={row} index={i + 1} isPast={isPast} />
      ))}
    </ol>
  );
}

export function WaiverBoardPanel({
  board,
  basePath,
  activePosition,
  headingId,
  heading,
  /** Player ids already shown above the board, so the hero is not repeated. */
  excludePlayerIds = [],
}: {
  board: WaiverBoard;
  /** The route the group links point back at. */
  basePath: string;
  activePosition: BoardPosition | null;
  headingId: string;
  heading: string;
  excludePlayerIds?: string[];
}) {
  const isPast = board.week < board.currentWeek;

  if (board.emptyReason) {
    return (
      <section aria-labelledby={headingId}>
        <h2
          id={headingId}
          className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
        >
          {heading}
        </h2>
        <div className="mt-5">
          <EmptyBoard reason={board.emptyReason} />
        </div>
      </section>
    );
  }

  const counts = new Map<BoardPosition, number>();
  for (const row of board.rows) {
    counts.set(row.position, (counts.get(row.position) ?? 0) + 1);
  }

  // The hero is dropped from the groups rather than from the counts: the count
  // is how many players are worth a claim at that position, which he still is.
  const excluded = new Set(excludePlayerIds);
  const shown = board.rows.filter((r) => !excluded.has(r.playerId));

  if (activePosition) {
    const filtered = shown.filter((r) => r.position === activePosition);
    const visible = filtered.slice(0, VISIBLE_ROWS);
    return (
      <section aria-labelledby={headingId} className="space-y-4">
        <div>
          <h2
            id={headingId}
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            {heading}
          </h2>
          {/* A live region because filtering is a navigation here: the page
              reloads and a reader lands back at the top, so this says what they
              are now looking at without making them hunt for the difference. */}
          <p role="status" className="mt-2 text-sm text-ink-muted">
            Showing {visible.length} of {filtered.length} {POSITION_WORD[activePosition]} worth
            a claim in week {board.week}.
          </p>
        </div>

        {visible.length === 0 ? (
          <EmptyPosition position={activePosition} />
        ) : (
          <Panel
            eyebrow={`Week ${board.week}`}
            title={GROUP_HEADING[activePosition]}
            helper={GROUP_HELPER[activePosition]}
            headingLevel={3}
            action={
              <Link
                href={basePath}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                All positions
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <CardGrid rows={visible} isPast={isPast} />
          </Panel>
        )}
      </section>
    );
  }

  const groups = GROUP_ORDER.filter((position) =>
    shown.some((r) => r.position === position),
  );

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div>
        <h2 id={headingId} className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {heading}
        </h2>
        <p role="status" className="mt-2 text-sm text-ink-muted">
          The best available at each position in week {board.week}, from {board.rows.length}{" "}
          players worth a claim. Every section links to its own full list.
        </p>
      </div>

      {groups.map((position) => {
        const group = shown
          .filter((r) => r.position === position)
          .slice(0, GROUP_DEPTH[position]);
        const total = counts.get(position) ?? 0;
        return (
          <Panel
            key={position}
            eyebrow={`${total} worth a claim`}
            title={GROUP_HEADING[position]}
            helper={GROUP_HELPER[position]}
            headingLevel={3}
            action={
              total > group.length ? (
                <Link
                  href={`${basePath}?pos=${position}`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  All {total}
                  <span className="sr-only"> {POSITION_WORD[position]} worth a claim</span>
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              ) : undefined
            }
          >
            <CardGrid rows={group} isPast={isPast} />
          </Panel>
        );
      })}
    </section>
  );
}
