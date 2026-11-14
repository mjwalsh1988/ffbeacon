/**
 * Projected final standings, ordered by expected wins rather than by Power
 * Pulse. The two orders differ when a strong roster draws a hard schedule, and
 * that difference is the point: this is the table that answers "where do I
 * actually finish".
 *
 * The playoff cut line is drawn from the league's own settings.playoff_teams, so
 * a four-team or eight-team league gets the right line.
 *
 * A chopped (guillotine) league has no seeds, no cut line and no final
 * standings in this sense: one team leaves every week until one is left. The
 * same table is then ordered by the chance of being that team, and the two
 * columns that would carry a record and playoff odds carry the chance of going
 * out this week and the chance of outlasting everyone instead. The cut line is
 * not drawn faintly for it, it is not drawn at all.
 */

import Link from "next/link";
import { ownerLine } from "@/lib/team-label";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { PulseTeam } from "@/lib/league-power-pulse-data";
import { compareProjectedFinish } from "@/lib/power-pulse/projected-order";
import {
  pctOdds,
  playedRecordText,
  playoffFigure,
  projectedRecordText,
  titleFigure,
} from "./odds-format";

export function ProjectedStandings({
  teams,
  playoffTeams,
}: {
  teams: PulseTeam[];
  playoffTeams: number;
}) {
  // Shared comparator, because the league list quotes this same finish on every
  // row and the two must not drift. See lib/power-pulse/projected-order.ts.
  // The roster id goes in so a dead-level tie settles the same way on both.
  const chopped = teams.some((t) => t.chopped);
  // Before the playoffs this is a projection. Once the bracket is set the seeds
  // are real, and after the title game the order is the final result.
  const phase = teams.find((t) => t.playoff)?.playoff?.phase ?? null;
  const regular = phase === null || phase === "regular";
  const byProjection = (a: PulseTeam, b: PulseTeam) =>
    compareProjectedFinish(
      {
        projectedWins: a.projectedWins,
        expectedPointsPerWeek: a.expectedPointsPerWeek,
        rosterId: a.rosterRowId,
      },
      {
        projectedWins: b.projectedWins,
        expectedPointsPerWeek: b.expectedPointsPerWeek,
        rosterId: b.rosterRowId,
      },
    );
  const ordered = !chopped && phase === "complete"
    ? [...teams].sort(
        (a, b) =>
          (a.playoff?.finalPlace ?? Number.MAX_SAFE_INTEGER) -
            (b.playoff?.finalPlace ?? Number.MAX_SAFE_INTEGER) || byProjection(a, b),
      )
    : !chopped && phase === "playoffs"
      ? [...teams].sort(
          (a, b) =>
            (a.playoff?.seed ?? Number.MAX_SAFE_INTEGER) -
              (b.playoff?.seed ?? Number.MAX_SAFE_INTEGER) || byProjection(a, b),
        )
      : chopped
    ? [...teams].sort(
        (a, b) =>
          (b.surviveAllOdds ?? 0) - (a.surviveAllOdds ?? 0) ||
          (a.chopOddsThisWeek ?? 1) - (b.chopOddsThisWeek ?? 1) ||
          (b.expectedPointsPerWeek ?? 0) - (a.expectedPointsPerWeek ?? 0) ||
          a.rosterRowId.localeCompare(b.rosterRowId),
      )
    : [...teams].sort(byProjection);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {chopped
            ? "Projected survival order, ordered by the chance of being the last team standing. There are no playoffs in a chopped league: the lowest score each week is eliminated. Columns: position, team, chance of being chopped this week, chance of being last standing, and points per week."
            : phase === "complete"
              ? "Final order of the season, from the title game and the consolation games. Columns: final place, team, regular season record, seed, result, and points per week."
              : phase === "playoffs"
                ? `The playoff field by seed. Columns: seed, team, regular season record, seed status, bracket odds, and points per week.`
                : `Projected final regular season standings, ordered by expected wins. The top ${playoffTeams} teams make the playoffs. Columns: projected seed, team, projected record, playoff odds, title odds, and points per week.`}
        </caption>
        <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="w-px whitespace-nowrap px-3 py-2.5 text-center">
              {chopped ? "Pos." : phase === "complete" ? "Place" : "Seed"}
            </th>
            <th scope="col" className="px-3 py-2.5">
              Team
            </th>
            <th scope="col" className="px-3 py-2.5 text-center">
              {chopped ? "Chop risk" : "Record"}
            </th>
            <th scope="col" className="px-3 py-2.5 text-center">
              {chopped ? "Last standing" : regular ? "Playoffs" : "Seed"}
            </th>
            {!chopped && (
              <th scope="col" className="px-3 py-2.5 text-center">
                {phase === "complete" ? "Result" : phase === "playoffs" ? "Bracket odds" : "Title"}
              </th>
            )}
            <th scope="col" className="hidden px-3 py-2.5 text-right sm:table-cell">
              Pts / wk
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ordered.map((team, i) => {
            // The number in the first column: a projected seed, a real seed
            // once the bracket is set, or the final place after the title game.
            const seed =
              phase === "complete"
                ? team.playoff?.finalPlace ?? i + 1
                : phase === "playoffs"
                  ? team.playoff?.seed ?? i + 1
                  : i + 1;
            // No bracket in a chopped league, so nobody is in or out of one and
            // there is no line to draw.
            const inPlayoffs = chopped
              ? false
              : regular
                ? seed <= playoffTeams
                : team.playoff?.status !== "missed";
            // The cut line renders as a heavier border under the last qualifier,
            // and is also stated in the caption for non-visual readers.
            const isCutLine = !chopped && regular && seed === playoffTeams;
            return (
              <tr
                key={team.rosterRowId}
                className={`hover:bg-surface ${isCutLine ? "border-b-2 border-b-brand-cyan/50" : ""}`}
              >
                <td className="w-px whitespace-nowrap px-3 py-2 text-center">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold tabular-nums ${
                      inPlayoffs
                        ? "bg-brand-cyan/15 text-brand-cyan"
                        : "bg-base text-ink-subtle"
                    }`}
                  >
                    {seed}
                  </span>
                  <span className="sr-only">
                    {chopped
                      ? ", by chance of being the last team standing"
                      : !regular
                        ? inPlayoffs
                          ? ", made the playoffs"
                          : ", missed the playoffs"
                        : inPlayoffs
                          ? ", projected to make the playoffs"
                          : ", projected to miss the playoffs"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <SleeperAvatar
                      avatarId={team.ownerAvatarId}
                      initial={team.teamName.charAt(0)}
                      title={team.teamName}
                      size={24}
                    />
                    {/* Team name over Sleeper handle, matching the rankings
                        table. Team names get renamed and reused; the handle is
                        how a reader knows which manager this actually is. */}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {team.teamName}
                      </span>
                      {ownerLine(team.teamName, team.ownerHandle) && (
                        <span className="block truncate text-[11px] text-ink-subtle">
                          {ownerLine(team.teamName, team.ownerHandle)}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs tabular-nums text-ink-muted">
                  {chopped
                    ? pctOdds(team.chopOddsThisWeek)
                    : regular
                      ? projectedRecordText(team.projectedRecord)
                      : playedRecordText(team.record)}
                  {/* Points per week has its own column from sm up. Below that
                      it rides under the record, so a phone keeps every figure
                      the desktop table shows. */}
                  <span className="mt-0.5 block text-[10px] text-ink-subtle sm:hidden">
                    <span className="sr-only">, </span>
                    {team.expectedPointsPerWeek !== null && team.expectedPointsPerWeek !== undefined ? (
                      <>{team.expectedPointsPerWeek.toFixed(1)} pts a week</>
                    ) : (
                      <>No projection</>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs font-semibold tabular-nums text-ink">
                  {chopped ? pctOdds(team.surviveAllOdds) : playoffFigure(team, phase)}
                </td>
                {!chopped && (
                  <td className="px-3 py-2 text-center font-mono text-xs font-semibold tabular-nums text-brand-cyan">
                    {titleFigure(team, phase)}
                  </td>
                )}
                <td className="hidden px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-muted sm:table-cell">
                  {team.expectedPointsPerWeek?.toFixed(1) ?? "No projection"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-subtle">
        {chopped ? (
          <>
            No playoffs here: the lowest score in the league goes out every
            week, and the order above is the chance of being the one left.{" "}
            <Link
              href="/guides/chopped-league-strategy"
              className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
            >
              How to play a chopped league
            </Link>
            .
          </>
        ) : (
          <>
            {regular
              ? `Top ${playoffTeams} make the playoffs. Records average every simulated season, so they land on fractions.`
              : phase === "playoffs"
                ? "Seeds are set. Teams out of the bracket say so in the result column."
                : "The title game is played. Place comes from the bracket."}{" "}
            <Link
              href="/guides/fantasy-football-playoffs#odds-heading"
              className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
            >
              What playoff odds mean, and why 60 percent is not safe
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}
