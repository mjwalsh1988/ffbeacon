"use client";

import Link from "next/link";
import { X, Users, CalendarDays, Trophy, ArrowRight } from "lucide-react";
import type { SleeperLeague } from "@/lib/sleeper";
import { SlideUpDialog } from "@/components/slide-up-dialog";

/**
 * Slide-up modal showing the deep details for a single Sleeper league —
 * teams, season, status, roster shape — and the action button that syncs
 * the league into our DB and opens its deep view.
 */
export function LeagueDetailSheet({
  league,
  open,
  onClose,
  sleeperUsername,
  statusDisplay,
  statusTone,
}: {
  league: SleeperLeague;
  open: boolean;
  onClose: () => void;
  /** Forwarded to the Open League server action so the deep view can
   * default its team-filter chip bar to the user's roster. */
  sleeperUsername: string | null;
  /** Human-readable status string (e.g. "In season"). */
  statusDisplay: string;
  /** Tailwind classes for the status badge background + text. */
  statusTone: string;
}) {
  const positions = aggregatePositions(league.roster_positions ?? []);
  // Plain link to the deep view so the branded loading boundary shows
  // instantly on click; the deep-view page runs the sync under the loader.
  // ?name= gives the deep view a correct <title> on first open, before the
  // league row is synced (the DB name takes precedence once it exists).
  const hrefParams = new URLSearchParams();
  if (sleeperUsername) {
    hrefParams.set("tab", "teams");
    hrefParams.set("username", sleeperUsername);
  }
  hrefParams.set("name", league.name);
  const href = `/leagues/${league.league_id}?${hrefParams.toString()}`;

  return (
    <SlideUpDialog
      open={open}
      onClose={onClose}
      label={`${league.name} details`}
    >
      <div className="flex h-full flex-col">
        {/* Header — name + close. The close button is the first focusable
            element so screen reader users can dismiss without tab-trawling. */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              League details
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-ink sm:text-xl">
              {league.name}
            </h2>
            <div className="mt-2 inline-flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`}
              >
                {statusDisplay}
              </span>
              <span className="text-xs text-ink-subtle">
                {league.season} · {league.total_rosters} teams
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close league details"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body — stays inside the sheet so the header and
            footer remain visible on small viewports. */}
        <div className="beacon-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          <dl className="grid grid-cols-3 gap-3">
            <FactCard
              icon={Users}
              label="Teams"
              value={String(league.total_rosters)}
            />
            <FactCard
              icon={CalendarDays}
              label="Season"
              value={league.season}
            />
            <FactCard
              icon={Trophy}
              label="Status"
              value={statusDisplay}
            />
          </dl>

          <section aria-labelledby="roster-heading" className="mt-6">
            <h3
              id="roster-heading"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
            >
              Roster composition
            </h3>
            {positions.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                No roster positions reported by Sleeper for this league.
              </p>
            ) : (
              <ul
                role="list"
                aria-label="Starting roster positions and counts"
                className="mt-3 flex flex-wrap gap-2"
              >
                {positions.map((entry) => (
                  <PositionPill key={entry.position} entry={entry} />
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-subtle">
              Bench slots are excluded. Counts include FLEX, SUPER_FLEX, and
              IDP positions exactly as Sleeper publishes them.
            </p>
          </section>
        </div>

        {/* Footer action — primary CTA stays visible without scrolling. */}
        <div className="border-t border-line bg-surface px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              Opens the deep view, including rosters, transactions, and power
              rankings.
            </p>
            <Link
              href={href}
              aria-label={`Open ${league.name} deep view`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Open league
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </SlideUpDialog>
  );
}

/* ---------- Roster aggregation ---------- */

type PositionEntry = { position: string; count: number };

/**
 * Collapses Sleeper's raw `roster_positions` array (e.g.
 * ["QB","RB","RB","WR","WR","WR","TE","FLEX","FLEX","K","DEF","BN","BN"])
 * into an aggregated count per slot type, skipping bench, and sorted by
 * a stable starting-lineup order with anything unknown trailing.
 */
function aggregatePositions(raw: string[]): PositionEntry[] {
  const counts = new Map<string, number>();
  for (const slot of raw) {
    if (slot === "BN") continue;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  const order = ["QB", "RB", "WR", "TE", "FLEX", "REC_FLEX", "SUPER_FLEX", "K", "DEF", "IDP_FLEX", "DL", "LB", "DB"];
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

/**
 * Friendlier label per slot type. Falls back to the raw token so an
 * unrecognized future Sleeper format still renders something useful.
 */
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

function PositionPill({ entry }: { entry: PositionEntry }) {
  const label = POSITION_LABEL[entry.position] ?? entry.position;
  return (
    <li>
      <span
        aria-label={`${entry.count} ${label} slot${entry.count === 1 ? "" : "s"}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs"
      >
        <span className="font-mono font-semibold text-brand-cyan">{label}</span>
        <span aria-hidden="true" className="text-ink-subtle">×</span>
        <span className="font-semibold tabular-nums text-ink">
          {entry.count}
        </span>
      </span>
    </li>
  );
}

function FactCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-line bg-base/60 p-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
        {label}
      </dt>
      <dd className="mt-1.5 truncate text-base font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}
