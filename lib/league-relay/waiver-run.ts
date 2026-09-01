/**
 * Grouping wire moves into RUNS.
 *
 * Sleeper processes a league's waiver claims all at once, at a time the league
 * set. Eleven managers wake up to eleven results, and the relay used to treat
 * those as eleven unrelated events and write eleven separate reviews into the
 * channel. That is technically accurate and completely unreadable: the channel
 * becomes a wall, and the one claim worth reading about is buried in the middle
 * of it.
 *
 * So moves are grouped by when they actually happened, and the SIZE of the
 * group decides the shape of the coverage:
 *
 *   A SMALL RUN gets the full treatment, one review per claim. Three claims is
 *   three messages, and each one can afford to say what the player projects for
 *   and what the bid was worth.
 *
 *   A BIG RUN gets ONE message: an intro, every single move listed, and a
 *   closing line about the day's standout. Nothing is dropped from the list.
 *   The whole point of the digest is that a reader can see all eleven without
 *   scrolling past eleven embeds.
 *
 * WHY TIME AND NOT A BATCH ID. Sleeper does not give waiver results a batch id.
 * What it does give is `created_at_sleeper`, and every claim in one processing
 * run lands within seconds of the others, so a gap in the timeline is a real
 * boundary between runs rather than an inferred one.
 *
 * WHY WAIVERS AND FREE AGENTS DO NOT SHARE A RUN. A waiver run is a scheduled
 * event that happened to everybody at once. A free agent pickup is one person
 * clicking a button. Putting them in one group would title a digest "waivers
 * processed" over a list that is half somebody browsing the wire at lunchtime.
 * They group by the same rule, separately, and a burst of free agent moves gets
 * its own digest with its own heading.
 *
 * Pure and clock-free: it reasons only about the timestamps it is handed.
 */

/** What the grouper needs. Deliberately the minimum, so it is easy to test. */
export interface RunnableMove {
  /** league_transactions.sleeper_transaction_id */
  sleeperTransactionId: string;
  /** Sleeper's own word for it. */
  type: "waiver" | "free_agent";
  /** ISO. Null sorts to the end and never joins a run. */
  createdAtSleeper: string | null;
  week: number | null;
}

/**
 * How far apart two moves can be and still belong to the same run.
 *
 * Sleeper writes a whole waiver run within a second or two, so this could be
 * much tighter. Ten minutes is deliberately generous: the cost of splitting one
 * real run into two is two digests where there should be one, and the cost of
 * merging two genuinely separate bursts is a digest that spans a slightly wider
 * window than it says. The second is much easier to live with.
 */
export const RUN_GAP_MS = 10 * 60_000;

export interface MoveRun<T extends RunnableMove> {
  type: "waiver" | "free_agent";
  /** Every move in this run, oldest first. */
  moves: T[];
  /** The week these moves belong to. Null when Sleeper did not record one. */
  week: number | null;
  /**
   * The stable key this run is recorded under, when it is digested.
   *
   * The EARLIEST transaction id in the run. Not a hash of every id in it: a
   * late-arriving claim would change that hash, and the digest already sent
   * would then look unsent and go out a second time. The earliest id cannot
   * change once a run has started, because a move earlier than the earliest one
   * would have been picked up first.
   */
  anchorId: string;
}

function timeOf(move: RunnableMove): number {
  if (!move.createdAtSleeper) return Number.POSITIVE_INFINITY;
  const t = new Date(move.createdAtSleeper).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Split a batch of moves into runs.
 *
 * Input order does not matter; the output is sorted and deterministic, so the
 * admin preview and the live tick group an identical batch identically.
 *
 * A move with no usable timestamp is its own run of one. That is the honest
 * answer: without a time there is nothing to say it belongs with anything else,
 * and guessing would put somebody's claim in a digest about a different
 * morning.
 */
export function groupIntoRuns<T extends RunnableMove>(moves: T[]): MoveRun<T>[] {
  const runs: MoveRun<T>[] = [];

  for (const type of ["waiver", "free_agent"] as const) {
    const ofType = moves
      .filter((m) => m.type === type)
      .sort(
        (a, b) =>
          timeOf(a) - timeOf(b) ||
          a.sleeperTransactionId.localeCompare(b.sleeperTransactionId),
      );

    let current: T[] = [];
    let previousTime = Number.NEGATIVE_INFINITY;

    const flush = () => {
      if (current.length === 0) return;
      runs.push({
        type,
        moves: current,
        // The week the run belongs to, from the first move that names one. A
        // null week is common in the preseason and is carried through rather
        // than defaulted to 1, which would file a July pickup under week 1.
        week: current.find((m) => m.week !== null)?.week ?? null,
        anchorId: current[0].sleeperTransactionId,
      });
      current = [];
    };

    for (const move of ofType) {
      const t = timeOf(move);
      const undated = !Number.isFinite(t);
      // An undated move joins nothing and starts nothing.
      if (undated) {
        flush();
        runs.push({
          type,
          moves: [move],
          week: move.week,
          anchorId: move.sleeperTransactionId,
        });
        previousTime = Number.NEGATIVE_INFINITY;
        continue;
      }
      if (current.length > 0 && t - previousTime > RUN_GAP_MS) flush();
      current.push(move);
      previousTime = t;
    }
    flush();
  }

  // Oldest run first, so a capped tick covers the earliest news and leaves the
  // most recent for the next one, matching how the transaction stream reads.
  return runs.sort(
    (a, b) => timeOf(a.moves[0]) - timeOf(b.moves[0]) || a.anchorId.localeCompare(b.anchorId),
  );
}

/** The ledger key a digested run is recorded under. */
export function runDigestKey(leagueId: string, run: MoveRun<RunnableMove>): string {
  return `${run.type}-digest:${leagueId}:${run.anchorId}`;
}

/**
 * Does this run get one message or one per move?
 *
 * At or under the threshold every claim is worth its own review. Above it, the
 * channel gets one digest. The threshold is a setting because the right answer
 * depends on how busy a league is: a two-manager dynasty startup and a
 * thirty-two team IDP league do not want the same cutoff.
 */
export function runIsDigest(run: MoveRun<RunnableMove>, threshold: number): boolean {
  return run.moves.length > Math.max(1, threshold);
}
