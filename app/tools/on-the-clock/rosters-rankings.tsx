"use client";

/**
 * Rosters & Rankings tab for the On The Clock draft room. Two sub-views:
 *   - Power rankings: every team so far ordered by total FF Beacon value
 *     (drafted players + estimated future picks), the connected user's team
 *     highlighted.
 *   - My team: the connected user's team only.
 *
 * Each team renders as a horizontal grid of position columns (QB/RB/WR/TE) plus
 * a future-picks column, mirroring the League Pulse team layout. Only DRAFTED
 * players appear, so every team reads at a glance. Full width: the parent hides
 * the right rail while this tab is open.
 */

import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import {
  ROSTER_POSITIONS,
  type RosterFuturePick,
  type RosterPlayerLite,
  type RosterPosition,
  type TeamRollup,
} from "@/lib/on-the-clock/rosters";
import { POSITION_BADGE } from "@/lib/on-the-clock/position-colors";
import { EmptyCard } from "./states";

function fmt(v: number): string {
  return Math.round(v).toLocaleString();
}

function ordinalRound(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

export function RostersRankings({
  teams,
  myRosterId,
  boardReady,
}: {
  teams: TeamRollup[];
  myRosterId: number | null;
  boardReady: boolean;
}) {
  const hasMine = myRosterId != null && teams.some((t) => t.isYou);
  const [subView, setSubView] = useState<"all" | "mine">("all");
  const myTeam = teams.find((t) => t.isYou) ?? null;

  if (!boardReady) {
    return (
      <EmptyCard
        title="FF Beacon values are not available yet."
        body="Rosters & Rankings ranks teams by FF Beacon value. Once this format's FF Beacon rankings are published, every team's drafted value and future picks will appear here."
      />
    );
  }
  if (teams.length === 0) {
    return (
      <EmptyCard
        title="No teams to rank yet."
        body="Teams appear here as soon as the draft has rosters. Press Sync draft to pull the latest."
      />
    );
  }

  const showMine = subView === "mine" && hasMine;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Rosters and rankings
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Every team so far by FF Beacon value: drafted players plus their future draft picks.
            {showMine ? " Your team only." : " Ordered by power ranking."} Future pick values are
            estimates.
          </p>
        </div>
        <div
          role="group"
          aria-label="Roster view"
          className="inline-flex overflow-hidden rounded-card border border-line"
        >
          <button
            type="button"
            aria-pressed={subView === "all"}
            onClick={() => setSubView("all")}
            className={`inline-flex min-h-11 items-center px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan ${
              subView === "all" ? "bg-beacon text-black" : "bg-base text-ink-muted hover:text-ink"
            }`}
          >
            Power rankings
          </button>
          <button
            type="button"
            aria-pressed={subView === "mine"}
            disabled={!hasMine}
            onClick={() => setSubView("mine")}
            className={`inline-flex min-h-11 items-center px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50 ${
              subView === "mine" && hasMine
                ? "bg-beacon text-black"
                : "bg-base text-ink-muted hover:text-ink"
            }`}
          >
            My team
          </button>
        </div>
      </div>

      {!hasMine && (
        <p className="rounded-card border border-dashed border-line bg-surface/40 px-3 py-2 text-xs text-ink-subtle">
          We could not detect which team is yours, so the My team view is unavailable. Make a pick
          or check your Sleeper username to enable it.
        </p>
      )}

      {showMine && myTeam ? (
        <TeamRosterCard team={myTeam} />
      ) : (
        <ol role="list" className="space-y-3">
          {teams.map((t) => (
            <li key={t.rosterId}>
              <TeamRosterCard team={t} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TeamRosterCard({ team }: { team: TeamRollup }) {
  return (
    <article
      aria-label={`Power ranking ${team.rank}. ${team.ownerName}${
        team.teamName ? `, team ${team.teamName}` : ""
      }${team.isYou ? ", your team" : ""}. FF Beacon value ${fmt(team.totalValue)}.`}
      className={`overflow-hidden rounded-card border bg-surface/60 ${
        team.isYou ? "border-brand-purple/60 ring-1 ring-inset ring-brand-purple/40" : "border-line"
      }`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line p-4">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-purple/15 font-mono text-sm font-bold text-brand-purple"
        >
          {team.rank}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base font-semibold text-ink">
            <span className="truncate">{team.ownerName}</span>
            {team.teamName && (
              <span className="truncate text-xs font-normal text-ink-subtle">{team.teamName}</span>
            )}
            {team.isYou && (
              <span className="shrink-0 rounded-full border border-brand-purple/50 bg-brand-purple/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
                You
              </span>
            )}
          </h4>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {team.playerCount} drafted · {team.futurePicks.length} future pick
            {team.futurePicks.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold tabular-nums text-ink">
            {fmt(team.totalValue)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-ink-subtle">FF Beacon value</p>
        </div>
      </header>

      <div className="p-4">
        <TeamPositionGrid team={team} />
      </div>
    </article>
  );
}

/**
 * The position columns (QB/RB/WR/TE, always shown even when empty) plus the future
 * picks column (with its show-more toggle) for one team. Exported so the board view
 * can render the connected user's roster with the exact same layout as this tab.
 */
export function TeamPositionGrid({ team }: { team: TeamRollup }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {ROSTER_POSITIONS.map((pos) => (
        <PositionColumn
          key={pos}
          position={pos}
          players={team.players[pos]}
          total={team.positionTotals[pos]}
        />
      ))}
      <FuturePicksColumn picks={team.futurePicks} total={team.futurePicksValue} />
    </div>
  );
}

function PositionColumn({
  position,
  players,
  total,
}: {
  position: RosterPosition;
  players: RosterPlayerLite[];
  total: number;
}) {
  return (
    <section
      aria-label={`${position}: ${players.length} drafted, total value ${fmt(total)}`}
      className="flex min-w-0 flex-col rounded-card border border-line bg-base"
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-[0.16em] ${POSITION_BADGE[position]}`}
        >
          {position}
        </span>
        <span className="font-mono text-xs font-semibold tabular-nums text-ink">{fmt(total)}</span>
      </header>
      {players.length === 0 ? (
        <p className="px-3 py-3 text-xs italic text-ink-subtle">No {position}s</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {players.map((p) => (
            <li key={p.pickNo} className="flex items-center gap-2 px-3 py-1.5">
              <span aria-hidden="true" className="shrink-0">
                <PlayerHeadshot sleeperId={p.sleeperId} name="" position={p.position} size={22} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={p.name}>
                {p.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-subtle">
                {p.value > 0 ? fmt(p.value) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PICKS_COLLAPSED_MAX = 5;

function FuturePicksColumn({ picks, total }: { picks: RosterFuturePick[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const canToggle = picks.length > PICKS_COLLAPSED_MAX;
  const visible = expanded || !canToggle ? picks : picks.slice(0, PICKS_COLLAPSED_MAX);
  const hiddenCount = picks.length - visible.length;

  return (
    <section
      aria-label={`Future picks: ${picks.length}, estimated total value ${fmt(total)}`}
      className="flex min-w-0 flex-col rounded-card border border-line bg-base"
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <span className="rounded-md bg-ink/10 px-1.5 py-0.5 text-[11px] font-bold tracking-[0.16em] text-ink">
          PICKS
        </span>
        <span className="font-mono text-xs font-semibold tabular-nums text-ink">{fmt(total)}</span>
      </header>
      {picks.length === 0 ? (
        <p className="px-3 py-3 text-xs italic text-ink-subtle">No future picks</p>
      ) : (
        <>
          <ul id={listId} className="divide-y divide-line/60">
            {visible.map((p, i) => (
              <li
                key={`${p.season}-${p.round}-${p.originalRosterId}-${i}`}
                className="flex items-baseline gap-2 px-3 py-1.5"
              >
                <span className="shrink-0 font-mono text-sm font-medium text-ink">
                  {p.season} {ordinalRound(p.round)}
                </span>
                {!p.isOwn && p.viaTeamName && (
                  <span
                    className="truncate text-[10px] text-ink-subtle"
                    title={`via ${p.viaTeamName}`}
                  >
                    via {p.viaTeamName}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-ink-subtle">
                  {fmt(p.value)}
                </span>
              </li>
            ))}
          </ul>
          {canToggle && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={listId}
              className="flex min-h-11 items-center justify-center gap-1 border-t border-line px-3 py-2 text-xs font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {expanded ? (
                <>
                  Show less
                  <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Show {hiddenCount} more
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          )}
        </>
      )}
    </section>
  );
}
