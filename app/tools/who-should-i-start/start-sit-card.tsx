/**
 * One player's card on the Who Should I Start board.
 *
 * Plan: docs/seo/who-should-i-start-and-site-seo-plan.md section 2.5 item 2
 * ("The card row") and section 2.14 (the accessibility contract). Server
 * component; the only client code under it is ImageWithFallback inside the
 * headshot and the team logos.
 *
 * THE CALL IS THE LOUDEST THING ON THE CARD. A player the verdict says to
 * start gets a full-width "Start this player" banner across the top of the
 * card, a green border and glow around the whole card, and a gradient frame
 * on the headshot. A SIT card has a quiet banner in the same place and a
 * plain border. The banner always carries the word, so none of this is
 * colour alone.
 *
 * READING ORDER. The DOM order is the order a screen reader hears: the
 * player's name (the h3, which is also the article's accessible name), the
 * call ("Start this player", plus "Starter 1 of 2" when more than one
 * starts), the position, team and opponent line, the projected points and
 * their range, the matchup, the game environment, reliability, recent form,
 * an injury pill when present, and the market line. The banner is drawn
 * ABOVE the name through explicit CSS grid rows while sitting right AFTER it
 * in the DOM, so a sighted reader sees the answer first and a screen reader
 * hears the name and then the answer, before any of the numbers that explain
 * it (section 2.5's own instruction). That is the one place visual and DOM
 * order differ, by one element, and nothing in it is focusable, so the tab
 * order is unaffected.
 *
 * WHY NOT <Panel> ANY MORE. The first version wrapped
 * components/dashboard-panel.tsx Panel (as="div"). Panel's header is a fixed
 * band with the action slot on the right, which left no way to run a banner
 * across the full width of the card or to frame a START card differently
 * from a SIT card. The article is still the card's only landmark, named by
 * its h3, exactly as before.
 *
 * EVERY FIGURE IS ONE TEXT NODE. A missing number renders a visible dash
 * with the reason a screen reader needs in an sr-only span INSIDE the same
 * element, never a hidden twin beside a visible one. The two drawings on the
 * card (the range strip and the recent form chart) are aria-hidden art whose
 * every value is text on the card, the pattern components/chart-kit.tsx uses.
 *
 * BYE AND "OUT" HANDLING.
 *   - Bye: projection.onBye replaces the points, matchup and environment
 *     block (the numbers that depend on a game being played this week) with
 *     a single "On bye" line. Reliability, recent form, an injury pill and
 *     the market line still render, since none of those depend on this
 *     week's game. The card decides this from projection.onBye directly, the
 *     same source of truth the loader used to make the SIT call, so the card
 *     cannot show "On bye" while claiming the player started.
 *   - Out: projection.availability === "out" does not blank the block. When
 *     points is null (the expected case for a player ruled out) the sr-only
 *     reason says "Ruled out for Week {week}" instead of the generic "no
 *     projection" sentence, and the matchup and environment rows still
 *     render, since those describe the team's game, not the player's own
 *     participation. An injury_status of "Out" repeats the fact as the injury
 *     pill; the two fields come from different tables and can disagree.
 *   - A missing figure anywhere else (no matchup multiplier, no published
 *     line, too few graded weeks, no market row supplied) renders as a real
 *     sentence stating the absence, never a blank cell and never a zero.
 */

import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck,
  CircleCheck,
  CircleMinus,
  Flame,
  Gem,
  HeartPulse,
  Shield,
  Target,
  Trophy,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { BeaconValue } from "@/components/beacon-value-icon";
import type { StartSitCall } from "@/components/start-sit-badge";
import { opponentLabel, pctLabel } from "@/components/league-schedule/format";
import { ordinal } from "@/lib/league-team-status";
import { ENVIRONMENT_TIER_LABEL, type EnvironmentTier } from "@/lib/nfl-game-environment";
import { matchupPhrase } from "@/lib/breakdown/scoring";
import { MIN_GRADED_WEEKS } from "@/lib/start-sit/reasons";
import { POSITION_BADGE, POSITION_BADGE_FALLBACK } from "@/lib/on-the-clock/position-colors";
import type { StartSitCandidate, StartSitProjection, PulsePosition } from "@/lib/start-sit/types";
import { ProjectionRange } from "./projection-range";
import { RecentFormChart, type RecentForm } from "./recent-form-chart";

/** Market context for the header source, page-supplied. Omitted entirely when the page has none to show. */
export type StartSitCardMarket = {
  value: number | null;
  overallRank: number | null;
  sourceName: string;
  isBeacon: boolean;
};

/**
 * "row": the card sits in the horizontal scroll row (the default; the board
 * reader can also request the stacked list). "stack": the "Show as a list"
 * vertical layout. Only the id changes between the two; the width is set by
 * the list item the board wraps the card in, and nothing is hidden or
 * reordered.
 */
