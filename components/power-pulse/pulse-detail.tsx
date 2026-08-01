"use client";

/**
 * The full Power Pulse breakdown for one team.
 *
 * Rendered in two places with identical content: expanded inline under a desktop
 * table row, and inside the mobile bottom sheet. That is deliberate. The mobile
 * layout hides columns from the table, so every hidden number has to live here,
 * and keeping one component means the two can never drift apart.
 *
 * Structured as real definition lists and an ordered list of drivers, so a
 * screen reader gets "Scoring, 86, 1st of 12" rather than a wall of numbers.
 */

import type { PulseTeam } from "@/lib/league-power-pulse-data";

export function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "--";
  return `${(v * 100).toFixed(digits)}%`;
}

function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "--";
  return v.toFixed(digits);
}

/** Tone classes for the driver list. Never color alone: each carries a word. */
const TONE: Record<string, { dot: string; text: string; word: string }> = {
  good: { dot: "bg-signal-success", text: "text-signal-success", word: "Strength" },
  bad: { dot: "bg-signal-danger", text: "text-signal-danger", word: "Concern" },
  neutral: { dot: "bg-ink-subtle", text: "text-ink-muted", word: "Note" },
};

function ComponentBar({
  label,
  score,
  rank,
  teamCount,
  hint,
}: {
  label: string;
  score: number | null;
  rank: number | null;
  teamCount: number;
  hint: string;
}) {
  const value = score ?? 0;
  const rankLabel = rank !== null ? `${ordinal(rank)} of ${teamCount}` : "not ranked";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs font-semibold text-ink">{label}</dt>
        <dd className="font-mono text-xs tabular-nums text-ink-muted">
          <span className="font-bold text-brand-cyan">{score ?? "--"}</span>
          <span className="mx-1 text-ink-subtle">/</span>
          <span>{rankLabel}</span>
        </dd>
      </div>
      {/* Decorative meter. The numbers above carry the same information. */}
      <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-base">
        <div
          className="h-full rounded-full bg-beacon"
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] leading-tight text-ink-subtle">{hint}</p>
    </div>
  );
}

