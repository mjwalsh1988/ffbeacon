"use client";

/**
 * One manager's four ledgers, in full.
 *
 * Rendered in two places and written once: inline under an expanded desktop
 * row, and inside the mobile bottom sheet. That is what keeps the promise in
 * CLAUDE.md that no data is hidden at any breakpoint. Every column the table
 * drops at a narrow width is here, and this is reachable at every width.
 *
 * WHY THE WEEK TABLE LEADS WITH THE RESULT AND NOT THE DEFICIT
 *   A manager reading their own season is looking for the weeks it mattered.
 *   Ten points left on the bench in a 40-point win is trivia; four points left
 *   in a two-point loss is the season. So the result column is first, the weeks
 *   where the bench held the win are marked, and the deficit is read against
 *   that rather than on its own.
 *
 * WHY EVERY NUMBER IS ALSO A SENTENCE
 *   The tables are drawn for the eye. A screen reader hitting a row of six
 *   numeric cells hears six numbers and no meaning, so the weeks that changed a
 *   result carry an sr-only sentence naming the swap, the points, and the
 *   outcome. The sentence and the cells carry the same figures; neither is a
 *   summary of the other.
 */

import type { LedgerViewTeam } from "@/lib/league-manager-ledger-data";
import { games, pct, pts, record, signedPts } from "./format";

/**
 * A section title at whichever level the caller sits at.
 *
 * The level is a prop rather than a fixed h4 because this component renders in
 * two places at two different depths: inside the bottom sheet under its own h3,
 * and inline under an expanded table row. A fixed h4 skipped a level on the
 * inline path, and a skipped level is what a screen reader user hears as a
 * missing section.
 */