export type StartSitCardLayout = "row" | "stack";

/**
 * Sentence-case position plurals, for the matchup row's "ranks 4th in points
 * allowed to running backs" clause. Duplicated from the private
 * POSITION_PLURAL in lib/start-sit/reasons.ts rather than imported: that map
 * is not exported. If reasons.ts ever exports it this should import it.
 */
const POSITION_PLURAL: Record<PulsePosition, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

/**
 * Mirrors the private statusTone() in components/player-profile/injury-status.tsx,
 * which does not export the helper. If it ever does, this should import it.
 */
type InjuryTone = "danger" | "warning" | "success";

function injuryTone(status: string): InjuryTone {
  const s = status.toLowerCase();
  if (["out", "ir", "pup", "nfi", "doubtful", "suspend", "reserve"].some((k) => s.includes(k))) {
    return "danger";
  }
  if (["probable", "active", "full", "cleared"].some((k) => s.includes(k))) return "success";
  return "warning";
}

/**
 * Red TEXT on a red-tinted pill is red-400 (#F87171), not signal.danger
 * (#EF4444). On a START card the green shell lightens the ground under the
 * pill and #EF4444 falls to about 4.4:1 there, just under AA for 11px bold;
 * #F87171 measures about 5:1 on the same ground. Border and tint keep the
 * signal colour. Same rule in PILL_TONE below.
 */
const INJURY_PILL_TONE: Record<InjuryTone, string> = {
  danger: "border-signal-danger/40 bg-signal-danger/15 text-red-400",
  warning: "border-signal-warning/40 bg-signal-warning/15 text-signal-warning",
  success: "border-signal-success/40 bg-signal-success/15 text-signal-success",
};

/**
 * The tone of the word pill beside a matchup or a game environment. The
 * matchup bands are matchupPhrase's own thresholds in lib/breakdown/scoring.ts
 * (1.02 and up is favorable or better, above 0.98 is neutral, above 0.92 is
 * tough), so the colour can never disagree with the word printed in it.
 */
type PillTone = "good" | "neutral" | "warn" | "bad";

const PILL_TONE: Record<PillTone, string> = {
  good: "border-signal-success/40 bg-signal-success/15 text-signal-success",
  neutral: "border-line-accent bg-surface-elevated text-ink-muted",
  warn: "border-signal-warning/40 bg-signal-warning/15 text-signal-warning",
  bad: "border-signal-danger/40 bg-signal-danger/15 text-signal-danger",
};

function matchupTone(multiplier: number): PillTone {
  if (multiplier >= 1.02) return "good";
  if (multiplier > 0.98) return "neutral";
  if (multiplier > 0.92) return "warn";
  return "bad";
}

const ENVIRONMENT_TONE: Record<EnvironmentTier, PillTone> = {
  high: "good",
  neutral: "neutral",
  low: "warn",
};

const START_SHELL =
  "border-signal-success/70 bg-gradient-to-b from-signal-success/[0.13] via-surface/70 to-surface/50";
const SIT_SHELL = "border-line bg-surface/40";
const START_GLOW: CSSProperties = {
  boxShadow: "0 0 0 1px rgba(16, 185, 129, 0.35), 0 28px 64px -34px rgba(16, 185, 129, 0.75)",
};

/** One decimal, for a points figure that is never negative. */
function pts(value: number): string {
  return value.toFixed(1);
}

/** A labelled row with an icon tile: the matchup, the game environment, the small-sample sentence. */
function MetricRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-line bg-base/30 px-3 py-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-accent bg-surface-elevated text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
        <div className="mt-1 text-sm leading-snug text-ink">{children}</div>
      </div>
    </div>
  );
}

/** A small figure tile with an icon: beat rate, availability, value, rank. */
function MiniStat({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-base/30 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums text-ink">{children}</p>
    </div>
  );
}

function TonePill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`mr-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The call, as a band across the full width of the card. START is a solid
 * green band with near-black text (about 8:1 at its darkest end); SIT is a
 * quiet surface band. The rank chip only appears when more than one player
 * starts, since "Starter 1 of 1" says nothing the banner has not.
 */
function CallBanner({
  isStart,
  rank,
  total,
  reason,
  className,
}: {
  isStart: boolean;
  rank?: number;
  total?: number;
  reason?: string;
  className: string;
}) {
  if (isStart) {
    const showRank = rank != null && total != null && total > 1;
    return (
      <p
        className={`flex items-center justify-between gap-2 bg-gradient-to-r from-signal-success to-emerald-400 px-4 py-2.5 text-[#07070D] ${className}`}
      >
        <span className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.12em]">
          <CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
          Start this player
        </span>
        {showRank && (
          <span className="shrink-0 rounded-full bg-[#07070D]/15 px-2.5 py-0.5 text-[11px] font-bold">
            <span className="sr-only">, </span>
            Starter {rank} of {total}
          </span>
        )}
      </p>
    );
  }
  return (
    <p
      className={`flex items-center justify-between gap-2 border-b border-line bg-surface-elevated/80 px-4 py-2.5 text-ink-muted ${className}`}
    >
      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
        <CircleMinus aria-hidden="true" className="h-4 w-4 shrink-0" />
        Sit this player
      </span>
      {reason && (
        <span className="shrink-0 rounded-full border border-line-accent bg-base px-2.5 py-0.5 text-[11px] font-semibold">
          <span className="sr-only">, </span>
          {reason}
        </span>
      )}
    </p>
  );
}