export function PulseDetail({
  team,
  teamCount,
  teamHref,
  onNavigate,
}: {
  team: PulseTeam;
  teamCount: number;
  teamHref: string;
  /** Called when the "View team" link is activated, so a sheet can close. */
  onNavigate?: () => void;
}) {
  const nextThree = team.weekly.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Why this score, in plain language. The most useful thing on the page
          for a screen reader, so it leads. */}
      {team.drivers.length > 0 && (
        <section aria-label={`Why ${team.teamName} scores ${team.powerPulse}`}>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            Why this score
          </h3>
          <ol className="mt-2 space-y-2">
            {team.drivers.map((d, i) => {
              const tone = TONE[d.tone] ?? TONE.neutral;
              return (
                <li key={i} className="flex gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`}
                  />
                  <p className="text-xs leading-relaxed text-ink-muted">
                    <span className="sr-only">{tone.word}: </span>
                    <span className={`font-semibold ${tone.text}`}>{d.label}.</span>{" "}
                    {d.detail}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* The four components that make up the headline number. */}
      <section aria-label="Score components">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
          What builds the score
        </h3>
        <dl className="mt-2.5 space-y-3">
          <ComponentBar
            label="Scoring"
            score={team.scorePoints}
            rank={team.scorePointsRank}
            teamCount={teamCount}
            hint={`${num(team.expectedPointsPerWeek)} projected points per week in this league's scoring.`}
          />
          <ComponentBar
            label="Schedule"
            score={team.scoreSchedule}
            rank={team.scoreScheduleRank}
            teamCount={teamCount}
            hint={
              team.sosRank !== null
                ? `Opponents average ${num(team.sosPoints)} per week, ${ordinal(team.sosRank)} toughest.`
                : "No remaining schedule to grade."
            }
          />
          <ComponentBar
            label="Depth"
            score={team.scoreDepth}
            rank={team.scoreDepthRank}
            teamCount={teamCount}
            hint={
              team.depthDropoffPct !== null
                ? `Loses ${pct(team.depthDropoffPct)} of weekly output when a position's best starter misses.`
                : "Not enough roster data to grade depth."
            }
          />
          {team.scoreForm !== null && (
            <ComponentBar
              label="Form"
              score={team.scoreForm}
              rank={team.scoreFormRank}
              teamCount={teamCount}
              hint="Recent results measured against what we projected."
            />
          )}
        </dl>
      </section>

      {/* Season outlook. */}
      <section aria-label="Season outlook">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
          Season outlook
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label="Proj. record"
            value={`${num(team.projectedWins, 1)}-${num(team.projectedLosses, 1)}`}
            accent="ink"
          />
          <Tile label="Playoffs" value={pct(team.playoffOdds)} accent="cyan" />
          <Tile label="Title" value={pct(team.titleOdds)} accent="purple" />
          <Tile
            label="Points / wk"
            value={num(team.expectedPointsPerWeek)}
            accent="ink"
          />
        </dl>
      </section>

      {/* Management quality: lineup efficiency and starter reliability. */}
      <section aria-label="Roster management">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
          Roster management
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Tile
            label="Lineup efficiency"
            value={team.lineupEfficiency === null ? "--" : pct(team.lineupEfficiency)}
            accent="cyan"
            sub={
              team.lineupPointsLost !== null && team.lineupPointsLost > 0.05
                ? `${num(team.lineupPointsLost)} pts on the bench`
                : "Optimal lineup set"
            }
          />
          <Tile
            label="Starter reliability"
            value={
              team.reliabilityScore === null
                ? "--"
                : `${team.reliabilityScore >= 1 ? "+" : ""}${((team.reliabilityScore - 1) * 100).toFixed(1)}%`
            }
            accent="purple"
            sub={
              team.reliabilityRank !== null
                ? `${ordinal(team.reliabilityRank)} of ${teamCount}`
                : "no history yet"
            }
          />
        </dl>
      </section>

      {/* Positional rooms. */}
      {Object.keys(team.positionPoints).length > 0 && (
        <section aria-label="Positional strength">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            Positional rooms
          </h3>
          <dl className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Object.entries(team.positionPoints).map(([position, points]) => {
              const rank = team.positionRanks[position] ?? null;
              return (
                <div
                  key={position}
                  className="rounded-card border border-line bg-base/50 px-2 py-2 text-center"
                >
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">
                    {position}
                  </dt>
                  <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-ink">
                    {num(points)}
                  </dd>
                  <p className="text-[9px] tabular-nums text-ink-subtle">
                    {rank !== null ? `${ordinal(rank)} of ${teamCount}` : "unranked"}
                  </p>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {/* Next three opponents with win probability. */}
      {nextThree.length > 0 && (
        <section aria-label="Next three matchups">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            Next three weeks
          </h3>
          <ul className="mt-2 space-y-1.5">
            {nextThree.map((w) => (
              <li
                key={w.week}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-base/50 px-3 py-2"
              >
                <span className="min-w-0 text-xs text-ink-muted">
                  <span className="font-mono font-semibold text-ink-subtle">
                    Wk {w.week}
                  </span>{" "}
                  <span className="truncate">vs {w.opponentName ?? "no opponent"}</span>
                </span>
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-brand-cyan">
                  {w.winProb === null ? "--" : `${Math.round(w.winProb * 100)}% win`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <a
        href={teamHref}
        onClick={onNavigate}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        View {team.teamName} roster
      </a>
    </div>
  );
}

function Tile({
  label,
  value,
  accent = "ink",
  sub,
}: {
  label: string;
  value: string;
  accent?: "cyan" | "purple" | "ink";
  sub?: string;
}) {
  const color =
    accent === "purple"
      ? "text-brand-purple"
      : accent === "cyan"
        ? "text-brand-cyan"
        : "text-ink";
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-base font-bold tabular-nums ${color}`}>
        {value}
      </dd>
      {sub && <p className="mt-0.5 text-[10px] leading-tight text-ink-subtle">{sub}</p>}
    </div>
  );
}
