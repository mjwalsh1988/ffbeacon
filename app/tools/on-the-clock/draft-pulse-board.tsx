"use client";

/**
 * The Draft Pulse tab.
 *
 * Draft Pulse and FF Beacon value answer two different questions, and the tab is
 * built around the gap between them:
 *
 *   Draft Pulse   how many points this roster's best starting lineup projects
 *                 per remaining week, ranked inside this league.
 *   FF Beacon     how much the roster is WORTH: every drafted player plus the
 *                 future picks, which a lineup cannot start.
 *
 * A team can lead one and trail the other, and during a draft that gap is
 * actionable: it is the difference between a team that can win now and a team
 * that has been accumulating. So both tables are here, side by side, and the
 * section between them names the teams where the two disagree most.
 *
 * IT IS NOT POWER PULSE. No expected wins, no playoff odds, no projected finish.
 * A startup draft has no schedule to simulate against, and lib/on-the-clock/
 * draft-pulse.ts explains at length why inventing one would be dishonest. Every
 * number on this page is points per week and a within-league rank.
 *
 * Pure presentation. Everything arrives computed as props; nothing here calls
 * Sleeper, Supabase, or any API.
 */

import { ArrowDown, ArrowUp, Gauge } from "lucide-react";
import type { DraftPulseTeam } from "@/lib/on-the-clock/draft-pulse";
import type { TeamRollup } from "@/lib/on-the-clock/rosters";
import { classifyTeamStatus, type TeamStatus } from "@/lib/league-team-status";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import { POSITION_BADGE } from "@/lib/on-the-clock/position-colors";
import { EmptyCard, NotStartedCard } from "./states";

/** Plain-English name for a Sleeper starting-slot token. */
const SLOT_LABELS: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
  DL: "defensive lineman",
  LB: "linebacker",
  DB: "defensive back",
  FLEX: "flex",
  REC_FLEX: "receiver flex",
  WRRB_FLEX: "run-catch flex",
  SUPER_FLEX: "superflex",
  IDP_FLEX: "IDP flex",
};

function slotLabel(slot: string | null): string | null {
  if (!slot) return null;
  return SLOT_LABELS[slot] ?? slot.replace(/_/g, " ").toLowerCase();
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString();
}

