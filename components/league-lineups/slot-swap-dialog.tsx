"use client";

/**
 * "What if I started him instead?"
 *
 * Opened from the slot button beside a player's portrait on the lineup board.
 * Pick anyone on the bench who is allowed to hold that slot, and the panel says
 * what the change does to three numbers at once: the points the lineup is
 * projected to score, the chance of winning this week's matchup, and how much
 * is still sitting on the bench afterwards.
 *
 * IT IS A PREVIEW, NOT A CONTROL, and it says so. Nothing here writes to
 * Sleeper, because nothing in FF Beacon does: we hold read access to a league
 * and no authority to set anybody's lineup. Presenting the panel as though it
 * moved a player would be the single most damaging thing this page could get
 * wrong, so the wording is "if you started him" throughout and the footnote
 * names where the change actually has to be made.
 *
 * EVERY NUMBER IS ARITHMETIC ON WHAT IS ALREADY ON THE PAGE. See
 * lib/league-lineups/simulate.ts: no server action, no round trip, no second
 * model. That is also why it is instant, and why opening it twenty times costs
 * nothing.
 *
 * THE ELIGIBILITY IS THE LEAGUE'S OWN. A flex takes running backs, receivers
 * and tight ends; a superflex takes those plus quarterbacks; a QB slot takes
 * quarterbacks. That mapping is lib/power-pulse/types.ts PULSE_SLOT_ELIGIBILITY,
 * the same one the optimiser fills against, so this dialog can never offer a
 * swap the optimiser would consider illegal.
 *
 * THE LIST IS ORDERED BY PROJECTION AND NOT BY VERDICT. The best available
 * option is first because that is the useful order, but no row is marked as the
 * right answer: a manager benching a higher projection for a reason the model
 * cannot see (a game they will not be able to watch, an injury report at 4pm)
 * is making a decision this panel has no standing to grade.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { CHIP, fmtPoints, fmtSigned, opponentLabel, pctLabel } from "@/components/league-schedule/format";
import {
  eligiblePositionsFor,
  pointsDirection,
  probabilityDirection,
  simulateSwap,
  swapCandidates,
  type LineupBaseline,
} from "@/lib/league-lineups/simulate";
import type { LineupPlayer } from "@/lib/league-lineups/types";

/** What the board hands over when a slot button is pressed. */
export type SwapTarget = {
  /** Sleeper's own slot token, "RB" / "FLEX" / "SUPER_FLEX". */
  token: string;
  /** The short label on the board, "FLEX". */
  label: string;
  /** The long form, "flex, any running back, receiver or tight end". */
  description: string;
  /** Who is in it now. Null when the manager left it empty. */
  player: LineupPlayer | null;
};

/** "quarterbacks, running backs, receivers or tight ends" */
const POSITION_PLURAL: Record<string, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "team defenses",
};

