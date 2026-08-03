/**
 * Projected final standings, ordered by expected wins rather than by Power
 * Pulse. The two orders differ when a strong roster draws a hard schedule, and
 * that difference is the point: this is the table that answers "where do I
 * actually finish".
 *
 * The playoff cut line is drawn from the league's own settings.playoff_teams, so
 * a four-team or eight-team league gets the right line.
 */

import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { PulseTeam } from "@/lib/league-power-pulse-data";

export function ProjectedStandings({
  teams,
  playoffTeams,
}: {
  teams: PulseTeam[];
  playoffTeams: number;
}) {
  const ordered = [...teams].sort(
    (a, b) =>
      (b.projectedWins ?? 0) - (a.projectedWins ?? 0) ||
      (b.expectedPointsPerWeek ?? 0) - (a.expectedPointsPerWeek ?? 0),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Projected final standings, ordered by expected wins. The top{" "}
          {playoffTeams} teams make the playoffs. Columns: projected seed, team,
          projected record, playoff odds, and points per week.
        </caption>
        <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="w-px whitespace-nowrap px-3 py-2.5 text-center">
              Seed
            </th>
            <th scope="col" className="px-3 py-2.5">
              Team
            </th>
            <th scope="col" className="px-3 py-2.5 text-center">
              Record
            </th>
            <th scope="col" className="px-3 py-2.5 text-center">
              Playoffs
            </th>
            <th scope="col" className="hidden px-3 py-2.5 text-right sm:table-cell">
              Pts / wk
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ordered.map((team, i) => {
            const seed = i + 1;
            const inPlayoffs = seed <= playoffTeams;
            // The cut line renders as a heavier border under the last qualifier,
            // and is also stated in the caption for non-visual readers.
            const isCutLine = seed === playoffTeams;
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
                    {inPlayoffs ? ", projected to make the playoffs" : " , projected to miss the playoffs"}
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
                      {team.ownerHandle && (
                        <span className="block truncate text-[11px] text-ink-subtle">
                          @{team.ownerHandle}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs tabular-nums text-ink-muted">
                  {team.projectedWins !== null
                    ? `${team.projectedWins.toFixed(1)}-${(team.projectedLosses ?? 0).toFixed(1)}`
                    : "--"}
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs font-semibold tabular-nums text-ink">
                  {team.playoffOdds === null ? "--" : `${Math.round(team.playoffOdds * 100)}%`}
                </td>
                <td className="hidden px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-muted sm:table-cell">
                  {team.expectedPointsPerWeek?.toFixed(1) ?? "--"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-subtle">
        Top {playoffTeams} make the playoffs. Records are the average across every
        simulated season, so they land on fractions.
      </p>
    </div>
  );
}