function ordinalRank(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

interface PulseRow {
  team: TeamRollup;
  pulse: DraftPulseTeam;
  status: TeamStatus | null;
  /** Value rank minus Pulse rank. Positive = starts better than it owns. */
  swing: number;
}

export function DraftPulseBoard({
  teams,
  pulseTeams,
  myRosterId,
  boardReady,
  draftStarted,
  minReliabilityWeeks,
  isDynasty,
  weeks,
  slotsEstimated,
  scoringEstimated,
  pulseLoading,
}: {
  /** Value rollups, already ranked. */
  teams: TeamRollup[];
  /** Draft Pulse standings. Empty when projections are unavailable. */
  pulseTeams: DraftPulseTeam[];
  myRosterId: number | null;
  boardReady: boolean;
  /** False before the first pick lands: the tab has nothing real to say yet. */
  draftStarted: boolean;
  /**
   * Weeks of history a starter needs before a beat rate is shown. The ADMIN's
   * value, the same one the reliability awards gate on, so the two can never
   * disagree about whether a team has enough evidence.
   */
  minReliabilityWeeks: number;
  isDynasty: boolean;
  /** How many remaining weeks the averages were taken over. */
  weeks: number;
  /** True when the league's roster_positions were unavailable and slots were guessed. */
  slotsEstimated: boolean;
  /** True when the league's scoring settings were never captured. */
  scoringEstimated: boolean;
  pulseLoading: boolean;
}) {
  // Real projections, not just rows. computeDraftPulse still returns a team per
  // roster with ranks and scores when the slate is empty, and every one of them
  // scores zero, so the presence of rows proves nothing.
  const hasProjections = pulseTeams.some((t) => t.meanStartingPoints > 0);

  if (!boardReady) {
    return (
      <EmptyCard
        title="FF Beacon values are not available yet."
        body="Draft Pulse ranks teams by projected starting points and by FF Beacon value. Both tables fill in once this format's rankings publish."
      />
    );
  }

  // Three states, not two, and the third is the one that matters.
  //
  // "Nobody has picked" is only right when nobody has picked. A draft WITH picks
  // whose projection slate is empty (a past season, or a season with no weekly
  // projections published yet) produces a full standings table of 0.0 points,
  // ranks 1 through N assigned to a set of ties, and a "disagreements" section
  // built entirely out of that noise. It reads as a real ranking. CLAUDE.md
  // names exactly this failure for Power Pulse: scoring an empty slate returns
  // an answer-shaped thing that is not an answer.
  //
  // hasProjections is the honest test, and it also covers the dynasty rookie
  // draft, where existing rosters project real points before a single pick.
  if (!draftStarted && !hasProjections && !pulseLoading) {
    return (
      <NotStartedCard
        icon={Gauge}
        eyebrow="Draft Pulse"
        title="Nobody has picked yet"
        body={
          isDynasty
            ? "Draft Pulse scores each roster's best starting lineup for the rest of the season. Every team is level until the first pick lands."
            : "Draft Pulse scores each roster's best starting lineup for the rest of the season. With nobody drafted, every lineup is empty."
        }
        points={[
          "A points-per-week score for every team, ranked in your league.",
          "The same teams ranked by FF Beacon value, so you can see who owns more than they can start.",
          "Each team's points by position, and the starting slot they still need.",
        ]}
      />
    );
  }

  if (!hasProjections) {
    return (
      <EmptyCard
        title={pulseLoading ? "Loading weekly projections." : "Projections are unavailable."}
        body={
          pulseLoading
            ? "Draft Pulse is being computed for this league. It will replace this message when it lands."
            : "No weekly projections exist for this season, so there is no lineup to score. Every value panel still works, and this fills in when projections publish."
        }
      />
    );
  }

  const teamCount = teams.length;
  const pulseById = new Map(pulseTeams.map((t) => [t.rosterId, t]));
  const rows: PulseRow[] = teams
    .map((team) => {
      const pulse = pulseById.get(team.rosterId);
      if (!pulse) return null;
      return {
        team,
        pulse,
        status: isDynasty
          ? classifyTeamStatus({ pulseRank: pulse.rank, valueRank: team.rank, teamCount })
          : null,
        swing: team.rank - pulse.rank,
      };
    })
    .filter((r): r is PulseRow => r !== null);

  if (rows.length === 0) {
    return (
      <EmptyCard
        title={pulseLoading ? "Loading weekly projections." : "Projections are unavailable."}
        body={
          pulseLoading
            ? "Draft Pulse is being computed for this league. The FF Beacon value ranking below does not need it."
            : "We could not project this league's weekly scoring, so Draft Pulse has nothing to rank. Every value panel still works, and this fills in on the next sync."
        }
      />
    );
  }

  const byPulse = rows.slice().sort((a, b) => a.pulse.rank - b.pulse.rank);
  const byValue = rows.slice().sort((a, b) => a.team.rank - b.team.rank);
  const mine = myRosterId != null ? rows.find((r) => r.team.rosterId === myRosterId) : undefined;
  const leader = byPulse[0];
  const hasSample = (row: PulseRow) =>
    row.pulse.starterBeatRate !== null &&
    (row.pulse.starterWeeksPlayed ?? 0) >= minReliabilityWeeks;

  // The teams the two rankings disagree about most, in both directions. Ties at
  // zero are not a disagreement, so they never appear.
  const movers = rows
    .filter((r) => r.swing !== 0)
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))
    .slice(0, 4);

  return (
    <div className="space-y-8">
      {/* This panel swaps between three completely different bodies (not started,
          waiting on projections, and the full board) while a user may be sitting
          in it. Without this, the page they are focused in silently becomes a
          different page. Awards already does the same thing. */}
      <p className="sr-only" role="status" aria-live="polite">
        {`Draft Pulse is ready. ${rows.length} ${rows.length === 1 ? "team" : "teams"} ranked, led by ${leader.team.ownerName}.`}
      </p>
      <div className="min-w-0">
        <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl" id="otc-pulse-title">
          Draft Pulse
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Each roster&apos;s best starting lineup, scored in your league&apos;s scoring over the{" "}
          {weeks === 1 ? "one remaining week" : `${weeks} remaining weeks`} and ranked inside this
          league. No expected wins or playoff odds: a draft has no schedule to play.
        </p>
        {(slotsEstimated || scoringEstimated) && (
          <p className="mt-2 rounded-card border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {scoringEstimated
              ? "We have not captured this league's scoring settings yet, so these points use a standard approximation. Press Sync draft to pull them."
              : "We could not read this league's starting lineup, so the slots below are estimated from the draft settings."}
          </p>
        )}
      </div>

      {/* ---- Your team, when we know which one it is ---- */}
      {mine && (
        // teams.length, not rows.length: a rank is out of the LEAGUE, and the
        // two differ only when a roster appeared after the last pulse ran.
        <YourPulseCard mine={mine} leader={leader} teamCount={teamCount} />
      )}

      {/* ---- Table 1: Draft Pulse ---- */}
      <section aria-labelledby="otc-pulse-standings" className="space-y-3">
        <div className="min-w-0">
          <h3
            id="otc-pulse-standings"
            className="text-lg font-bold tracking-tight text-ink"
          >
            Ranked by Draft Pulse
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Who can put the most points on the field right now. The slot column is where each team
            is thinnest.
          </p>
        </div>
        <PulseTable rows={byPulse} myRosterId={myRosterId} hasSample={hasSample} />
      </section>

      {/* ---- Table 2: FF Beacon value ---- */}
      <section aria-labelledby="otc-pulse-value" className="space-y-3">
        <div className="min-w-0">
          <h3 id="otc-pulse-value" className="text-lg font-bold tracking-tight text-ink">
            Ranked by FF Beacon value
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            What each roster is worth: drafted players plus future picks. Picks trade well and score
            nothing, so this order differs from the one above.
          </p>
        </div>
        <ValueTable rows={byValue} myRosterId={myRosterId} />
      </section>

      {/* ---- The gap between the two ---- */}
      {movers.length > 0 && (
        <section aria-labelledby="otc-pulse-movers" className="space-y-3">
          <div className="min-w-0">
            <h3 id="otc-pulse-movers" className="text-lg font-bold tracking-tight text-ink">
              Where the two rankings disagree
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Starting better than you own means getting more out of less. Owning more than you
              start usually means picks and bench depth.
            </p>
          </div>
          <ul role="list" className="grid gap-3 sm:grid-cols-2">
            {movers.map((row) => (
              <li key={row.team.rosterId}>
                <MoverCard row={row} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Positional breakdown ---- */}
      <section aria-labelledby="otc-pulse-positions" className="space-y-3">
        <div className="min-w-0">
          <h3 id="otc-pulse-positions" className="text-lg font-bold tracking-tight text-ink">
            Where the points come from
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Projected starter points a week by position. Zero means nobody is projected to start
            there yet.
          </p>
        </div>
        <PositionBreakdown rows={byPulse} myRosterId={myRosterId} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your team
// ---------------------------------------------------------------------------

function YourPulseCard({
  mine,
  leader,
  teamCount,
}: {
  mine: PulseRow;
  leader: PulseRow;
  teamCount: number;
}) {
  const behind = leader.pulse.meanStartingPoints - mine.pulse.meanStartingPoints;
  const weakest = slotLabel(mine.pulse.weakestSlot);
  const isLeader = mine.team.rosterId === leader.team.rosterId;

  return (
    <section
      aria-labelledby="otc-pulse-mine"
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface/60 p-4 sm:p-5"
      style={{ boxShadow: "0 0 90px -60px rgba(168, 85, 247, 0.8)" }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <h3
        id="otc-pulse-mine"
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan"
      >
        Your team
      </h3>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-3">
        <p>
          <span className="font-mono text-3xl font-bold tabular-nums text-brand-cyan">
            {mine.pulse.score}
          </span>
          <span className="ml-2 text-sm text-ink-muted">
            Draft Pulse, {ordinalRank(mine.pulse.rank)} of {teamCount}
          </span>
        </p>
        <p>
          <span className="font-mono text-xl font-bold tabular-nums text-ink">
            {mine.pulse.meanStartingPoints.toFixed(1)}
          </span>
          <span className="ml-2 text-sm text-ink-muted">projected starting points a week</span>
        </p>
        <p>
          <span className="font-mono text-xl font-bold tabular-nums text-ink">
            {fmt(mine.team.totalValue)}
          </span>
          <span className="ml-2 text-sm text-ink-muted">
            FF Beacon value, {ordinalRank(mine.team.rank)}
          </span>
        </p>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink">
        {isLeader
          ? "You project the strongest starting lineup in the room right now."
          : `You are ${behind.toFixed(1)} points a week behind ${leader.team.ownerName}, the current leader.`}
        {weakest ? ` Your thinnest starting spot is ${weakest}.` : ""}
        {mine.pulse.unprojectedCount > 0
          ? ` ${mine.pulse.projectedCount} of your ${
              mine.pulse.projectedCount + mine.pulse.unprojectedCount
            } players carry a weekly projection; the rest are judged on value alone.`
          : ""}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Both tables keep every column at every width. Per the project's mobile rule,
 * nothing is hidden at a breakpoint; the wrapper scrolls instead, and it is
 * focusable so a keyboard can reach the scroll.
 */
function TableShell({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className="overflow-x-auto rounded-modal border border-line bg-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <table className="w-max min-w-full border-collapse text-left sm:w-full">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

function TeamCell({ row, isYou }: { row: PulseRow; isYou: boolean }) {
  return (
    <th scope="row" className="px-2 py-2.5 text-left align-middle font-normal">
      <span className="flex flex-col justify-center">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-sm font-semibold text-ink">{row.team.ownerName}</span>
          {isYou && (
            <span className="shrink-0 rounded-full border border-brand-purple/50 bg-brand-purple/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
              You
            </span>
          )}
        </span>
        {row.team.teamName && (
          <span className="truncate text-xs text-ink-muted">{row.team.teamName}</span>
        )}
      </span>
    </th>
  );
}

function RankBadge({ rank, isYou }: { rank: number; isYou: boolean }) {
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-sm font-bold tabular-nums ${
        isYou ? "bg-brand-purple/20 text-brand-purple" : "bg-base text-ink-muted"
      }`}
    >
      {rank}
    </span>
  );
}

const TH = "whitespace-nowrap px-3 py-2.5 font-semibold";

function PulseTable({
  rows,
  myRosterId,
  hasSample,
}: {
  rows: PulseRow[];
  myRosterId: number | null;
  /** True when there is enough history behind this team's starters to judge. */
  hasSample: (row: PulseRow) => boolean;
}) {
  return (
    <TableShell
      label="Draft Pulse standings, scrollable"
      caption="Every team ranked by Draft Pulse: score, projected starting points per week, starting slots filled, the thinnest starting slot, and starter reliability."
    >
      <thead>
        <tr className="border-b border-line text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          <th scope="col" className="w-px whitespace-nowrap px-3 py-2.5 text-center font-semibold">
            Rank
          </th>
          <th scope="col" className="px-2 py-2.5 font-semibold">
            Team
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Pulse
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Pts / wk
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Starters
          </th>
          <th scope="col" className={TH}>
            Thinnest slot
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Starters beat their projection
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isYou = myRosterId != null && row.team.rosterId === myRosterId;
          const weakest = slotLabel(row.pulse.weakestSlot);
          // A beat rate over one or two weeks of history is a number, not
          // evidence, so it is withheld rather than shown with a caveat. The
          // threshold is the admin's, shared with the reliability awards.
          const sampled = hasSample(row);
          return (
            <tr
              key={row.team.rosterId}
              className={`border-b border-line/60 last:border-0 ${isYou ? "bg-brand-purple/10" : ""}`}
            >
              <td className="w-px whitespace-nowrap px-3 py-2.5 text-center align-middle">
                <RankBadge rank={row.pulse.rank} isYou={isYou} />
              </td>
              <TeamCell row={row} isYou={isYou} />
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm font-bold tabular-nums text-brand-cyan">
                {row.pulse.score}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm tabular-nums text-ink">
                {row.pulse.meanStartingPoints.toFixed(1)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm tabular-nums text-ink-muted">
                {row.pulse.startersFilled.toFixed(1)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-middle text-sm text-ink-muted">
                {weakest ?? (
                  <span>
                    <span aria-hidden="true">-</span>
                    <span className="sr-only">Every starting slot is filled</span>
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm tabular-nums text-ink-muted">
                {sampled ? (
                  `${Math.round((row.pulse.starterBeatRate ?? 0) * 100)}%`
                ) : (
                  <span>
                    <span aria-hidden="true">-</span>
                    <span className="sr-only">Not enough history to judge</span>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function ValueTable({ rows, myRosterId }: { rows: PulseRow[]; myRosterId: number | null }) {
  return (
    <TableShell
      label="FF Beacon value rankings, scrollable"
      caption="Every team ranked by total FF Beacon value: drafted players, future picks, the total, and where the same team sits by Draft Pulse."
    >
      <thead>
        <tr className="border-b border-line text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          <th scope="col" className="w-px whitespace-nowrap px-3 py-2.5 text-center font-semibold">
            Rank
          </th>
          <th scope="col" className="px-2 py-2.5 font-semibold">
            Team
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Drafted
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Future picks
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Total value
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Pulse rank
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isYou = myRosterId != null && row.team.rosterId === myRosterId;
          const drafted = row.team.totalValue - row.team.futurePicksValue;
          return (
            <tr
              key={row.team.rosterId}
              className={`border-b border-line/60 last:border-0 ${isYou ? "bg-brand-purple/10" : ""}`}
            >
              <td className="w-px whitespace-nowrap px-3 py-2.5 text-center align-middle">
                <RankBadge rank={row.team.rank} isYou={isYou} />
              </td>
              <TeamCell row={row} isYou={isYou} />
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm tabular-nums text-ink">
                {fmt(drafted)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm tabular-nums text-ink-muted">
                {row.team.futurePicks.length === 0 ? (
                  <span>
                    <span aria-hidden="true">-</span>
                    <span className="sr-only">No future picks</span>
                  </span>
                ) : (
                  fmt(row.team.futurePicksValue)
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm font-bold tabular-nums text-ink">
                {fmt(row.team.totalValue)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm tabular-nums text-brand-cyan">
                {ordinalRank(row.pulse.rank)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

// ---------------------------------------------------------------------------
// The gap
// ---------------------------------------------------------------------------

/** The archetype chip's meaning, in this tab's own vocabulary. */
function archetypeReason(row: PulseRow): string {
  if (row.status?.key === "competitor") {
    return "near the top by Draft Pulse, so this roster can put points on the field now";
  }
  if (row.status?.key === "rebuilder") {
    return "not near the top by Draft Pulse, and holding more value than it can start";
  }
  return "in the pack on both the points ranking and the value ranking";
}

function MoverCard({ row }: { row: PulseRow }) {
  const startsBetter = row.swing > 0;
  const places = Math.abs(row.swing);
  const Icon = startsBetter ? ArrowUp : ArrowDown;
  const tone = startsBetter
    ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
    : "border-sky-400/50 bg-sky-400/10 text-sky-300";

  return (
    <article className="flex h-full items-start gap-3 rounded-card border border-line bg-surface/50 p-3.5">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border ${tone}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-ink">
          {row.team.ownerName}
          {row.team.teamName && (
            // ink-muted, not ink-subtle. This is a team NAME, not decoration,
            // and ink-subtle lands around 3.7:1 on this card, under the 4.5:1
            // AA floor for text this size.
            <span className="ml-1.5 text-xs font-normal text-ink-muted">{row.team.teamName}</span>
          )}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          {ordinalRank(row.pulse.rank)} by Draft Pulse, {ordinalRank(row.team.rank)} by value:{" "}
          {places} {places === 1 ? "place" : "places"} {startsBetter ? "better" : "worse"} on the
          field than on paper.{" "}
          {startsBetter
            ? "More of what they own can start."
            : "Some of what they own cannot start yet, usually picks or bench depth."}
        </p>
        {row.status && (
          <p className="mt-1.5">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                row.status.key === "competitor"
                  ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                  : row.status.key === "rebuilder"
                    ? "border-sky-400/50 bg-sky-400/10 text-sky-300"
                    : "border-zinc-400/40 bg-zinc-400/10 text-zinc-300"
              }`}
            >
              {row.status.label}
            </span>
            {/* Our own sentence, not classifyTeamStatus's `reason`. That one is
                written for League Pulse and says "by Power Pulse", which is a
                different model measuring expected WINS. A sighted user sees only
                the chip; putting the wrong feature name in the sr-only text
                would hand the wrong explanation to the one audience that gets
                an explanation at all. */}
            <span className="sr-only">, {archetypeReason(row)}</span>
          </p>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Positional breakdown
// ---------------------------------------------------------------------------

function PositionBreakdown({
  rows,
  myRosterId,
}: {
  rows: PulseRow[];
  myRosterId: number | null;
}) {
  // One shared scale across every team and position, so a bar means the same
  // thing everywhere on the page. A per-row scale would make the worst team's
  // best position look like the league's best.
  const peak = Math.max(
    1,
    ...rows.flatMap((r) => PULSE_POSITIONS.map((p) => r.pulse.positionPoints[p] ?? 0)),
  );

  return (
    <ul role="list" className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => {
        const isYou = myRosterId != null && row.team.rosterId === myRosterId;
        return (
          <li key={row.team.rosterId}>
            <article
              className={`h-full rounded-card border bg-surface/50 p-3.5 ${
                isYou ? "border-brand-purple/60" : "border-line"
              }`}
            >
              <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-bold text-ink">
                <span className="truncate">{row.team.ownerName}</span>
                {isYou && (
                  <span className="shrink-0 rounded-full border border-brand-purple/50 bg-brand-purple/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
                    You
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-xs font-semibold tabular-nums text-brand-cyan">
                  {row.pulse.meanStartingPoints.toFixed(1)} pts/wk
                </span>
              </h4>
              <ul role="list" className="mt-2.5 space-y-1.5">
                {PULSE_POSITIONS.map((position) => (
                  <PositionBar
                    key={position}
                    position={position}
                    points={row.pulse.positionPoints[position] ?? 0}
                    peak={peak}
                  />
                ))}
              </ul>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

function PositionBar({
  position,
  points,
  peak,
}: {
  position: PulsePosition;
  points: number;
  peak: number;
}) {
  const pct = Math.max(0, Math.min(100, (points / peak) * 100));
  return (
    <li className="flex items-center gap-2">
      <span
        className={`w-11 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] font-bold tracking-[0.12em] ${POSITION_BADGE[position]}`}
      >
        {position}
      </span>
      {/* The bar is decorative: the number beside it carries the value, so a
          screen reader hears the points rather than a percentage of a scale it
          cannot see. */}
      <span aria-hidden="true" className="h-1.5 min-w-0 flex-1 rounded-full bg-base">
        <span
          className="block h-1.5 rounded-full bg-brand-cyan/70"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-ink-muted">
        {points > 0 ? points.toFixed(1) : "0.0"}
        <span className="sr-only"> points per week</span>
      </span>
    </li>
  );
}
