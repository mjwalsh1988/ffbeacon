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
 * EVERY FIGURE IS ONE TEXT NODE
 *   Read the same by eye and by ear: "102.4 to 98.1", "None", "Not ranked".
 *   No aria-hidden copy beside an sr-only copy, and no dash for a null.
 *
 * ONE HERO PER SECTION
 *   Started (or the record in best ball), waiver points from starts, trade
 *   net, and points against the room, per the section pattern in
 *   docs/completed/team-blueprint/team-blueprint-plan.md section 10.
 */

import type { LedgerViewTeam } from "@/lib/league-manager-ledger-data";
import {
  games,
  pct,
  pts,
  record,
  signedPts,
  weeks as weekCount,
  type LedgerWords,
} from "./format";

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

const HERO = "font-mono font-black tabular-nums leading-none text-4xl sm:text-5xl";

function Figure({
  label,
  value,
  hint,
  hero = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** The one figure a section leads with. Spans the row so it reads first. */
  hero?: boolean;
}) {
  // The hint lives INSIDE the dd, not in a sibling paragraph. `dl > div` may
  // hold only dt and dd, and a <p> there is both invalid and detached from the
  // definition, which matters because the hint is usually the unit: "Started /
  // 84%" means nothing without "of the points their own roster could have
  // scored" attached to it.
  return (
    <div
      className={`rounded-card border bg-surface px-3 py-2 ${
        hero ? "col-span-2 border-line-accent sm:col-span-4" : "border-line"
      }`}
    >
      <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd
        className={
          hero
            ? `mt-1 ${HERO} text-ink`
            : "font-mono text-base font-bold tabular-nums text-ink"
        }
      >
        <span className="block">{value}</span>
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
  words,
  headingLevel = 4,
}: {
  team: LedgerViewTeam;
  teamCount: number;
  /** League-kind wording: chopped, best ball, median game. */
  words: LedgerWords;
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
  const lineups = words.gradesLineups;
  const weeksThatMattered = team.weeks.filter(
    (w) => w.outcome === "loss" && w.bestLineupOutcome === "win",
  );
  const hasMedian = team.weeks.some((w) => w.medianOutcome !== undefined);
  const outcomeWord = (outcome: "win" | "loss" | "tie" | null | undefined): string =>
    outcome === "win" ? words.win : outcome === "loss" ? words.loss : outcome === "tie" ? "Tied" : "No game";

  return (
    <div className="space-y-6 py-2">
      {/* ---------------- lineup ---------------- */}
      <section>
        <SectionHeading as={H}>Lineups</SectionHeading>
        {lineups ? null : (
          <p className="mb-2 text-xs leading-relaxed text-ink-muted">
            Best ball sets the lineup itself, so there is no lineup to grade.
          </p>
        )}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {lineups ? (
            <>
              <Figure
                hero
                label="Started"
                value={pct(team.efficiency)}
                hint="the share of their roster's points they started"
              />
              <Figure
                label="Left on bench"
                value={pts(team.pointsLeft)}
                hint={
                  team.pointsLeftPerWeek === null
                    ? "points their best lineup would have added"
                    : `${pts(team.pointsLeftPerWeek)} a week`
                }
              />
            </>
          ) : null}
          <Figure
            hero={!lineups}
            label={words.recordLabel}
            value={record(team.actualRecord)}
            hint={words.recordHint}
          />
          {lineups ? (
            <>
              <Figure
                label={words.bestRecordLabel}
                value={record(team.bestLineupRecord)}
                hint={words.chopped ? "same cut lines, best lineup" : "same opponents, same scores"}
              />
              {/* THE POINTS RANK. The table drops this column below md, and
                  this component is what the mobile sheet renders, so without it
                  the most useful comparison on the page is unreachable on a
                  phone. Decision rank is the manager, points rank is the
                  roster. */}
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
            </>
          ) : null}
          <Figure
            label="Points rank"
            value={
              team.scoringRank === null
                ? "Not ranked"
                : `${team.scoringRank} of ${teamCount}`
            }
            hint="regular season points, which is the roster"
          />
        </dl>

        {lineups ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            {team.winsLeftOnBench > 0
              ? words.chopped
                ? `Their bench would have survived ${weekCount(team.winsLeftOnBench)} below the cut.`
                : `They lost ${games(team.winsLeftOnBench)} their own bench would have won.`
              : words.chopped
                ? "No week below the cut was survivable from their bench."
                : "No loss was winnable from their bench."}
          </p>
        ) : null}

        {lineups && team.weeksWithUngradedSlots > 0 ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Some slots here cannot be graded, so these cover the rest of the lineup.
          </p>
        ) : null}

        {team.weeks.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {`Week by week for ${team.teamName}. Columns: week, result, ${
                  words.chopped ? "score and the cut line" : "both scores"
                }${lineups ? ", points left on the bench, and the biggest swap that was available" : ""}.`}
              </caption>
              <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="px-2 py-2">
                    Week
                  </th>
                  <th scope="col" className="px-2 py-2">
                    Result
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    {words.chopped ? "Score, cut line" : "Score"}
                  </th>
                  {lineups ? (
                    <>
                      <th scope="col" className="px-2 py-2 text-right">
                        Left
                      </th>
                      <th scope="col" className="px-2 py-2">
                        Biggest swap available
                      </th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {team.weeks.map((week) => {
                  const flipped =
                    lineups && week.outcome === "loss" && week.bestLineupOutcome === "win";
                  const resultParts = [outcomeWord(week.outcome)];
                  if (week.medianOutcome !== undefined) {
                    resultParts.push(`${outcomeWord(week.medianOutcome).toLowerCase()} vs median`);
                  }
                  if (week.playoff) resultParts.push("playoffs");
                  return (
                    <tr key={week.week} className={flipped ? "bg-brand-purple/5" : undefined}>
                      <th
                        scope="row"
                        className="px-2 py-2 text-left font-mono text-xs font-normal tabular-nums text-ink-muted"
                      >
                        {week.week}
                      </th>
                      <td className="px-2 py-2 text-xs">
                        <span className={flipped ? "font-semibold text-brand-purple" : "text-ink"}>
                          {flipped
                            ? `${resultParts.join(", ")}, bench had the ${words.chopped ? "save" : "win"}`
                            : resultParts.join(", ")}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular-nums text-ink-muted">
                        {week.opponentPoints === null
                          ? pts(week.officialPoints)
                          : `${pts(week.officialPoints)} to ${pts(week.opponentPoints)}`}
                      </td>
                      {lineups ? (
                        <>
                          <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-ink-muted">
                            {week.pointsLeft > 0 ? pts(week.pointsLeft) : "None"}
                          </td>
                          <td className="px-2 py-2 text-xs text-ink-muted">
                            {week.biggestMiss
                              ? `${week.biggestMiss.inName} (${pts(week.biggestMiss.inPoints)}) over ${week.biggestMiss.outName} (${pts(week.biggestMiss.outPoints)}), ${signedPts(week.biggestMiss.gain)}`
                              : week.pointsLeft > 0
                                ? "No single swap"
                                : "Best lineup available"}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {lineups && weeksThatMattered.length > 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                Each swap is priced against the lineup as it stood, so swaps do not add up.
              </p>
            ) : null}
            {hasMedian ? (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                This league also plays the league median each regular season week.
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
              <Figure
                hero
                label="Points from starts"
                value={pts(team.waiverPointsStarted)}
                hint="scored in this lineup, from the claim to the next drop"
              />
              <Figure label="Moves" value={String(team.waiverMoves)} />
              <Figure
                label="Started at least once"
                value={`${team.waiverHits} of ${team.waiverMoves}`}
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
                      {`${pts(move.pointsStarted)} started in ${weekCount(move.weeksStarted)}`}
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
              <Figure
                hero
                label="Net"
                value={signedPts(team.tradeNet)}
                hint="started points in, minus started points out"
              />
              <Figure label="Trades" value={String(team.tradeCount)} />
              <Figure
                label="Points in"
                value={pts(team.tradePointsIn)}
                hint="started here after arriving"
              />
              <Figure
                label="Points out"
                value={pts(team.tradePointsOut)}
                hint="started elsewhere after leaving"
              />
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
                        {`${signedPts(move.net)} net`}
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
              <Figure
                hero
                label="Against the room"
                value={signedPts(team.draftAboveBaseline)}
                hint="points against the average pick in those rounds"
              />
              <Figure label="Picks" value={String(team.draftPicks)} />
              <Figure
                label="Points drafted"
                value={pts(team.draftPoints)}
                hint="what those picks scored here"
              />
              <Figure
                label="Rank"
                value={team.draftRank === null ? "Not ranked" : `${team.draftRank} of ${teamCount}`}
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
