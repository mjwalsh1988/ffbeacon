/**
 * The two panels about the roster rather than the lineup: who is available to
 * pick up, and who you could afford to lose to make room.
 *
 * BOTH ARE FRAMED BY WHAT THE TEAM IS PLAYING FOR. lib/league-lineups/advice.ts
 * decides the order and the words from the team's Contender / Bubble /
 * Rebuilder standing, and the brief at the top of the waiver panel says which
 * one applies rather than leaving a reader to infer it from the ordering.
 *
 * NEITHER PANEL GIVES AN ORDER. The cut list is explicitly a list, cheapest
 * first, with the reason on each row, because the model sees projected points
 * and market value and does not see the handcuff whose stock jumped this
 * morning. The same restraint is why nothing here quotes a FAAB bid: pricing a
 * claim is a whole tool of its own at /tools/faab, and half an answer about
 * money on this page would compete with it.
 *
 * Server components. Presentational only.
 */

import Link from "next/link";
import { ArrowRight, Coins, Scissors, UserPlus } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { PlayerHeadshot } from "@/components/player-headshot";
import { CHIP, fmtPoints, opponentLabel } from "@/components/league-schedule/format";
import { goalBrief } from "@/lib/league-lineups/advice";
import { WAIVER_FIT_LABEL } from "@/lib/league-lineups/types";
import type { DropOption, WaiverState, WaiverSuggestion } from "@/lib/league-lineups/types";
import type { TeamStatus } from "@/lib/league-team-status";

const FIT_TONE: Record<WaiverSuggestion["fit"], string> = {
  "start-now": "border-brand-cyan/50 text-brand-cyan",
  depth: "border-line text-ink-muted",
  upside: "border-brand-purple/50 text-brand-purple",
};

export function WaiverPanel({
  suggestions,
  status,
  faabHref,
  state,
  week,
}: {
  suggestions: WaiverSuggestion[];
  status: TeamStatus | null;
  /** Where to go to price a bid properly. */
  faabHref: string;
  /** Why this panel holds what it holds. See LineupView.waiversState. */
  state: WaiverState;
  week: number;
}) {
  return (
    <Panel
      id="lineup-waivers"
      eyebrow="Free agents"
      title="Worth picking up"
      helper={state === "ok" ? goalBrief(status) : `Week ${week} has been played.`}
      headingLevel={2}
    >
      {/* FOUR DIFFERENT REASONS FOR AN EMPTY PANEL, and only one of them is
          "nothing helps you". Collapsing them would be the page lying about
          itself, which is the same rule every other empty state here follows. */}
      {state === "past-week" ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Nobody can be picked up for a week that is over. Switch to this week to see who is
          available.
        </p>
      ) : state === "no-format" ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          No ranking source covers this league&apos;s scoring, so there is no ordered list of
          free agents to search. Everything else on this page still works.
        </p>
      ) : state === "throttled" ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          This search is busy right now. Wait a minute and reload, and it will fill back in.
          Everything else on this page is unaffected.
        </p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Nothing available is projected to help this week. That usually means the league is
          deep and the waiver wire has been picked over.
        </p>
      ) : (
        <ul role="list" className="space-y-2.5">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.player.sleeperId}
              className="rounded-card border border-line bg-base/50 px-3 py-3"
            >
              <div className="flex items-start gap-3">
                {/* Decorative: the name is right beside it. */}
                <span aria-hidden="true" className="shrink-0">
                  <PlayerHeadshot sleeperId={suggestion.player.sleeperId} name="" size={32} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-semibold text-ink">
                      {suggestion.player.name}
                    </span>
                    <span className={`${CHIP} ${FIT_TONE[suggestion.fit]} !py-0.5 !text-[10px]`}>
                      {WAIVER_FIT_LABEL[suggestion.fit]}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {suggestion.player.position}
                    {suggestion.player.team ? `, ${suggestion.player.team}` : ""}{" "}
                    {opponentLabel(suggestion.player.nflOpponent, suggestion.player.nflIsHome)}
                    {suggestion.overallRank !== null && `, ranked ${suggestion.overallRank}`}
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
                    {suggestion.note}
                  </p>
                </div>

                {suggestion.pointsAdded > 0 && (
                  <p className="shrink-0 text-right">
                    <span className="block font-mono text-lg font-extrabold tabular-nums text-brand-cyan">
                      +{fmtPoints(suggestion.pointsAdded)}
                      <span className="sr-only"> points added to your best lineup</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="block text-[10px] uppercase tracking-wide text-ink-subtle"
                    >
                      pts
                    </span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3">
        <Link
          href={faabHref}
          className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[32px]"
        >
          <Coins aria-hidden="true" className="h-3.5 w-3.5" />
          Work out what to bid
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </p>
    </Panel>
  );
}

export function DropPanel({
  options,
  note,
  isKeeperLeague,
}: {
  options: DropOption[];
  /** Set when the search declined to name anybody, with the reason. */
  note: string | null;
  isKeeperLeague: boolean;
}) {
  return (
    <Panel
      id="lineup-drops"
      eyebrow="Roster space"
      title="Who you could cut"
      helper={
        isKeeperLeague
          ? "Players your lineup would miss least. A cut in a keeper league gives the player away for good, so anyone still worth real value is left off."
          : "Players your lineup would miss least, if you need a roster spot."
      }
      headingLevel={2}
    >
      {options.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">{note}</p>
      ) : (
        <ul role="list" className="space-y-2">
          {options.map((option) => (
            <li
              key={option.player.sleeperId}
              className="flex items-start gap-3 rounded-card border border-line bg-base/50 px-3 py-2.5"
            >
              <Scissors
                aria-hidden="true"
                className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-subtle"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {option.player.name}
                  <span className="ml-1.5 font-normal text-[11px] text-ink-muted">
                    {option.player.position}
                    {option.player.team ? `, ${option.player.team}` : ""}
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                  {option.note}
                </p>
              </div>
              {option.restOfSeasonPerWeek !== null && (
                <p className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-bold tabular-nums text-ink-muted">
                    {fmtPoints(option.restOfSeasonPerWeek)}
                    <span className="sr-only">
                      {" "}
                      projected points per week for the rest of the season
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="block text-[10px] uppercase tracking-wide text-ink-subtle"
                  >
                    per wk
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-subtle">
        <UserPlus aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          This is a list, not advice. It sees projected points and market value, and it
          cannot see a handcuff whose stock just moved or a player already inside a trade.
        </span>
      </p>
    </Panel>
  );
}
