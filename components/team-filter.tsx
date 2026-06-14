"use client";

import { useMemo, useState } from "react";
import { TeamCard } from "@/components/team-card";
import { TeamChipBar, type TeamChipBarTeam } from "@/components/team-chip-bar";
import type { TeamCardData } from "@/lib/league-view-data";

export type TeamFilterProps = {
  teams: TeamCardData[];
  sleeperLeagueId: string;
  /** Sleeper username from `?username=` query param. When it matches a team's
   * owner display_name (case-insensitive), only that team is visible on first
   * paint. Anything else falls back to the full list. */
  searchedUsername?: string | null;
  /** Sleeper roster_id from `?roster=` query param (set by Power Rankings
   * row links). Takes priority over `searchedUsername` for the default
   * selection so deep-links zero in on the specific team. */
  focusedRosterId?: number | null;
  /** True when the league's selected value source is FF Beacon, forwarded to
   * each TeamCard so position subtotals render with the FF Beacon mark. */
  valueIsBeacon?: boolean;
};

/**
 * Orchestrates the chip-bar visibility filter that sits above the list of
 * TeamCards on /leagues/[id] (Teams tab). State lives here so the cards stay
 * pure presentational — toggling a chip mounts/unmounts cards rather than
 * scrolling to anchors. Default selection prefers the searched-username's
 * team (DPC parity); if no match, all teams are selected.
 */
export function TeamFilter({
  teams,
  sleeperLeagueId,
  searchedUsername,
  focusedRosterId,
  valueIsBeacon = false,
}: TeamFilterProps) {
  const ownerRosterId = useMemo(
    () => resolveOwnerRosterId(teams, searchedUsername, focusedRosterId),
    [teams, searchedUsername, focusedRosterId],
  );

  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<number>>(() => {
    if (ownerRosterId != null) return new Set([ownerRosterId]);
    return new Set(teams.map((t) => t.sleeperRosterId));
  });

  // Newly-toggled-on teams default to collapsed so a wall of expanded rosters
  // can't bury the user's own team. The searched-username's team auto-expands
  // on first paint; everything else starts as a one-line header card.
  const [expandedRosterIds, setExpandedRosterIds] = useState<Set<number>>(() => {
    if (ownerRosterId != null) return new Set([ownerRosterId]);
    return new Set();
  });

  const overallRankByRoster = useMemo(() => {
    const m: Record<number, number | null> = {};
    for (const t of teams) m[t.sleeperRosterId] = t.cacheRow?.overall_rank ?? null;
    return m;
  }, [teams]);

  const chipTeams: TeamChipBarTeam[] = useMemo(
    () =>
      teams.map((t) => ({
        rosterId: t.sleeperRosterId,
        teamName: t.teamName,
        ownerSleeperUsername: t.ownerSleeperUsername,
      })),
    [teams],
  );

  const visibleTeams = useMemo(() => {
    const fallback = Number.MAX_SAFE_INTEGER;
    return teams
      .filter((t) => selectedRosterIds.has(t.sleeperRosterId))
      .sort((a, b) => {
        const ra = a.cacheRow?.overall_rank ?? fallback;
        const rb = b.cacheRow?.overall_rank ?? fallback;
        if (ra !== rb) return ra - rb;
        return a.teamName.localeCompare(b.teamName);
      });
  }, [teams, selectedRosterIds]);

  const handleToggleRoster = (rosterId: number) => {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(rosterId)) {
        next.delete(rosterId);
        // De-expand when hiding so re-toggling later starts collapsed again.
        setExpandedRosterIds((p) => {
          if (!p.has(rosterId)) return p;
          const n = new Set(p);
          n.delete(rosterId);
          return n;
        });
      } else {
        // Newly visible teams come in collapsed — do NOT auto-add to expanded.
        next.add(rosterId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    setSelectedRosterIds((prev) => {
      const allOn = prev.size === teams.length && teams.length > 0;
      if (allOn) {
        setExpandedRosterIds(new Set());
        return new Set();
      }
      return new Set(teams.map((t) => t.sleeperRosterId));
    });
  };

  const handleToggleExpand = (rosterId: number) => {
    setExpandedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(rosterId)) next.delete(rosterId);
      else next.add(rosterId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div
        className="rounded-card border border-line bg-surface p-3 sm:p-4"
        aria-label="Filter visible teams"
      >
        <p className="mb-2 text-xs uppercase tracking-wider text-ink-subtle">Show teams</p>
        <TeamChipBar
          teams={chipTeams}
          overallRankByRoster={overallRankByRoster}
          selectedRosterIds={selectedRosterIds}
          onToggleRoster={handleToggleRoster}
          onToggleAll={handleToggleAll}
        />
        <p className="mt-1 text-[11px] text-ink-subtle" aria-live="polite">
          Showing {visibleTeams.length} of {teams.length} team
          {teams.length === 1 ? "" : "s"}. Click a team chip to toggle visibility.
        </p>
      </div>

      {visibleTeams.length === 0 ? (
        <div
          role="status"
          className="rounded-card border border-line bg-surface p-8 text-center"
        >
          <h3 className="text-lg font-semibold text-ink">No teams selected</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            Click a <span className="font-semibold text-ink">team chip</span> above to display
            that team&apos;s roster, values, and position rankings. Toggle on multiple chips to
            compare teams side-by-side.
          </p>
        </div>
      ) : (
        <ul className="space-y-4 list-none" aria-label="Teams in this league">
          {visibleTeams.map((t) => (
            <li key={t.rosterRowId}>
              <TeamCard
                data={t}
                sleeperLeagueId={sleeperLeagueId}
                headingLevel="h2"
                expanded={expandedRosterIds.has(t.sleeperRosterId)}
                onToggleExpand={() => handleToggleExpand(t.sleeperRosterId)}
                searchedUsername={searchedUsername}
                valueIsBeacon={valueIsBeacon}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function resolveOwnerRosterId(
  teams: TeamCardData[],
  searchedUsername: string | null | undefined,
  focusedRosterId: number | null | undefined,
): number | null {
  // Explicit roster focus (e.g. clicking a row on Power Rankings) wins over
  // the broader "searched username" default so deep-links land on the exact
  // team the user picked even when they also have a username in the URL.
  if (focusedRosterId != null) {
    const match = teams.find((t) => t.sleeperRosterId === focusedRosterId);
    if (match) return match.sleeperRosterId;
  }
  if (!searchedUsername || !searchedUsername.trim()) return null;
  const needle = searchedUsername.trim().toLowerCase();
  const match = teams.find(
    (t) => (t.ownerSleeperUsername ?? "").trim().toLowerCase() === needle,
  );
  return match ? match.sleeperRosterId : null;
}
