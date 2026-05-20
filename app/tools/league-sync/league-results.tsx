"use client";

import { useState } from "react";
import { ChevronRight, ArrowRight, Users } from "lucide-react";
import type { SleeperLeague } from "@/lib/sleeper";
import { ensureLeagueAndOpen } from "@/app/leagues/actions";
import { LeagueDetailSheet } from "./league-detail-sheet";

/**
 * League results render in two different shapes by viewport:
 *
 * - **Desktop (md+)**: a full-width table with every column visible —
 *   league name, status pill, team count, and aggregated roster
 *   composition pills. Each row is a `<form>` wrapping a button that
 *   submits to `ensureLeagueAndOpen`, syncing the league and navigating
 *   straight to /leagues/[id]. No modal involved.
 * - **Mobile (<md)**: a compact 3-column table (Name, Status, chevron).
 *   Tapping a row opens the slide-up modal so the smaller viewport
 *   doesn't have to swallow every column inline.
 *
 * Two parallel tables (not one with `hidden md:table-cell`) because the
 * desktop row needs a `<form>` element wrapping its button, which would
 * be awkward to thread through a single shared markup tree.
 */
export function LeagueResults({
  leagues,
  sleeperUsername,
}: {
  leagues: SleeperLeague[];
  /** Season is part of each league row already, but kept here so the
   * server caller can keep its existing prop shape. */
  season: string;
  /** The Sleeper handle the user searched for. Forwarded into the deep
   * view's team-filter chip bar on "Open league". */
  sleeperUsername: string | null;
}) {
  const [openLeagueId, setOpenLeagueId] = useState<string | null>(null);
  const openLeague = leagues.find((l) => l.league_id === openLeagueId) ?? null;

  return (
    <section aria-labelledby="leagues-heading" className="mt-8">
      <h2 id="leagues-heading" className="sr-only">
        Your Sleeper leagues
      </h2>

      <DesktopTable leagues={leagues} sleeperUsername={sleeperUsername} />
      <MobileTable
        leagues={leagues}
        onOpen={(id) => setOpenLeagueId(id)}
      />

      {openLeague && (
        <LeagueDetailSheet
          league={openLeague}
          open={!!openLeague}
          onClose={() => setOpenLeagueId(null)}
          sleeperUsername={sleeperUsername}
          statusDisplay={describeStatus(openLeague.status).label}
          statusTone={describeStatus(openLeague.status).tone}
        />
      )}
    </section>
  );
}

/* ---------- Desktop table ---------- */

