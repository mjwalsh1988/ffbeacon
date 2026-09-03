/**
 * What the optimiser would change, and what each change is worth.
 *
 * THE LIST IS A PLAN, NOT A MENU. Every move comes out of ONE optimal fill (see
 * lib/league-lineups/build.ts), so making all of them produces exactly the
 * "Best lineup" figure in the summary above, and the gains add up to exactly
 * the gap. That is why the panel is allowed to say "these changes are worth
 * 14.2 points" as a single sentence: a list of independent best-swaps could not
 * make that claim, because taking the first changes what the second is worth.
 *
 * ORDERED LIST, DELIBERATELY. `<ol>` says there is a sequence and how long it
 * is, which is the first thing a screen reader user needs from a set of
 * instructions. A `<ul>` of divs would say neither.
 *
 * Server component. Presentational only.
 */

import { ArrowRight, CheckCircle2, Wand2 } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { PlayerHeadshot } from "@/components/player-headshot";
import { fmtPoints } from "@/components/league-schedule/format";
import type { LineupOptimization } from "@/lib/league-lineups/types";

export function OptimizerPanel({
  optimization,
  isFinal,
  week,
}: {
  optimization: LineupOptimization;
  isFinal: boolean;
  week: number;
}) {
  const { moves, pointsLeftOnBench, unavailable, unlistedGain, ungradedSlotCount } =
    optimization;

  // Something is on the bench, but every remaining swap is worth less than half
  // a point. That is a different answer from "your lineup is optimal", and the
  // summary above is already showing the gap, so saying nothing here would
  // leave two figures on one screen that do not reconcile.
  const onlyTinyMoves = moves.length === 0 && unlistedGain > 0;

  const helper = isFinal
    ? `What the best legal lineup for week ${week} would have scored, graded on what players actually did.`
    : `The changes that get your week ${week} lineup to the highest projected score it can reach.`;

  return (
    <Panel
      id="lineup-optimizer"
      eyebrow="Optimize"
      title={isFinal ? "What would have scored more" : "Changes worth making"}
      helper={helper}
      headingLevel={2}
      glow
    >
      {unavailable ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Nobody on this roster has a published projection for week {week}, so there is no
          best lineup to compare yours against. This fills in once Sleeper publishes the
          week.
        </p>
      ) : moves.length === 0 ? (
        <div className="flex items-start gap-3 rounded-card border border-brand-cyan/40 bg-brand-cyan/5 px-4 py-3">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-cyan" />
          <p className="text-sm leading-relaxed text-ink">
            {onlyTinyMoves ? (
              <>
                <span className="font-semibold">Your lineup is as good as it matters.</span>{" "}
                <span className="text-ink-muted">
                  The best swap left is worth {fmtPoints(unlistedGain)}
                  {" "}
                  {unlistedGain === 1 ? "point" : "points"}, which is inside the model&apos;s
                  own margin. Not worth changing a lineup over.
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold">
                  {isFinal
                    ? "You set the best lineup you had."
                    : "Your lineup is already the best one."}
                </span>{" "}
                <span className="text-ink-muted">
                  Nothing on your bench {isFinal ? "would have scored" : "projects"} more than
                  what you are starting.
                </span>
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          {/* THE HEADLINE, BEFORE THE LIST. A reader deciding whether to open
              Sleeper wants the total first; the moves are how to collect it. */}
          {pointsLeftOnBench !== null && (
            <p className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-3xl font-extrabold tabular-nums text-brand-purple sm:text-4xl">
                +{fmtPoints(pointsLeftOnBench)}
                <span className="sr-only"> more points</span>
              </span>
              <span className="text-sm leading-relaxed text-ink-muted">
                {isFinal
                  ? `across ${moves.length} ${moves.length === 1 ? "change" : "changes"} you could have made.`
                  : unlistedGain > 0
                    ? `across ${moves.length} ${moves.length === 1 ? "change" : "changes"} below, plus ${fmtPoints(unlistedGain)} in swaps too small to be worth making.`
                    : `across ${moves.length} ${moves.length === 1 ? "change" : "changes"}. Make all of them and your lineup is optimal.`}
              </span>
            </p>
          )}

          <ol className="space-y-2.5">
            {moves.map((move, index) => (
              <li
                key={`${move.inPlayer.sleeperId}-${move.slotLabel}-${index}`}
                className="rounded-card border border-line bg-base/50 px-3 py-3"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-accent bg-surface text-[11px] font-bold text-brand-cyan"
                  >
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* ONE SENTENCE, and it is the whole instruction. The
                        portraits are decorative beside it, so a reader hears
                        the move once rather than hearing two names with no
                        relationship stated between them. */}
                    <p className="text-sm leading-relaxed text-ink">
                      <span className="inline-flex items-center gap-1.5 align-middle">
                        <span aria-hidden="true" className="inline-flex">
                          <PlayerHeadshot sleeperId={move.inPlayer.sleeperId} name="" size={22} />
                        </span>
                        <span className="font-semibold">{move.inPlayer.name}</span>
                      </span>{" "}
                      <ArrowRight
                        aria-hidden="true"
                        className="inline h-3.5 w-3.5 align-middle text-ink-subtle"
                      />{" "}
                      <span className="font-semibold text-brand-cyan">{move.slotLabel}</span>
                      <span className="sr-only"> ({move.slotDescription})</span>
                      {move.outPlayer ? (
                        <span className="text-ink-muted">, over {move.outPlayer.name}</span>
                      ) : (
                        <span className="text-ink-muted">, which is empty right now</span>
                      )}
                    </p>

                    {move.requiresRosterMove && (
                      <p className="mt-1 text-[11px] leading-relaxed text-signal-warning">
                        He is on injured reserve or the taxi squad, so this needs a roster
                        move in Sleeper first.
                      </p>
                    )}
                  </div>

                  {/* One text node with its unit beside it, not a hidden
                      figure and a hidden sentence. Pointing at "+4.2" says
                      "plus 4.2 points, what this change is worth". */}
                  <p className="shrink-0 text-right">
                    <span className="block font-mono text-lg font-extrabold tabular-nums text-brand-purple sm:text-xl">
                      +{fmtPoints(move.pointsGained)}
                      <span className="sr-only"> more points from this change</span>
                    </span>
                    <span aria-hidden="true" className="block text-[10px] uppercase tracking-wide text-ink-subtle">
                      pts
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-subtle">
            <Wand2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Reshuffling players between slots is left out. Moving a receiver from WR2 to
              the flex changes nothing, so only players going in and out of the lineup are
              listed.
            </span>
          </p>
        </>
      )}

      {/* Slots neither total could measure. Almost always none. Said out loud
          because the alternative is a gap that quietly does not add up. */}
      {ungradedSlotCount > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
          {ungradedSlotCount} of your slots {ungradedSlotCount === 1 ? "holds a player" : "hold players"}{" "}
          we could not match to our player list, so {ungradedSlotCount === 1 ? "it is" : "they are"}{" "}
          left out of both totals above.
        </p>
      )}
    </Panel>
  );
}