/** The headshot, or the team logo for a defense, in a frame that says which call it got. Decorative. */
function Portrait({ candidate, isStart }: { candidate: StartSitCandidate; isStart: boolean }) {
  const frame = isStart ? "bg-beacon p-[2px]" : "bg-line-accent p-px";
  return (
    <span aria-hidden="true" className={`block rounded-lg ${frame}`}>
      {candidate.position === "DEF" ? (
        <span className="flex h-16 w-16 items-center justify-center rounded-md bg-base">
          <NflTeamLogo team={candidate.team ?? candidate.sleeperId} size={48} />
        </span>
      ) : (
        <PlayerHeadshot sleeperId={candidate.sleeperId} name="" size={64} className="!border-0" />
      )}
    </span>
  );
}

export function StartSitCard({
  candidate,
  projection,
  call,
  rank,
  total,
  reason,
  formatLabel,
  market,
  recentForm,
  scaleMax,
  layout = "row",
}: {
  candidate: StartSitCandidate;
  projection: StartSitProjection;
  call: StartSitCall;
  /** This player's place among the starters, e.g. rank=1 total=2 for "Starter 1 of 2". Ignored on a SIT card. */
  rank?: number;
  total?: number;
  /** A short reason shown on a SIT banner, e.g. "Bye week". Ignored on a START card. */
  reason?: string;
  /** The reader's format label, e.g. "PPR", shown beside the projected-points figure. */
  formatLabel: string;
  /** Value-source context under the header source. Omitted entirely when the page has none. */
  market?: StartSitCardMarket | null;
  /** The last graded weeks for the recent form chart. Null or absent renders the no-data sentence. */
  recentForm?: RecentForm | null;
  /** The shared top of the range strip's scale, the same number for every card on the board. */
  scaleMax: number;
  layout?: StartSitCardLayout;
}) {
  // layout is part of the id on purpose: start-sit-board.tsx mounts the row
  // layout and the stack layout for every player at once (card-row-toggle.tsx
  // only ever toggles `hidden`, it never unmounts either tree), so a
  // layout-less id would put two elements with the same id in the DOM for
  // every player and leave aria-labelledby resolving to whichever came first.
  const cardId = `start-sit-card-${layout}-${candidate.playerId}`;
  const headingId = `${cardId}-title`;
  const isStart = call === "start";
  const positionClass = POSITION_BADGE[candidate.position] ?? POSITION_BADGE_FALLBACK;

  const hasRange =
    Number.isFinite(projection.points) && Number.isFinite(projection.floor) && Number.isFinite(projection.ceiling);
  const pointsEmptyReason =
    projection.availability === "out"
      ? `Ruled out for Week ${projection.week}`
      : `No projection published yet for Week ${projection.week}`;

  const hasReliability =
    projection.weeksGraded >= MIN_GRADED_WEEKS &&
    projection.beatRate != null &&
    projection.availabilityRate != null;

  const environmentTotal = projection.environment?.impliedTotal ?? null;

  return (
    <article id={cardId} aria-labelledby={headingId} className="h-full">
      <div
        className={`relative flex h-full flex-col overflow-hidden rounded-modal border ${isStart ? START_SHELL : SIT_SHELL}`}
        style={isStart ? START_GLOW : undefined}
      >
        {/* Explicit grid rows: the banner is row 1 on screen and second in
            the DOM. See the header comment for why. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <h3
            id={headingId}
            className="mt-4 self-end pr-4 text-lg font-bold leading-tight tracking-tight text-ink [grid-column:2] [grid-row:2] sm:text-xl"
          >
            {candidate.name}
          </h3>
          <CallBanner
            isStart={isStart}
            rank={rank}
            total={total}
            reason={reason}
            className="[grid-column:1/-1] [grid-row:1]"
          />
          <div className="ml-4 mt-4 self-start [grid-column:1] [grid-row:2/span_2]">
            <Portrait candidate={candidate} isStart={isStart} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pr-4 text-xs [grid-column:2] [grid-row:3]">
            <span
              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${positionClass}`}
            >
              {candidate.position}
            </span>
            {candidate.team && (
              <span className="inline-flex items-center gap-1 font-semibold text-ink-muted">
                <NflTeamLogo team={candidate.team} size={16} />
                {candidate.team}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-ink-subtle">
              <NflTeamLogo team={projection.opponent} size={16} />
              {projection.opponent && <span className="sr-only">opponent </span>}
              {opponentLabel(projection.opponent)}
            </span>
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-4">
          {/* Projected points and their range, or the bye line in their place. */}
          {projection.onBye ? (
            <p className="rounded-card border border-line bg-base/40 px-4 py-4 text-base font-semibold text-ink-muted">
              On bye
            </p>
          ) : (
            <>
              <div
                className={`rounded-card border px-4 py-3.5 ${
                  isStart ? "border-signal-success/40 bg-base/60" : "border-line bg-base/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                    Projected points
                  </p>
                  <span className="rounded-full border border-line-accent bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                    {formatLabel}
                  </span>
                </div>
                <p
                  className={`mt-1.5 text-5xl font-extrabold leading-none tracking-tight ${
                    projection.points == null ? "text-ink-subtle" : "text-ink"
                  }`}
                >
                  {projection.points != null ? (
                    pts(projection.points)
                  ) : (
                    <>
                      {"--"}
                      <span className="sr-only"> {pointsEmptyReason}</span>
                    </>
                  )}
                </p>
                {hasRange && (
                  <ProjectionRange
                    floor={projection.floor as number}
                    points={projection.points as number}
                    ceiling={projection.ceiling as number}
                    scaleMax={scaleMax}
                    emphasis={isStart ? "start" : "sit"}
                  />
                )}
              </div>

              <MetricRow icon={Shield} label="Matchup">
                {projection.opponentMultiplier != null ? (
                  <>
                    <TonePill tone={matchupTone(projection.opponentMultiplier)}>
                      {matchupPhrase(projection.opponentMultiplier)}
                    </TonePill>
                    <span className="font-mono tabular-nums">
                      {projection.opponentMultiplier.toFixed(2)}x<span className="sr-only"> multiplier</span>
                    </span>
                    {projection.defenseRankVsPosition != null && projection.opponent && (
                      <span className="mt-1 block text-xs text-ink-muted">
                        <span className="sr-only">, </span>
                        {projection.opponent} ranks {ordinal(projection.defenseRankVsPosition)} in points allowed to{" "}
                        {POSITION_PLURAL[candidate.position]}
                      </span>
                    )}
                  </>
                ) : (
                  "No matchup data yet"
                )}
              </MetricRow>

              <MetricRow icon={Flame} label="Game environment">
                {environmentTotal != null && projection.environmentTier ? (
                  <>
                    <TonePill tone={ENVIRONMENT_TONE[projection.environmentTier]}>
                      {ENVIRONMENT_TIER_LABEL[projection.environmentTier]}
                    </TonePill>
                    <span className="font-mono tabular-nums">{environmentTotal.toFixed(1)}</span> implied team total
                  </>
                ) : (
                  "No line yet"
                )}
              </MetricRow>
            </>
          )}

          {/* Reliability: beat rate and availability, or the small-sample sentence. */}
          {hasReliability ? (
            <div className="grid grid-cols-2 gap-2">
              <MiniStat icon={Target} label="Beat rate">
                {pctLabel(projection.beatRate as number)}
              </MiniStat>
              <MiniStat icon={CalendarCheck} label="Availability">
                {pctLabel(projection.availabilityRate as number)}
              </MiniStat>
            </div>
          ) : (
            <MetricRow icon={Target} label="Reliability">
              {`Not enough graded weeks yet (${projection.weeksGraded} of ${MIN_GRADED_WEEKS}).`}
            </MetricRow>
          )}

          <RecentFormChart form={recentForm} />

          {/* Injury status, one line, only when present. */}
          {candidate.injuryStatus && (
            <p
              className={`inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-xs font-semibold ${INJURY_PILL_TONE[injuryTone(candidate.injuryStatus)]}`}
            >
              <HeartPulse aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {candidate.injuryStatus}
            </p>
          )}

          {/* Market value and overall rank under the header source. Omitted when the page supplies none. */}
          {market && (
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-3">
              <MiniStat icon={Gem} label={`Value (${market.sourceName})`}>
                {market.value != null && market.value > 0 ? (
                  <BeaconValue show={market.isBeacon}>{market.value.toLocaleString()}</BeaconValue>
                ) : (
                  <>
                    {"--"}
                    <span className="sr-only"> No market value on file</span>
                  </>
                )}
              </MiniStat>
              <MiniStat icon={Trophy} label="Overall rank">
                {market.overallRank != null ? (
                  `#${market.overallRank}`
                ) : (
                  <>
                    {"--"}
                    <span className="sr-only"> No overall rank on file</span>
                  </>
                )}
              </MiniStat>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