function DesktopTable({
  leagues,
  sleeperUsername,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Your Sleeper leagues. Click any row to sync the league into FF Beacon
          and open its deep view.
        </caption>
        <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">
              League
            </th>
            <th scope="col" className="px-3 py-3 text-center">
              Status
            </th>
            <th scope="col" className="px-3 py-3 text-center">
              Teams
            </th>
            <th scope="col" className="px-3 py-3 text-left">
              Roster
            </th>
            <th scope="col" className="w-10 px-2 py-3 text-right">
              <span className="sr-only">Open league</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leagues.map((league) => {
            const { label, tone } = describeStatus(league.status);
            const positions = aggregatePositions(league.roster_positions ?? []);
            return (
              <tr
                key={league.league_id}
                className="transition-colors hover:bg-surface/60 focus-within:bg-surface/60"
              >
                <td colSpan={5} className="p-0">
                  <form action={ensureLeagueAndOpen} className="contents">
                    <input
                      type="hidden"
                      name="sleeper_league_id"
                      value={league.league_id}
                    />
                    {sleeperUsername && (
                      <input
                        type="hidden"
                        name="sleeper_username"
                        value={sleeperUsername}
                      />
                    )}
                    <button
                      type="submit"
                      aria-label={`Open ${league.name}, ${label}, ${league.total_rosters} teams`}
                      className="group grid w-full grid-cols-[1fr_8rem_5rem_minmax(12rem,1.5fr)_2rem] items-center gap-3 px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold text-ink">
                          {league.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-subtle">
                          {league.season} season
                        </span>
                      </span>
                      <span className="flex justify-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}
                        >
                          {label}
                        </span>
                      </span>
                      <span className="flex items-center justify-center gap-1.5 font-mono tabular-nums text-ink-muted">
                        <Users
                          aria-hidden="true"
                          className="h-3.5 w-3.5 text-brand-cyan"
                        />
                        {league.total_rosters}
                      </span>
                      <span className="min-w-0">
                        <PositionPillRow positions={positions} />
                      </span>
                      <span className="flex justify-end text-ink-subtle group-hover:text-brand-cyan">
                        <ArrowRight
                          aria-hidden="true"
                          className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PositionPillRow({ positions }: { positions: PositionEntry[] }) {
  if (positions.length === 0) {
    return <span className="text-xs text-ink-subtle">No roster data</span>;
  }
  return (
    <ul
      role="list"
      aria-label="Starting roster positions and counts"
      className="flex flex-wrap gap-1.5"
    >
      {positions.map((entry) => {
        const label = POSITION_LABEL[entry.position] ?? entry.position;
        return (
          <li key={entry.position}>
            <span
              aria-label={`${entry.count} ${label} slot${entry.count === 1 ? "" : "s"}`}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-base px-2 py-0.5 text-[11px]"
            >
              <span className="font-mono font-semibold text-brand-cyan">
                {label}
              </span>
              <span aria-hidden="true" className="text-ink-subtle">
                ×
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {entry.count}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Mobile table ---------- */

function MobileTable({
  leagues,
  onOpen,
}: {
  leagues: SleeperLeague[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line md:hidden">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Your Sleeper leagues. Tap any row to open league details.
        </caption>
        <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">
              League
            </th>
            <th scope="col" className="px-3 py-3 text-center">
              Status
            </th>
            <th scope="col" className="w-10 px-2 py-3 text-right">
              <span className="sr-only">Open details</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leagues.map((league) => {
            const { label, tone } = describeStatus(league.status);
            return (
              <tr
                key={league.league_id}
                className="transition-colors hover:bg-surface/60"
              >
                <td colSpan={3} className="p-0">
                  <button
                    type="button"
                    onClick={() => onOpen(league.league_id)}
                    aria-haspopup="dialog"
                    aria-label={`Open details for ${league.name}, ${label}, ${league.total_rosters} teams`}
                    className="group grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-ink">
                        {league.name}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                        <Users
                          aria-hidden="true"
                          className="h-3 w-3 text-brand-cyan"
                        />
                        {league.total_rosters} teams · {league.season}
                      </span>
                    </span>
                    <span className="flex justify-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}
                      >
                        {label}
                      </span>
                    </span>
                    <span className="flex justify-end text-ink-subtle">
                      <ChevronRight
                        aria-hidden="true"
                        className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      />
                    </span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Roster aggregation ---------- */

type PositionEntry = { position: string; count: number };

/**
 * Collapses Sleeper's raw `roster_positions` array (e.g.
 * ["QB","RB","RB","WR","WR","WR","TE","FLEX","FLEX","K","DEF","BN","BN"])
 * into an aggregated count per slot type, skipping bench, sorted by a
 * stable starting-lineup order with anything unknown trailing.
 *
 * Duplicated from league-detail-sheet.tsx on purpose — the desktop row
 * needs the same shape but the two render contexts evolve at different
 * paces and pulling them through a shared util would couple them.
 */
function aggregatePositions(raw: string[]): PositionEntry[] {
  const counts = new Map<string, number>();
  for (const slot of raw) {
    if (slot === "BN") continue;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  const order = [
    "QB",
    "RB",
    "WR",
    "TE",
    "FLEX",
    "REC_FLEX",
    "SUPER_FLEX",
    "K",
    "DEF",
    "IDP_FLEX",
    "DL",
    "LB",
    "DB",
  ];
  return Array.from(counts.entries())
    .sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([position, count]) => ({ position, count }));
}

const POSITION_LABEL: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  REC_FLEX: "WR/TE",
  SUPER_FLEX: "SF",
  K: "K",
  DEF: "DEF",
  IDP_FLEX: "IDP FLEX",
  DL: "DL",
  LB: "LB",
  DB: "DB",
};

/* ---------- Status helpers ---------- */

/**
 * Map Sleeper's raw status string to a human label and a Tailwind tone
 * (background + text) for the badge. New states fall through to a
 * neutral capitalized label so the UI doesn't crash if Sleeper adds one.
 */
function describeStatus(raw: string): { label: string; tone: string } {
  switch (raw) {
    case "in_season":
      return {
        label: "In season",
        tone: "bg-signal-success/15 text-signal-success",
      };
    case "drafting":
      return {
        label: "Drafting",
        tone: "bg-brand-cyan/15 text-brand-cyan",
      };
    case "pre_draft":
      return {
        label: "Pre-draft",
        tone: "bg-signal-warning/15 text-signal-warning",
      };
    case "complete":
      return {
        label: "Complete",
        tone: "bg-ink-subtle/15 text-ink-muted",
      };
    case "post_season":
      return {
        label: "Playoffs",
        tone: "bg-brand-purple/15 text-brand-purple",
      };
    default:
      return {
        label: raw
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        tone: "bg-surface text-ink-muted",
      };
  }
}
