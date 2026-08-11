/**
 * Projected champion: who wins this league, and the case for it.
 *
 * Every other panel on the page reports a number. This one makes an argument.
 * It leads the tab because "who wins my league" is the question people arrived
 * with, and a percentage on its own does not answer it: a reader wants to know
 * what the model saw.
 *
 * Claims are paired with the figure behind them, in plain language. No jargon,
 * no component z-scores, no "sharpness" or "shrunk multiplier". Each list is
 * capped so the section stays scannable; the reasons are ordered strongest
 * first, so a cap trims the weakest arguments rather than arbitrary ones.
 *
 * The case cuts both ways on purpose. A favorite that wins a quarter of
 * simulated seasons loses three of them, and a section that only lists
 * strengths reads as a prediction rather than an estimate.
 *
 * Server component: pure presentation over data resolved upstream.
 */

import { SleeperAvatar } from "@/components/sleeper-avatar";
import { Panel } from "@/components/dashboard-panel";
import type { PulseTeam } from "@/lib/league-power-pulse-data";

/** How many arguments each side of the case is allowed. */
const MAX_REASONS_FOR = 5;
const MAX_REASONS_AGAINST = 3;
const MAX_CHASERS = 3;

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function pct(value: number | null): string {
  if (value === null) return "--";
  const asPct = value * 100;
  // Below one percent, "0%" reads as impossible when it is not.
  if (asPct > 0 && asPct < 1) return "under 1%";
  return `${Math.round(asPct)}%`;
}

/** One line of the case: a short claim, then the figure behind it. */
type Reason = { claim: string; evidence: string };

function positionLabel(position: string): string {
  if (position === "DEF") return "defense";
  if (position === "K") return "kicker";
  return position;
}

/**
 * A team in prose: its name, then the manager's handle in parentheses.
 *
 * Team names get renamed mid-season and several managers in a league often pick
 * variations of the same joke, so a bare name is not enough to tell a reader
 * whose team is being talked about. The handle is, and it is the label that
 * matches what they see in Sleeper.
 */
function teamLabel(name: string, handle: string | null | undefined): string {
  return handle ? `${name} (@${handle})` : name;
}

/**
 * The case for the favorite, strongest argument first.
 *
 * Weekly scoring is the biggest input to the model, so it leads; the schedule
 * follows because it is the thing readers most often forget is in the number at
 * all; roster shape and habits come after. Anything the league has no data for
 * is left out rather than padded with a hedge.
 */
function buildCaseFor(
  team: PulseTeam,
  teams: PulseTeam[],
  leagueAveragePoints: number,
): Reason[] {
  const reasons: Reason[] = [];
  const teamCount = teams.length;

  if (team.expectedPointsPerWeek !== null) {
    const delta = team.expectedPointsPerWeek - leagueAveragePoints;
    const rankPart =
      team.scorePointsRank === 1
        ? "the most in the league"
        : team.scorePointsRank !== null
          ? `${ordinal(team.scorePointsRank)} of ${teamCount}`
          : "";
    reasons.push({
      claim: delta > 0 ? "It outscores the teams it has to beat" : "It scores enough to stay in games",
      evidence: `${team.expectedPointsPerWeek.toFixed(1)} points a week${rankPart ? `, ${rankPart}` : ""}, ${
        delta >= 0 ? `${delta.toFixed(1)} above` : `${Math.abs(delta).toFixed(1)} below`
      } the league average.`,
    });
  }

  if (team.projectedWins !== null) {
    reasons.push({
      claim: "It is favored in most games it has left",
      evidence: `Projects to finish ${team.projectedWins.toFixed(1)}-${(team.projectedLosses ?? 0).toFixed(1)} and reaches the bracket in ${pct(team.playoffOdds)} of seasons${
        team.byeOdds !== null && team.byeOdds > 0.05 ? `, with a bye in ${pct(team.byeOdds)}` : ""
      }.`,
    });
  }

  if (team.sosRank !== null && team.sosPoints !== null) {
    const isEasy = team.sosRank > teamCount / 2;
    reasons.push({
      claim: isEasy ? "The schedule helps" : "It leads despite a hard schedule",
      evidence: `Its remaining opponents average ${team.sosPoints.toFixed(1)} points a week, the ${ordinal(
        isEasy ? teamCount - team.sosRank + 1 : team.sosRank,
      )} ${isEasy ? "lightest" : "toughest"} slate in the league.`,
    });
  }

  const bestPosition = Object.entries(team.positionRanks)
    .filter(([, rank]) => rank !== null && rank <= 2)
    .sort((a, b) => (a[1] as number) - (b[1] as number))[0];
  if (bestPosition) {
    const [position, rank] = bestPosition;
    reasons.push({
      claim: `Its ${positionLabel(position)} group is the best part of the roster`,
      evidence: `${rank === 1 ? "First" : ordinal(rank as number)} in the league at ${(
        team.positionPoints[position] ?? 0
      ).toFixed(1)} ${positionLabel(position)} points a week.`,
    });
  }

  // Named players. Readers recognize a name far faster than they parse a rate.
  const engine = [...team.starters].sort((a, b) => b.points - a.points).slice(0, 3);
  if (engine.length > 0) {
    reasons.push({
      claim: "Its best players produce every week",
      evidence: `${engine
        .map((p) => `${p.name} (${p.position}, ${p.points.toFixed(1)})`)
        .join(", ")} lead it in projected points a week.`,
    });
  }

  if (team.depthDropoffPct !== null && team.depthDropoffPct < 0.14) {
    reasons.push({
      claim: "One injury does not sink it",
      evidence: `Losing a position's best starter costs it only ${(team.depthDropoffPct * 100).toFixed(0)}% of its weekly output.`,
    });
  }

  if (team.reliabilityScore !== null && team.reliabilityScore > 1.01) {
    reasons.push({
      claim: "Its starters beat their projections",
      evidence: `Historically about ${((team.reliabilityScore - 1) * 100).toFixed(1)}% above what they were projected for${
        team.reliabilityRank !== null ? `, ${ordinal(team.reliabilityRank)} of ${teamCount}` : ""
      }.`,
    });
  }

  if (team.rankDivergence !== null && team.rankDivergence > 1 && team.valueRank !== null) {
    reasons.push({
      claim: "It wins with less on paper than you would think",
      evidence: `Only ${ordinal(team.valueRank)} in trade value but ${ordinal(
        team.pulseRank ?? 1,
      )} in expected performance, because what it owns is in the starting lineup.`,
    });
  }

  return reasons.slice(0, MAX_REASONS_FOR);
}

