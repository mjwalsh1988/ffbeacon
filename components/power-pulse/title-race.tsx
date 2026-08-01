/**
 * Title race: who actually wins this league.
 *
 * The single most-asked question a power ranking never answers. Odds come from
 * the Monte Carlo season simulation, so they already account for schedule,
 * roster strength, and week-to-week variance rather than being a reshuffle of
 * the rankings.
 *
 * Server component: pure presentation over data resolved upstream.
 */

import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { PulseTeam } from "@/lib/league-power-pulse-data";

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export function TitleRace({ teams }: { teams: PulseTeam[] }) {
  const ranked = [...teams]
    .filter((t) => t.titleOdds !== null)
    .sort((a, b) => (b.titleOdds ?? 0) - (a.titleOdds ?? 0));

  if (ranked.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Title odds need a full head-to-head schedule from Sleeper. They will
        appear once the league schedule is published.
      </p>
    );
  }

  const favorite = ranked[0];
  const rest = ranked.slice(1, 6).filter((t) => (t.titleOdds ?? 0) > 0.001);
  const max = favorite.titleOdds ?? 1;

  return (
    <div className="space-y-4">
      {/* The favorite gets its own treatment. This is the headline of the tab. */}
      <div
        className="relative overflow-hidden rounded-card border border-brand-cyan/45 p-4"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(34, 211, 238, 0.14) 0%, transparent 60%), radial-gradient(ellipse at 100% 100%, rgba(168, 85, 247, 0.12) 0%, transparent 60%)",
        }}
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-cyan">
          Most likely champion
        </p>
        <div className="mt-2.5 flex items-center gap-3">
          <SleeperAvatar
            avatarId={favorite.ownerAvatarId}
            initial={favorite.teamName.charAt(0)}
            title={favorite.teamName}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold tracking-tight text-ink">
              {favorite.teamName}
            </p>
            <p className="truncate text-xs text-ink-muted">
              {favorite.pulseRank !== null ? `${ordinal(favorite.pulseRank)} in Power Pulse` : ""}
              {favorite.projectedWins !== null && (
                <>
                  <span className="mx-1.5 text-ink-subtle">and</span>
                  {favorite.projectedWins.toFixed(1)}-
                  {(favorite.projectedLosses ?? 0).toFixed(1)} projected
                </>
              )}
            </p>
          </div>
          <p
            className="shrink-0 font-mono text-2xl font-extrabold tabular-nums text-brand-cyan"
            aria-label={`${Math.round((favorite.titleOdds ?? 0) * 100)} percent chance to win the championship`}
          >
            {Math.round((favorite.titleOdds ?? 0) * 100)}%
          </p>
        </div>
      </div>

      {rest.length > 0 && (
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            Also in the hunt
          </h3>
          <ol className="mt-2 space-y-2">
            {rest.map((team) => {
              const odds = team.titleOdds ?? 0;
              const width = max > 0 ? Math.max(3, (odds / max) * 100) : 3;
              return (
                <li key={team.rosterRowId} className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">
                      {team.teamName}
                    </span>
                    {/* Decorative bar; the percentage beside it is the real value. */}
                    <span
                      aria-hidden="true"
                      className="mt-1 block h-1 overflow-hidden rounded-full bg-base"
                    >
                      <span
                        className="block h-full rounded-full bg-brand-purple/80"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-ink-muted">
                    {Math.round(odds * 100)}%
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