function eligibleWords(token: string): string {
  const parts = eligiblePositionsFor(token).map((p) => POSITION_PLURAL[p] ?? `${p} players`);
  if (parts.length === 0) return "no position we publish projections for";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

export function SlotSwapDialog({
  target,
  bench,
  baseline,
  week,
  opponentName,
  onClose,
}: {
  /** Null closes the dialog. */
  target: SwapTarget | null;
  bench: LineupPlayer[];
  baseline: LineupBaseline;
  week: number;
  /** Named in the win probability row, so the figure has a subject. */
  opponentName: string | null;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const headingId = useId();
  const impactId = useId();

  // A new slot is a new question. Without this the previous slot's selection
  // survives into the next dialog and the impact panel opens already answering
  // something nobody asked.
  const token = target?.token ?? null;
  useEffect(() => {
    setSelectedId(null);
  }, [token, target?.player?.sleeperId]);

  const candidates = useMemo(
    () => (target ? swapCandidates(bench, target.token) : []),
    [bench, target],
  );

  if (!target) return null;

  const current = target.player;
  const selected = candidates.find((p) => p.sleeperId === selectedId) ?? null;
  const impact = selected
    ? simulateSwap({ baseline, outPlayer: current, inPlayer: selected })
    : null;

  // The two deltas that are rendered at a coarser precision than they are
  // computed at. See the note above the projected points row.
  const winProbShift =
    impact === null || impact.winProbBefore === null || impact.winProbAfter === null
      ? null
      : Math.round(impact.winProbAfter * 100) - Math.round(impact.winProbBefore * 100);
  const gapShift =
    impact === null || impact.gapBefore === null || impact.gapAfter === null
      ? null
      : shownDelta(impact.gapBefore, impact.gapAfter, 1);

  const title = `Week ${week}, ${target.label} slot`;

  return (
    <SlideUpDialog
      open
      onClose={onClose}
      label={title}
      labelledBy={headingId}
      closeLabel={`Close the ${target.label} what-if`}
    >
      <div className="px-5 pb-6 pt-1">
        <header className="border-b border-line pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            What if
          </p>
          <h2 id={headingId} className="mt-0.5 text-lg font-bold tracking-tight text-ink">
            {title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            This slot takes {eligibleWords(target.token)}. Pick anyone on your bench to see
            what starting him there would do. Nothing here changes your lineup.
          </p>
        </header>

        {/* WHO IS IN IT NOW. Stated before the alternatives, because every
            figure below is a difference from this player and a reader who does
            not know what they are being compared against cannot read one. */}
        <section aria-labelledby={`${headingId}-current`} className="mt-4">
          <h3
            id={`${headingId}-current`}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
          >
            Starting there now
          </h3>
          {current ? (
            <p className="mt-1.5 flex items-center gap-2.5 rounded-card border border-line bg-base/50 px-3 py-2.5">
              <span className="shrink-0">
                <PlayerHeadshot sleeperId={current.sleeperId} name="" size={32} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {current.name}
                </span>
                <span className="block truncate text-[11px] text-ink-muted">
                  {current.position}
                  {current.team ? `, ${current.team}` : ""}{" "}
                  {opponentLabel(current.nflOpponent, current.nflIsHome)}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono text-sm font-bold tabular-nums text-ink">
                {current.projected === null ? (
                  <span className="font-sans text-[11px] text-ink-subtle">No projection</span>
                ) : (
                  <>
                    {fmtPoints(current.projected)}
                    <span className="sr-only"> projected points</span>
                  </>
                )}
              </span>
            </p>
          ) : (
            <p className="mt-1.5 rounded-card border border-line bg-base/50 px-3 py-2.5 text-sm text-ink-muted">
              Nobody. The slot is empty, so anyone you start there adds his whole projection.
            </p>
          )}
        </section>

        {/* THE IMPACT, ABOVE THE LIST once something is picked. A reader who has
            just chosen a player should not have to hunt past twelve more of
            them for the answer, and on a phone the list is long.

            `role="status"` for the implicit aria-atomic: the whole block is
            replaced on every selection, so it has to be announced as one thing.

            IT STARTS EMPTY, and that is load bearing. A live region that is
            already populated when the portal mounts is announced on arrival, on
            top of the dialog's own name and the focus move, which buries all
            three. The invitation to pick somebody lives in the ordinary
            paragraph below instead, where it is read in place rather than
            fired at a reader who has just opened the panel. Same rule, same
            reason, as components/league-lineups/lineup-controls.tsx.

            A HEADING, because the block is roughly seventy words and atomic:
            heard once and gone. Without one there is no way back to it. */}
        <div id={impactId} role="status" aria-live="polite" className="mt-4">
          {impact && selected ? (
            <section
              aria-labelledby={`${headingId}-impact`}
              className="rounded-card border border-line-accent bg-base/60 p-4"
            >
              <h3
                id={`${headingId}-impact`}
                className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
              >
                What the change does
              </h3>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-relaxed text-ink">
                <span className="font-semibold">Start {selected.name}</span>
                {current && (
                  <>
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-subtle" />
                    <span className="text-ink-muted">over {current.name}</span>
                  </>
                )}
                <span className="sr-only">
                  {" "}
                  at {target.label}, {target.description}.
                </span>
              </p>

              <dl className="mt-3 space-y-2">
                {/* THE DELTA IS COMPUTED FROM THE DISPLAYED FIGURES, not from
                    the raw ones. Rounding the three independently prints rows
                    that do not add up: 100.44 to 100.46 rendered as "100.4 to
                    100.5, +0.0", and 52.6% to 53.2% as "53% to 53%, +1". */}
                <ImpactRow
                  term="Projected points"
                  before={fmtPoints(impact.pointsBefore)}
                  after={fmtPoints(impact.pointsAfter)}
                  delta={fmtSigned(shownDelta(impact.pointsBefore, impact.pointsAfter, 1))}
                  deltaWords={deltaWords(
                    shownDelta(impact.pointsBefore, impact.pointsAfter, 1),
                    "points",
                  )}
                  direction={pointsDirection(
                    shownDelta(impact.pointsBefore, impact.pointsAfter, 1),
                  )}
                />
                <ImpactRow
                  term={
                    opponentName
                      ? `Chance of beating ${opponentName}`
                      : "Chance of winning this week"
                  }
                  before={impact.winProbBefore === null ? null : pctLabel(impact.winProbBefore)}
                  after={impact.winProbAfter === null ? null : pctLabel(impact.winProbAfter)}
                  delta={
                    winProbShift === null ? null : `${fmtSigned(winProbShift, 0)}`
                  }
                  deltaWords={
                    winProbShift === null
                      ? null
                      : deltaWords(winProbShift, "percentage point")
                  }
                  direction={
                    winProbShift === null
                      ? "flat"
                      : probabilityDirection(winProbShift / 100)
                  }
                  missingNote="No win probability for this week yet. It needs a published matchup and a Power Pulse run for your opponent."
                />
                <ImpactRow
                  term="Still left on your bench"
                  before={impact.gapBefore === null ? null : fmtPoints(impact.gapBefore)}
                  after={impact.gapAfter === null ? null : fmtPoints(impact.gapAfter)}
                  delta={gapShift === null ? null : fmtSigned(gapShift)}
                  deltaWords={gapShift === null ? null : deltaWords(gapShift, "points")}
                  // A SMALLER GAP IS THE GOOD DIRECTION HERE, so the tone is
                  // inverted against the other two rows. Reusing the same
                  // mapping would paint "you left two fewer points on the
                  // bench" in the warning colour.
                  direction={invert(pointsDirection(gapShift ?? 0))}
                  missingNote="No best lineup to compare against, so there is no gap to report."
                />
              </dl>
            </section>
          ) : null}
        </div>

        {!selected && (
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            Pick a player below to see what starting him here would do.
          </p>
        )}

        <section aria-labelledby={`${headingId}-options`} className="mt-4">
          <h3
            id={`${headingId}-options`}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
          >
            On your bench, {candidates.length}{" "}
            {candidates.length === 1 ? "option" : "options"}
          </h3>

          {candidates.length === 0 ? (
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              Nobody on your bench can hold this slot. It takes{" "}
              {eligibleWords(target.token)}, and injured reserve and the taxi squad are left
              out because Sleeper will not let them start without a roster move.
            </p>
          ) : (
            <ul role="list" className="mt-1.5 space-y-2">
              {candidates.map((candidate) => {
                const gain =
                  (candidate.projected ?? 0) - (current?.projected ?? 0);
                const isSelected = candidate.sleeperId === selectedId;
                return (
                  <li key={candidate.sleeperId}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-controls={impactId}
                      onClick={() =>
                        setSelectedId(isSelected ? null : candidate.sleeperId)
                      }
                      className={`flex min-h-11 w-full items-center gap-2.5 rounded-card border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                        isSelected
                          ? "border-brand-cyan bg-brand-cyan/10"
                          : "border-line bg-base/50 hover:border-line-accent"
                      }`}
                    >
                      <span className="shrink-0">
                        <PlayerHeadshot sleeperId={candidate.sleeperId} name="" size={32} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {candidate.name}
                        </span>
                        <span className="block truncate text-[11px] text-ink-muted">
                          {candidate.position}
                          {candidate.team ? `, ${candidate.team}` : ""}{" "}
                          {opponentLabel(candidate.nflOpponent, candidate.nflIsHome)}
                        </span>
                        {candidate.injuryStatus && (
                          <span
                            className={`mt-1 ${CHIP} border-signal-warning/50 !py-0.5 !text-[10px] text-signal-warning`}
                          >
                            {candidate.injuryStatus}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm font-bold tabular-nums text-ink">
                          {fmtPoints(candidate.projected ?? 0)}
                          <span className="sr-only"> projected points</span>
                        </span>
                        <span
                          className={`block font-mono text-[11px] font-semibold tabular-nums ${
                            gain > 0.05
                              ? "text-brand-cyan"
                              : gain < -0.05
                                ? "text-signal-warning"
                                : "text-ink-subtle"
                          }`}
                        >
                          {fmtSigned(gain)}
                          <span className="sr-only">
                            {" "}
                            {deltaWords(gain, "points")} against the slot as it stands
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-ink-subtle">
          <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            A preview only. Make the change in Sleeper for it to count. The win probability
            is your lineup as you have it set against your opponent&apos;s best lineup, so it
            starts lower than the figure on the Schedules page, which assumes both teams
            start their best nine.
          </span>
        </p>
      </div>
    </SlideUpDialog>
  );
}

/**
 * The difference between two figures AS THEY ARE DRAWN.
 *
 * Rounding a before, an after and a delta independently produces rows that do
 * not reconcile, which is worse than a coarse figure: a reader who checks the
 * arithmetic on screen finds it wrong.
 */
function shownDelta(before: number, after: number, digits: number): number {
  const f = 10 ** digits;
  return (Math.round(after * f) - Math.round(before * f)) / f;
}

/** Up is good on two of the three rows and bad on the third. */
function invert(direction: "up" | "down" | "flat"): "up" | "down" | "flat" {
  if (direction === "up") return "down";
  if (direction === "down") return "up";
  return "flat";
}

/**
 * "up 2.6 points" / "down 3 percentage points" / "no change".
 *
 * `unit` is the SINGULAR, pluralised here, because "up 1 percentage points" is
 * the kind of sentence that makes a reader stop and reread a number.
 */
function deltaWords(delta: number, unit: "points" | "percentage point"): string {
  const magnitude = Math.abs(delta);
  if (magnitude < 0.05) return "no change";
  const digits = unit === "percentage point" ? 0 : 1;
  const shown = magnitude.toFixed(digits);
  const plural = Number(shown) === 1 ? unit : `${unit}s`;
  return `${delta > 0 ? "up" : "down"} ${shown} ${plural}`;
}

/**
 * One before-and-after line.
 *
 * NOTHING VISIBLE IS HIDDEN FROM THE ACCESSIBILITY TREE. The figures are read
 * exactly where they are drawn, with the units and the direction added as
 * visually hidden words beside them rather than as a parallel sentence that
 * replaces them. A reader pointing at "121.0" hears "121.0 points", not
 * silence, which is what an aria-hidden span over a visible number produces.
 */
function ImpactRow({
  term,
  before,
  after,
  delta,
  deltaWords: spokenDelta,
  direction,
  missingNote,
}: {
  term: string;
  before: string | null;
  after: string | null;
  delta: string | null;
  deltaWords: string | null;
  direction: "up" | "down" | "flat";
  missingNote?: string;
}) {
  const tone =
    direction === "up"
      ? "text-brand-cyan"
      : direction === "down"
        ? "text-signal-warning"
        : "text-ink-muted";

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2 first:border-0 first:pt-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
        {term}
      </dt>
      <dd className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums text-ink">
        {before === null || after === null ? (
          <span className="font-sans text-[11px] leading-relaxed text-ink-subtle">
            {missingNote ?? "Not available"}
          </span>
        ) : (
          <>
            <span className="text-ink-muted">{before}</span>
            <span className="sr-only"> now, </span>
            <ArrowRight aria-hidden="true" className="h-3 w-3 self-center text-ink-subtle" />
            <span className="font-bold">{after}</span>
            <span className="sr-only"> if you make the change, </span>
            <span className={`text-xs font-semibold ${tone}`}>
              {delta}
              <span className="sr-only"> {spokenDelta ?? ""}</span>
            </span>
          </>
        )}
      </dd>
    </div>
  );
}