/** The honest counterweight: what the same model says could go wrong. */
function buildCaseAgainst(
  team: PulseTeam,
  runnerUp: PulseTeam | null,
  handleByRoster: Map<number, string | null>,
): Reason[] {
  const reasons: Reason[] = [];

  if (team.titleOdds !== null && team.titleOdds < 0.995) {
    reasons.push({
      claim: "The favorite usually still loses",
      evidence: `${pct(1 - team.titleOdds)} of seasons end with somebody else holding the trophy.`,
    });
  }

  if (runnerUp && runnerUp.titleOdds !== null && team.titleOdds !== null) {
    const close = team.titleOdds - runnerUp.titleOdds < 0.05;
    reasons.push({
      claim: close ? "The top is close to a coin flip" : "It is not running away with it",
      evidence: `${teamLabel(runnerUp.teamName, runnerUp.ownerHandle)} wins it ${pct(runnerUp.titleOdds)} of the time, ${
        close ? "so a couple of bad weeks flips the order." : "a gap one injury can close."
      }`,
    });
  }

  if (team.depthDropoffPct !== null && team.depthDropoffPct >= 0.14) {
    reasons.push({
      claim: "It is top heavy",
      evidence: `Losing a position's best starter costs it ${(team.depthDropoffPct * 100).toFixed(0)}% of its weekly output.`,
    });
  }

  if (
    team.lineupEfficiency !== null &&
    team.lineupEfficiency < 0.97 &&
    team.lineupPointsLost !== null &&
    team.lineupPointsLost > 0.5
  ) {
    reasons.push({
      claim: "It is leaving points on the bench",
      evidence: `The current lineup gives up ${team.lineupPointsLost.toFixed(1)} points a week against the best one available.`,
    });
  }

  const toughest = team.weekly
    .filter((w) => w.winProb !== null && w.opponentName)
    .sort((a, b) => (a.winProb ?? 1) - (b.winProb ?? 1))[0];
  if (toughest && (toughest.winProb ?? 1) < 0.5) {
    const opponent = teamLabel(
      toughest.opponentName ?? "",
      toughest.opponentRosterId === null
        ? null
        : handleByRoster.get(toughest.opponentRosterId) ?? null,
    );
    reasons.push({
      claim: "There is a game it is expected to lose",
      evidence: `Week ${toughest.week} against ${opponent} is a ${pct(toughest.winProb)} win.`,
    });
  }

  return reasons.slice(0, MAX_REASONS_AGAINST);
}

/** A claim and its number, as one readable line. */
function ReasonLine({ reason }: { reason: Reason }) {
  return (
    <li className="text-sm leading-relaxed text-ink-muted">
      <span className="font-semibold text-ink">{reason.claim}.</span>{" "}
      {reason.evidence}
    </li>
  );
}