function SectionHeading({
  as: Tag,
  children,
}: {
  as: "h3" | "h4" | "h5" | "h6";
  children: React.ReactNode;
}) {
  return (
    <Tag className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
      {children}
    </Tag>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  // The hint lives INSIDE the dd, not in a sibling paragraph. `dl > div` may
  // hold only dt and dd, and a <p> there is both invalid and detached from the
  // definition, which matters because the hint is usually the unit: "Started /
  // 84%" means nothing without "of the points their own roster could have
  // scored" attached to it.
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="font-mono text-base font-bold tabular-nums text-ink">
        {value}
        {hint ? (
          <span className="mt-0.5 block font-sans text-[11px] font-normal leading-snug text-ink-muted">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/** An honest empty state for a ledger with nothing in it. */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-ink-muted">{children}</p>;
}

export function LedgerDetail({
  team,
  teamCount,
  headingLevel = 4,
}: {
  team: LedgerViewTeam;
  teamCount: number;
  /**
   * 3 under the bottom sheet's own h3, 4 when expanded inline under a Panel's
   * h2 with an h3 in between. The two entry points sit at different depths and
   * a fixed level skipped one of them.
   */
  headingLevel?: 3 | 4 | 5;
}) {
  const LEVELS = { 3: "h3", 4: "h4", 5: "h5" } as const;
  const SUB_LEVELS = { 3: "h4", 4: "h5", 5: "h6" } as const;
  const H = LEVELS[headingLevel];
  const HSub = SUB_LEVELS[headingLevel];
  const weeksThatMattered = team.weeks.filter(
    (w) => w.outcome === "loss" && w.bestLineupOutcome === "win",
  );

  return (
    <div className="space-y-6 py-2">
      {/* ---------------- lineup ---------------- */}
      <section>
        <SectionHeading as={H}>Lineups</SectionHeading>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure
            label="Started"
            value={pct(team.efficiency)}
            hint="of their own roster's points"
          />
          <Figure
            label="Left on bench"
            value={pts(team.pointsLeft)}
            hint={
              team.pointsLeftPerWeek === null
                ? undefined
                : `${pts(team.pointsLeftPerWeek)} per week`
            }
          />
          <Figure label="Actual record" value={record(team.actualRecord)} />
          <Figure
            label="Best lineup"
            value={record(team.bestLineupRecord)}
            hint="same opponents, same scores"
          />
          {/* THE POINTS RANK. The table drops this column below md, and this
              component is what the mobile sheet renders, so without it the
              single most useful comparison on the page is unreachable on a
              phone. Decision rank is the manager, points rank is the roster,
              and the whole point is reading them next to each other. */}
          <Figure
            label="Decisions rank"
            value={
              team.efficiencyRank === null
                ? "Not ranked"
                : `${team.efficiencyRank} of ${teamCount}`
            }
            hint={
              team.efficiencyRank === null
                ? "too few finished weeks to rank"
                : "on points started"
            }
          />
          <Figure
            label="Points rank"
            value={
              team.scoringRank === null
                ? "Not ranked"
                : `${team.scoringRank} of ${teamCount}`
            }
            hint="on points scored, which is the roster"
          />
        </dl>

        {team.winsLeftOnBench > 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            They lost {games(team.winsLeftOnBench)} their own bench would have won.
          </p>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            No loss was winnable from their bench.
          </p>
        )}

        {team.weeksWithUngradedSlots > 0 ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            This league starts slots we cannot grade, so these cover the rest of the
            lineup only. Records and scores use the league&apos;s own totals.
          </p>
        ) : null}

        {team.weeks.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Week by week for {team.teamName}, each row headed by its week. Columns:
                result, both scores, points left on the bench, and the biggest swap that was
                available. Weeks marked &quot;bench had the win&quot; are losses the best
                lineup would have won.
              </caption>
              <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="px-2 py-2">
                    Wk
                  </th>
                  <th scope="col" className="px-2 py-2">
                    Result
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    Score
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    Left
                  </th>
                  <th scope="col" className="px-2 py-2">
                    Biggest swap available
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {team.weeks.map((week) => {
                  const flipped = week.outcome === "loss" && week.bestLineupOutcome === "win";
                  const resultWord =
                    week.outcome === null
                      ? "No game"
                      : week.outcome === "win"
                        ? "Won"
                        : week.outcome === "tie"
                          ? "Tied"
                          : "Lost";
                  return (
                    <tr key={week.week} className={flipped ? "bg-brand-purple/5" : undefined}>
                      {/* The row header. Without it, reading the "Left" column
                          on its own gives a column of numbers with no week
                          attached to any of them. */}
                      <th
                        scope="row"
                        className="px-2 py-2 text-left font-mono text-xs font-normal tabular-nums text-ink-muted"
                      >
                        <span aria-hidden="true">{week.week}</span>
                        <span className="sr-only">Week {week.week}</span>
                      </th>
                      <td className="px-2 py-2 text-xs">
                        <span className={flipped ? "font-semibold text-brand-purple" : "text-ink"}>
                          {resultWord}
                        </span>
                        {flipped ? (
                          <span className="ml-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-brand-purple">
                            {/* The comma is spoken and the visual gap is not,
                                so without it this reads as "Lost bench had the
                                win" in one breath. */}
                            <span className="sr-only">, </span>bench had the win
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular-nums text-ink-muted">
                        {/* The hyphen between the two scores is not spoken, so
                            without the sr-only words this cell announces as two
                            bare numbers with no indication of whose is whose.
                            It has to be here rather than in the swap sentence,
                            because a week with a perfect lineup has no swap
                            sentence and still has a score. */}
                        {pts(week.officialPoints)}
                        {week.opponentPoints === null ? null : (
                          <>
                            <span aria-hidden="true"> - </span>
                            <span className="sr-only"> to </span>
                            {pts(week.opponentPoints)}
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-ink-muted">
                        {week.pointsLeft > 0 ? (
                          pts(week.pointsLeft)
                        ) : (
                          <>
                            {/* A dash is swallowed at the default punctuation
                                level, so this cell would announce as empty.
                                Here it means "nothing left", which is a real
                                answer rather than an unmeasured one. */}
                            <span aria-hidden="true">--</span>
                            <span className="sr-only">None</span>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs text-ink-muted">
                        {week.biggestMiss ? (
                          <>
                            <span aria-hidden="true">
                              {week.biggestMiss.inName} over {week.biggestMiss.outName},{" "}
                              {signedPts(week.biggestMiss.gain)}
                            </span>
                            {/* The swap, and only the swap. This used to open
                                by restating the week, the result and the score,
                                all three of which the reader has just heard from
                                their own cells, and reading the column on its
                                own then announced sentences that began "Lost
                                week 5" under a heading that says "Biggest swap
                                available". */}
                            <span className="sr-only">
                              {week.biggestMiss.inName} at{" "}
                              {pts(week.biggestMiss.inPoints)} points in place of{" "}
                              {week.biggestMiss.outName} at {pts(week.biggestMiss.outPoints)},
                              worth {pts(week.biggestMiss.gain)} points.
                              {flipped
                                ? " That alone would have won this game."
                                : ""}
                            </span>
                          </>
                        ) : (
                          <span>{week.pointsLeft > 0 ? "--" : "Best lineup available"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {weeksThatMattered.length > 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                Each swap is priced against the lineup as it stood, so they do not add up
                to the week&apos;s total.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ---------------- waivers ---------------- */}
      <section>
        <SectionHeading as={H}>Waivers</SectionHeading>
        {team.waiverMoves === 0 ? (
          <Nothing>No claims or pickups this season.</Nothing>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Moves" value={String(team.waiverMoves)} />
              <Figure
                label="Started at least once"
                value={`${team.waiverHits} of ${team.waiverMoves}`}
              />
              <Figure
                label="Points from starts"
                value={pts(team.waiverPointsStarted)}
                hint="scored in this lineup after the claim"
              />
              <Figure
                label={team.waiverFaabSpent === null ? "Budget" : "FAAB spent"}
                value={
                  team.waiverFaabSpent === null ? "No budget" : `$${pts(team.waiverFaabSpent)}`
                }
                hint={
                  team.waiverPointsPerDollar === null
                    ? undefined
                    : `${pts(team.waiverPointsPerDollar)} points per dollar`
                }
              />
            </dl>
            {team.moves.waivers.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {team.moves.waivers.map((move) => (
                  <li
                    key={`${move.transactionId}-${move.playerId}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line pb-1.5 text-xs last:border-0"
                  >
                    <span className="text-ink">
                      {move.name}
                      {move.position ? (
                        <span className="ml-1 text-ink-subtle">{move.position}</span>
                      ) : null}
                      <span className="ml-2 text-ink-subtle">week {move.week}</span>
                      {move.bid !== null ? (
                        <span className="ml-2 text-ink-subtle">${move.bid}</span>
                      ) : null}
                    </span>
                    <span className="font-mono tabular-nums text-ink-muted">
                      {pts(move.pointsStarted)}
                      <span aria-hidden="true"> started</span>
                      <span className="sr-only">
                        {" "}
                        points started, across {move.weeksStarted} week
                        {move.weeksStarted === 1 ? "" : "s"} in the lineup
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      {/* ---------------- trades ---------------- */}
      <section>
        <SectionHeading as={H}>Trades</SectionHeading>
        {team.tradeCount === 0 ? (
          <Nothing>No trades this season.</Nothing>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Trades" value={String(team.tradeCount)} />
              <Figure
                label="Points in"
                value={pts(team.tradePointsIn)}
                hint="scored here after arriving"
              />
              <Figure
                label="Points out"
                value={pts(team.tradePointsOut)}
                hint="scored elsewhere after leaving"
              />
              <Figure label="Net" value={signedPts(team.tradeNet)} />
            </dl>
            {team.tradeAnyPicks ? (
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                At least one of these trades moved draft picks. Picks score no points, so
                they are not in these totals.
              </p>
            ) : null}
            {team.moves.trades.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {team.moves.trades.map((move) => (
                  <li
                    key={move.transactionId}
                    className="border-b border-line pb-2 text-xs last:border-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-ink-subtle">Week {move.week}</span>
                      <span className="font-mono font-semibold tabular-nums text-ink">
                        {signedPts(move.net)}
                        <span className="sr-only"> points net</span>
                      </span>
                    </div>
                    <p className="mt-0.5 leading-relaxed text-ink-muted">
                      Got {move.receivedNames.length > 0 ? move.receivedNames.join(", ") : "picks"}{" "}
                      ({pts(move.pointsIn)}). Sent{" "}
                      {move.sentNames.length > 0 ? move.sentNames.join(", ") : "picks"} (
                      {pts(move.pointsOut)}).
                      {move.involvedPicks ? " Draft picks also changed hands." : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      {/* ---------------- draft ---------------- */}
      <section>
        <SectionHeading as={H}>Draft</SectionHeading>
        {team.draftPicks === 0 ? (
          <Nothing>
            No draft stored for this season, so there is nothing to grade.
          </Nothing>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Picks" value={String(team.draftPicks)} />
              <Figure
                label="Points drafted"
                value={pts(team.draftPoints)}
                hint="what those picks scored here"
              />
              <Figure
                label="Against the room"
                value={signedPts(team.draftAboveBaseline)}
                hint="vs the average pick in those rounds"
              />
              <Figure
                label="Rank"
                value={team.draftRank === null ? "--" : `${team.draftRank} of ${teamCount}`}
              />
            </dl>
            {team.moves.draftBest.length > 0 ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <SectionHeading as={HSub}>Best picks</SectionHeading>
                  <DraftList moves={team.moves.draftBest} />
                </div>
                {team.moves.draftWorst.length > 0 ? (
                  <div>
                    <SectionHeading as={HSub}>Weakest picks</SectionHeading>
                    <DraftList moves={team.moves.draftWorst} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function DraftList({ moves }: { moves: LedgerViewTeam["moves"]["draftBest"] }) {
  return (
    <ul className="space-y-1.5">
      {moves.map((move) => (
        <li
          key={`${move.pickNo}-${move.playerId}`}
          className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line pb-1.5 text-xs last:border-0"
        >
          <span className="text-ink">
            <span className="text-ink-subtle">
              {move.round}.{String(move.pickNo).padStart(2, "0")}
            </span>{" "}
            {move.name}
            {move.position ? <span className="ml-1 text-ink-subtle">{move.position}</span> : null}
          </span>
          <span className="font-mono tabular-nums text-ink-muted">
            {signedPts(move.aboveBaseline)}
            <span className="sr-only">
              {" "}
              points against the round {move.round} average of {pts(move.roundBaseline)}; he
              scored {pts(move.points)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
