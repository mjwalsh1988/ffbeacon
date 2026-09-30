/**
 * The waiver board: one panel, a tab per position, a grid of cards in each.
 *
 * GROUPED BY POSITION, AND THAT IS A CORRECTNESS FIX RATHER THAN A LAYOUT
 * PREFERENCE. Ranking every available player against each other on points
 * above replacement produces a board of kickers and defenses: replacement for
 * a wide receiver in a twelve-team league is about the 47th best one, better
 * than anything that reaches waivers, while a defense only has to beat the
 * 12th best and the wire is full of them. Inside a position the same score is
 * exactly right, and that is the only place it is used.
 *
 * ONE OBJECT, NOT SIX. The positions used to be six panels stacked down the
 * page. They are now tabs inside a single board (`BoardTabs`), with the budget
 * converter in the board's own header, so the whole thing reads as one tool
 * rather than a column of boxes. Every card is still rendered on the server;
 * see `board-tabs.tsx` for how the inactive ones stay in the HTML.
 *
 * AN EMPTY BOARD ALWAYS SAYS WHY. "Nobody is worth adding this week" is a
 * claim, and it is never the one we are making. Each `BoardEmptyReason` gets
 * its own sentence naming the specific thing that is missing.
 *
 * Presentational server component.
 */

import Link from "next/link";
import { CircleAlert, LayoutGrid } from "lucide-react";
import type {
  BoardEmptyReason,
  BoardPosition,
  WaiverBoard,
} from "@/lib/waiver-wire/types";
import { OFFENSE_POSITIONS, positionNoun, positionNounMap } from "@/lib/site";
import { POSITION_HEX, WaiverPlayerCard } from "./player-card";
import { BoardTabs, RevealGrid, type BoardTab } from "./board-tabs";
import { BudgetConverter } from "./budget-context";

/** Cards a position shows before "Show more": three rows of two on a phone. */
const INITIAL_CARDS = 6;

/** The order the tabs run in. Where claims are actually made, first. */
const GROUP_ORDER: BoardPosition[] = ["RB", "WR", "TE", "QB", "DEF", "K"];

const GROUP_HEADING: Record<BoardPosition, string> = {
  ...positionNounMap(OFFENSE_POSITIONS, { form: "plural", heading: true }),
  DEF: `Streaming ${positionNoun("DEF", "plural", "short")}`,
};

/** One line per position, said once above its grid rather than in every card. */
const GROUP_HELPER: Record<BoardPosition, string> = {
  RB: "Where most claims are won. Almost nothing on a wire beats a startable back outright, so these are the best of what is genuinely free, led by whoever just inherited carries.",
  WR: "The deepest position and the slowest to show a role change in points, which is why these lean on targets before anything else.",
  TE: "Thin by nature. One reliable target share is usually worth more here than the projection suggests.",
  QB: "Rarely worth a large bid in a one-quarterback league and often worth one in superflex.",
  DEF: "A one-week rental rather than a claim you keep, ranked on this week's matchup.",
  K: "Stream the matchup. The gap between the first and the last of them is about a point.",
};

/** The tab's full label: short enough to sit on one line. */
const TAB_LABEL: Record<BoardPosition, string> = {
  ...positionNounMap(OFFENSE_POSITIONS, { form: "plural", heading: true }),
  DEF: "Defenses",
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
    <div className="rounded-2xl border border-dashed border-line-accent bg-surface/40 p-6 sm:p-8">
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

/**
 * Two abreast from the smallest phone up; three only at 2xl, where the main
 * column still has room beside the site sidebar and the rail.
 */
const GRID_CLASS = "grid grid-cols-2 gap-2 sm:gap-3 2xl:grid-cols-3";

export function WaiverBoardPanel({
  board,
  activePosition,
  headingId,
  heading,
  /** Player ids already shown above the board, so the hero is not repeated. */
  excludePlayerIds = [],
}: {
  board: WaiverBoard;
  /** The page's own path. Kept for callers; the tabs write `?pos=` in place. */
  basePath: string;
  /** The position the page opened on (`?pos=`), or null for the default. */
  activePosition: BoardPosition | null;
  headingId: string;
  heading: string;
  excludePlayerIds?: string[];
}) {
  const isPast = board.week < board.currentWeek;

  if (board.emptyReason) {
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {heading}
        </h2>
        <div className="mt-5">
          <EmptyBoard reason={board.emptyReason} />
        </div>
      </section>
    );
  }

  const excluded = new Set(excludePlayerIds);
  const counts = new Map<BoardPosition, number>();
  for (const row of board.rows) {
    counts.set(row.position, (counts.get(row.position) ?? 0) + 1);
  }

  const tabs: BoardTab[] = GROUP_ORDER.filter((position) =>
    board.rows.some((r) => r.position === position && !excluded.has(r.playerId)),
  ).map((position) => {
    const rows = board.rows
      .filter((r) => r.position === position && !excluded.has(r.playerId));
    // The count is how many are worth a claim, which the hero still is.
    const total = counts.get(position) ?? 0;
    const cards = rows.map((row, i) => (
      <WaiverPlayerCard
        key={row.playerId}
        row={row}
        index={i + 1}
        isPast={isPast}
        claimWeeks={board.assumptions.claimWeeks}
      />
    ));
    return {
      key: position,
      short: position,
      label: TAB_LABEL[position],
      count: total,
      hue: POSITION_HEX[position],
      content: (
        <>
          <div className="mb-3 flex flex-col gap-1 px-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 sm:px-0">
            <h3 className="text-lg font-bold tracking-tight text-ink">
              {GROUP_HEADING[position]}
              <span className="ml-2 font-mono text-sm font-semibold text-ink-subtle">
                {total}
                <span className="sr-only"> worth a claim in week {board.week}</span>
              </span>
            </h3>
            <p className="text-xs leading-relaxed text-ink-muted sm:max-w-md sm:text-right">
              {GROUP_HELPER[position]}
            </p>
          </div>
          <RevealGrid
            first={cards.slice(0, INITIAL_CARDS)}
            rest={cards.slice(INITIAL_CARDS)}
            restCount={Math.max(0, cards.length - INITIAL_CARDS)}
            restStart={INITIAL_CARDS + 1}
            moreLabel={POSITION_WORD[position]}
            className={GRID_CLASS}
          />
        </>
      ),
    };
  });

  const initialKey = activePosition ?? tabs[0]?.key ?? "RB";

  return (
    <section
      aria-labelledby={headingId}
      className="relative overflow-hidden rounded-3xl border border-line bg-surface/40 p-2.5 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full opacity-20 blur-3xl"
        style={{ background: "#A855F7" }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-24 h-64 w-64 rounded-full opacity-10 blur-3xl"
        style={{ background: "#22D3EE" }}
      />

      <div className="relative px-1.5 pt-1.5 sm:px-0 sm:pt-0">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          <LayoutGrid aria-hidden="true" className="h-3.5 w-3.5" />
          Week {board.week} board
        </p>
        <h2
          id={headingId}
          className="mt-1 scroll-mt-24 text-2xl font-bold tracking-tight text-ink sm:text-3xl"
        >
          {heading}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          {board.rows.length} players worth a claim, ranked within each position. Every bid is a
          share of your season budget.
        </p>
      </div>

      <div className="relative mt-4">
        <BudgetConverter />
      </div>

      <div className="relative mt-4">
        <BoardTabs
          tabs={tabs}
          initialKey={initialKey}
          label={`Week ${board.week} waiver wire pickups by position`}
        />
      </div>
    </section>
  );
}