export function ProjectedChampion({
  teams,
  simulationRuns,
}: {
  teams: PulseTeam[];
  /** How many seasons the Monte Carlo played out. Stated so the odds mean something. */
  simulationRuns: number;
}) {
  const ranked = [...teams]
    .filter((t) => t.titleOdds !== null)
    .sort((a, b) => (b.titleOdds ?? 0) - (a.titleOdds ?? 0));

  if (ranked.length === 0) {
    return (
      <Panel eyebrow="Simulated season" title="Projected champion">
        <p className="text-sm text-ink-muted">
          This fills in once Sleeper publishes your league's full schedule.
        </p>
      </Panel>
    );
  }

  const favorite = ranked[0];
  const runnerUp = ranked[1] ?? null;
  const chasers = ranked.slice(1, 1 + MAX_CHASERS).filter((t) => (t.titleOdds ?? 0) > 0.001);

  const scoring = teams
    .map((t) => t.expectedPointsPerWeek)
    .filter((v): v is number => v !== null);
  const leagueAveragePoints =
    scoring.length > 0 ? scoring.reduce((a, b) => a + b, 0) / scoring.length : 0;

  const handleByRoster = new Map<number, string | null>(
    teams.map((t) => [t.sleeperRosterId, t.ownerHandle]),
  );

  const casesFor = buildCaseFor(favorite, teams, leagueAveragePoints);
  const casesAgainst = buildCaseAgainst(favorite, runnerUp, handleByRoster);
  const oddsLabel = pct(favorite.titleOdds);
  const record =
    favorite.projectedWins !== null
      ? `${favorite.projectedWins.toFixed(1)}-${(favorite.projectedLosses ?? 0).toFixed(1)}`
      : null;

  return (
    <Panel
      eyebrow="Simulated season"
      title="Projected champion"
      helper={`${simulationRuns.toLocaleString("en-US")} simulated seasons on your real schedule and bracket.`}
      glow
    >
      {/* The answer, and the only thing on this panel that needs to be seen
          from across the room. Trophy, name, handle, odds, in that order. */}
      <div
        className="relative overflow-hidden rounded-card border border-brand-cyan/60 p-4 sm:p-5"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.22) 0%, transparent 62%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.20) 0%, transparent 62%)",
          boxShadow: "0 0 60px -26px rgba(34, 211, 238, 0.65)",
        }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {/* Decorative. "Projected champion" above already says what this is. */}
          <span aria-hidden="true" className="text-4xl leading-none sm:text-5xl">
            🏆
          </span>
          <SleeperAvatar
            avatarId={favorite.ownerAvatarId}
            initial={favorite.teamName.charAt(0)}
            title={favorite.teamName}
            size={52}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
              {favorite.teamName}
            </p>
            {favorite.ownerHandle && (
              <p className="truncate text-sm font-semibold text-brand-cyan">
                @{favorite.ownerHandle}
              </p>
            )}
            {record && (
              <p className="mt-0.5 truncate text-xs text-ink-muted">
                {record} projected record
              </p>
            )}
          </div>
          <p className="shrink-0">
            <span
              className="block font-mono text-4xl font-extrabold leading-none tabular-nums text-brand-cyan sm:text-5xl"
              aria-hidden="true"
            >
              {oddsLabel}
            </span>
            <span className="sr-only">
              {teamLabel(favorite.teamName, favorite.ownerHandle)} wins the
              championship in {oddsLabel} of simulated seasons.
            </span>
            <span
              aria-hidden="true"
              className="mt-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted"
            >
              To win it all
            </span>
          </p>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-cyan">
          Why this team
        </h3>
        <ol className="mt-2 list-inside list-decimal space-y-2 marker:font-mono marker:text-xs marker:text-brand-cyan">
          {casesFor.map((reason, i) => (
            <ReasonLine key={i} reason={reason} />
          ))}
        </ol>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {casesAgainst.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-purple">
              What could go wrong
            </h3>
            <ul className="mt-2 list-inside list-disc space-y-2 marker:text-brand-purple">
              {casesAgainst.map((reason, i) => (
                <ReasonLine key={i} reason={reason} />
              ))}
            </ul>
          </div>
        )}

        {chasers.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-muted">
              Also in the hunt
            </h3>
            <ol className="mt-2 space-y-2">
              {chasers.map((team) => {
                const odds = team.titleOdds ?? 0;
                const width =
                  (favorite.titleOdds ?? 1) > 0
                    ? Math.max(3, (odds / (favorite.titleOdds ?? 1)) * 100)
                    : 3;
                return (
                  <li key={team.rosterRowId} className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {team.teamName}
                      </span>
                      {team.ownerHandle && (
                        <span className="block truncate text-[11px] text-ink-subtle">
                          @{team.ownerHandle}
                        </span>
                      )}
                      {/* Decorative bar; the percentage beside it is the real value. */}
                      <span
                        aria-hidden="true"
                        className="mt-1 block h-1 overflow-hidden rounded-full bg-line-accent"
                      >
                        <span
                          className="block h-full rounded-full bg-brand-purple"
                          style={{ width: `${width}%` }}
                        />
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-ink-muted">
                      {pct(odds)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </Panel>
  );
}
